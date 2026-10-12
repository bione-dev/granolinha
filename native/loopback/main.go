// loopback: captura o áudio que toca num dispositivo de saída do Windows
// (WASAPI loopback) e escreve PCM 16 kHz mono Int16 LE no stdout.
//
// Uso:
//   loopback list                  → JSON com as saídas ativas
//   loopback capture <id|default>  → PCM contínuo no stdout até o stdin fechar
//
// O Chromium só captura a saída padrão; isto permite escolher qualquer uma.
// O WASAPI não entrega pacotes quando nada está tocando, então o programa
// completa com silêncio pelo relógio: o fluxo de saída nunca para, e os tempos
// da transcrição continuam batendo com o tempo real.
package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"runtime"
	"sync"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"
)

const (
	outRate      = 16000
	tickInterval = 100 * time.Millisecond
	maxBuffered  = outRate / 2 // descarta o excesso acima de 0,5 s (deriva de relógio)
)

type device struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	IsDefault bool   `json:"isDefault"`
}

func main() {
	if len(os.Args) < 2 {
		fail("uso: loopback list | loopback capture <id|default>")
	}
	runtime.LockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED); err != nil {
		fail("CoInitializeEx: %v", err)
	}
	defer ole.CoUninitialize()

	var mmde *wca.IMMDeviceEnumerator
	if err := wca.CoCreateInstance(wca.CLSID_MMDeviceEnumerator, 0, wca.CLSCTX_ALL, wca.IID_IMMDeviceEnumerator, &mmde); err != nil {
		fail("MMDeviceEnumerator: %v", err)
	}
	defer mmde.Release()

	switch os.Args[1] {
	case "list":
		devices, _, err := listDevices(mmde)
		if err != nil {
			fail("listar: %v", err)
		}
		json.NewEncoder(os.Stdout).Encode(devices)
	case "capture":
		id := "default"
		if len(os.Args) > 2 {
			id = os.Args[2]
		}
		if err := capture(mmde, id); err != nil {
			fail("captura: %v", err)
		}
	default:
		fail("comando desconhecido: %s", os.Args[1])
	}
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

func defaultID(mmde *wca.IMMDeviceEnumerator) string {
	var mmd *wca.IMMDevice
	if err := mmde.GetDefaultAudioEndpoint(wca.ERender, wca.EConsole, &mmd); err != nil {
		return ""
	}
	defer mmd.Release()
	var id string
	mmd.GetId(&id)
	return id
}

// listDevices devolve as saídas ativas e os ponteiros COM (o chamador libera).
func listDevices(mmde *wca.IMMDeviceEnumerator) ([]device, []*wca.IMMDevice, error) {
	var dc *wca.IMMDeviceCollection
	if err := mmde.EnumAudioEndpoints(wca.ERender, wca.DEVICE_STATE_ACTIVE, &dc); err != nil {
		return nil, nil, err
	}
	defer dc.Release()
	var count uint32
	if err := dc.GetCount(&count); err != nil {
		return nil, nil, err
	}
	def := defaultID(mmde)
	devices := []device{}
	ptrs := []*wca.IMMDevice{}
	for i := uint32(0); i < count; i++ {
		var mmd *wca.IMMDevice
		if err := dc.Item(i, &mmd); err != nil {
			continue
		}
		var id string
		mmd.GetId(&id)
		name := id
		var ps *wca.IPropertyStore
		if err := mmd.OpenPropertyStore(wca.STGM_READ, &ps); err == nil {
			var pv wca.PROPVARIANT
			if err := ps.GetValue(&wca.PKEY_Device_FriendlyName, &pv); err == nil {
				name = pv.String()
			}
			ps.Release()
		}
		devices = append(devices, device{ID: id, Name: name, IsDefault: id == def})
		ptrs = append(ptrs, mmd)
	}
	return devices, ptrs, nil
}

func capture(mmde *wca.IMMDeviceEnumerator, wanted string) error {
	devices, ptrs, err := listDevices(mmde)
	if err != nil {
		return err
	}
	var mmd *wca.IMMDevice
	var chosen device
	for i, d := range devices {
		if (wanted == "default" && d.IsDefault) || d.ID == wanted {
			mmd, chosen = ptrs[i], d
		} else {
			ptrs[i].Release()
		}
	}
	if mmd == nil {
		return fmt.Errorf("dispositivo não encontrado: %s", wanted)
	}
	defer mmd.Release()

	var ac *wca.IAudioClient
	if err := mmd.Activate(wca.IID_IAudioClient, wca.CLSCTX_ALL, nil, &ac); err != nil {
		return fmt.Errorf("Activate: %w", err)
	}
	defer ac.Release()

	var wfx *wca.WAVEFORMATEX
	if err := ac.GetMixFormat(&wfx); err != nil {
		return fmt.Errorf("GetMixFormat: %w", err)
	}
	defer ole.CoTaskMemFree(uintptr(unsafe.Pointer(wfx)))
	channels := int(wfx.NChannels)
	bits := int(wfx.WBitsPerSample)
	inRate := int(wfx.NSamplesPerSec)
	if bits != 32 && bits != 16 {
		return fmt.Errorf("formato não suportado: %d bits", bits)
	}

	// Buffer de 200 ms em modo compartilhado com loopback.
	if err := ac.Initialize(wca.AUDCLNT_SHAREMODE_SHARED, wca.AUDCLNT_STREAMFLAGS_LOOPBACK,
		wca.REFERENCE_TIME(200*10000), 0, wfx, nil); err != nil {
		return fmt.Errorf("Initialize: %w", err)
	}
	var acc *wca.IAudioCaptureClient
	if err := ac.GetService(wca.IID_IAudioCaptureClient, &acc); err != nil {
		return fmt.Errorf("GetService: %w", err)
	}
	defer acc.Release()
	if err := ac.Start(); err != nil {
		return fmt.Errorf("Start: %w", err)
	}
	defer ac.Stop()

	info, _ := json.Marshal(map[string]any{"event": "started", "device": chosen, "inRate": inRate, "channels": channels, "bits": bits})
	fmt.Fprintln(os.Stderr, string(info))

	rs := &resampler{ratio: float64(inRate) / outRate}
	var mu sync.Mutex
	var pending []int16

	// Encerra quando o processo pai fecha o stdin.
	done := make(chan struct{})
	go func() {
		io.Copy(io.Discard, os.Stdin)
		close(done)
	}()

	// Escritor: a cada 100 ms entrega exatamente o áudio correspondente ao
	// tempo decorrido, completando com silêncio se faltar.
	writeErr := make(chan error, 1)
	go func() {
		start := time.Now()
		written := 0
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
			}
			due := int(time.Since(start).Seconds()*outRate) - written
			if due <= 0 {
				continue
			}
			mu.Lock()
			if len(pending) > maxBuffered+due {
				pending = pending[len(pending)-(maxBuffered+due):]
			}
			n := min(due, len(pending))
			out := make([]int16, due)
			copy(out, pending[:n])
			pending = pending[n:]
			mu.Unlock()
			if err := binary.Write(os.Stdout, binary.LittleEndian, out); err != nil {
				writeErr <- err
				return
			}
			written += due
		}
	}()

	// Leitor: tira os pacotes do WASAPI, mixa para mono e reamostra.
	mono := []float32{}
	for {
		select {
		case <-done:
			return nil
		case err := <-writeErr:
			return err
		default:
		}
		var frames uint32
		if err := acc.GetNextPacketSize(&frames); err != nil {
			return fmt.Errorf("GetNextPacketSize: %w", err)
		}
		if frames == 0 {
			time.Sleep(10 * time.Millisecond)
			continue
		}
		var data *byte
		var flags uint32
		if err := acc.GetBuffer(&data, &frames, &flags, nil, nil); err != nil {
			return fmt.Errorf("GetBuffer: %w", err)
		}
		mono = mono[:0]
		silent := flags&wca.AUDCLNT_BUFFERFLAGS_SILENT != 0
		frameBytes := channels * bits / 8
		raw := unsafe.Slice(data, int(frames)*frameBytes)
		for f := 0; f < int(frames); f++ {
			var sum float32
			if !silent {
				for c := 0; c < channels; c++ {
					off := f*frameBytes + c*bits/8
					if bits == 32 {
						sum += math.Float32frombits(binary.LittleEndian.Uint32(raw[off:]))
					} else {
						sum += float32(int16(binary.LittleEndian.Uint16(raw[off:]))) / 32768
					}
				}
			}
			mono = append(mono, sum/float32(channels))
		}
		acc.ReleaseBuffer(frames)

		out := rs.process(mono)
		mu.Lock()
		pending = append(pending, out...)
		mu.Unlock()
	}
}

// resampler converte para 16 kHz por média das amostras de cada intervalo
// (filtro passa-baixa simples, suficiente para fala).
type resampler struct {
	ratio float64 // amostras de entrada por amostra de saída
	pos   float64 // posição fracionária dentro do intervalo atual
	acc   float64
	n     int
}

func (r *resampler) process(in []float32) []int16 {
	out := make([]int16, 0, int(float64(len(in))/r.ratio)+1)
	for _, s := range in {
		r.acc += float64(s)
		r.n++
		r.pos++
		if r.pos >= r.ratio {
			r.pos -= r.ratio
			v := r.acc / float64(r.n)
			r.acc, r.n = 0, 0
			v = math.Max(-1, math.Min(1, v))
			out = append(out, int16(v*32767))
		}
	}
	return out
}
