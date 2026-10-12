// AudioWorklet: converte Float32 em PCM Int16 little-endian (linear16)
// e envia blocos de ~100 ms para a thread principal.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    // Guardado à parte: ao transferir chunk.buffer, chunk.length vira 0.
    this.size = Math.round(sampleRate / 10);
    this.chunk = new Int16Array(this.size);
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const n = channels[0].length;
    for (let i = 0; i < n; i++) {
      // Mixa para mono.
      let v = 0;
      for (const ch of channels) v += ch[i];
      v /= channels.length;
      v = Math.max(-1, Math.min(1, v));
      this.chunk[this.offset++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.offset === this.size) {
        let sum = 0;
        for (const s of this.chunk) sum += (s / 32768) ** 2;
        const rms = Math.sqrt(sum / this.size);
        this.port.postMessage({ pcm: this.chunk.buffer, rms }, [this.chunk.buffer]);
        this.chunk = new Int16Array(this.size);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
