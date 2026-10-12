// Transcrição local com Whisper (whisper.cpp, servidor HTTP na GPU).
//
// O Whisper transcreve trechos fechados de áudio, não um fluxo contínuo.
// Então cortamos o áudio em trechos de fala por energia (um VAD simples):
// o trecho fecha após ~0,7 s de silêncio ou ao atingir 15 s. Enquanto alguém
// fala, enviamos parciais a cada ~2 s para o texto aparecer ao vivo.
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', 'whisper');
const SERVER_PATH = process.env.WHISPER_SERVER_PATH || path.join(ROOT, 'whisper-server.exe');
const MODEL_PATH = process.env.WHISPER_MODEL_PATH || path.join(ROOT, 'models', 'ggml-large-v3-turbo-q5_0.bin');
const PORT = Number(process.env.WHISPER_PORT || 8178);
const LANGUAGE = process.env.WHISPER_LANGUAGE || 'pt';
const VAD_THRESHOLD = Number(process.env.WHISPER_VAD_THRESHOLD || 0.01);

const CHUNK_MS = 100;          // o renderer manda blocos de 100 ms
const PREROLL_CHUNKS = 3;      // guarda 300 ms antes da fala começar
const SILENCE_CHUNKS = 7;      // 700 ms de silêncio fecha o trecho
const MAX_SEGMENT_CHUNKS = 150; // 15 s no máximo por trecho
const PARTIAL_EVERY_CHUNKS = 20; // parcial a cada 2 s de fala
// Trechos com menos de 0,5 s de fala real (cliques, efeitos sonoros) são
// descartados: é neles que o Whisper "inventa" frases como "E aí".
const MIN_SPEECH_CHUNKS = 5;

// Frases que o Whisper costuma "alucinar" em ruído ou silêncio.
const HALLUCINATIONS = [
  /^\s*[[(].*[\])]\s*$/,
  /legendas? (pela comunidade|por)/i,
  /amara\.org/i,
  /^\s*obrigad[oa] por assistir/i,
  /inscreva-se no canal/i,
];

function isAvailable() {
  return fs.existsSync(SERVER_PATH) && fs.existsSync(MODEL_PATH);
}

// ---------- Servidor whisper.cpp (um só para o app inteiro) ----------
let serverProc = null;
let serverReady = null;
let queue = Promise.resolve();

function baseUrl() {
  return `http://127.0.0.1:${PORT}`;
}

async function isUp() {
  try {
    await fetch(baseUrl(), { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

function ensureServer() {
  if (serverReady) return serverReady;
  serverReady = (async () => {
    if (await isUp()) return;
    if (!isAvailable()) {
      throw new Error(`Whisper não encontrado. Esperado: ${SERVER_PATH} e ${MODEL_PATH}`);
    }
    serverProc = spawn(SERVER_PATH, [
      '-m', MODEL_PATH,
      '--host', '127.0.0.1',
      '--port', String(PORT),
      '-l', LANGUAGE,
      '-sns', // suprime tokens que não são fala
    ], { cwd: path.dirname(SERVER_PATH), windowsHide: true });
    serverProc.stderr.on('data', () => {}); // o servidor é verboso; descarta
    serverProc.on('exit', (code) => {
      console.log(`[whisper] servidor encerrou (código ${code})`);
      serverProc = null;
      serverReady = null;
    });
    // Carregar o modelo na GPU leva alguns segundos.
    for (let i = 0; i < 120; i++) {
      if (await isUp()) return;
      if (!serverProc) throw new Error('O servidor do Whisper fechou ao iniciar.');
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('O servidor do Whisper não respondeu em 60 s.');
  })();
  serverReady.catch(() => { serverReady = null; });
  return serverReady;
}

function stopServer() {
  serverProc?.kill();
  serverProc = null;
  serverReady = null;
}

function wav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// O servidor processa um pedido por vez; a fila evita disputa entre as fontes.
function transcribe(pcm, sampleRate) {
  const job = queue.then(async () => {
    const form = new FormData();
    form.append('file', new Blob([wav(pcm, sampleRate)], { type: 'audio/wav' }), 'audio.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    const res = await fetch(`${baseUrl()}/inference`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Whisper respondeu HTTP ${res.status}`);
    const { text = '' } = await res.json();
    const clean = text.replace(/\s+/g, ' ').trim();
    return HALLUCINATIONS.some((re) => re.test(clean)) ? '' : clean;
  });
  queue = job.catch(() => {});
  return job;
}

// Pedidos em andamento (das duas fontes). Parciais só saem com a fila vazia,
// para não atrasar os trechos finais.
let inFlight = 0;

// ---------- Transcritor (mesma interface do Transcriber do Deepgram) ----------
class WhisperTranscriber extends EventEmitter {
  constructor({ sampleRate }) {
    super();
    this.sampleRate = sampleRate;
    this.chunkIndex = 0;   // blocos recebidos desde o início (relógio)
    this.preroll = [];
    this.segment = null;   // { chunks: [], startChunk, silence, sincePartial }
    this.ready = false;
    this.stopped = false;
    this.pending = new Set();
  }

  start() {
    this.emit('status', 'connecting');
    ensureServer().then(
      () => { this.ready = true; this.emit('status', 'live'); },
      (err) => this.emit('error', err),
    );
  }

  sendAudio(buf) {
    if (this.stopped) return;
    const chunk = Buffer.from(buf);
    const index = this.chunkIndex++;
    const speech = rms(chunk) > VAD_THRESHOLD;

    if (!this.segment) {
      if (speech) {
        this.segment = {
          chunks: [...this.preroll, chunk],
          startChunk: index - this.preroll.length,
          silence: 0,
          sincePartial: 0,
          speech: 1,
        };
        this.preroll = [];
      } else {
        this.preroll.push(chunk);
        if (this.preroll.length > PREROLL_CHUNKS) this.preroll.shift();
      }
      return;
    }

    const seg = this.segment;
    seg.chunks.push(chunk);
    seg.silence = speech ? 0 : seg.silence + 1;
    if (speech) seg.speech++;
    seg.sincePartial++;

    if (seg.silence >= SILENCE_CHUNKS || seg.chunks.length >= MAX_SEGMENT_CHUNKS) {
      this.segment = null;
      this.flush(seg, true);
    } else if (seg.sincePartial >= PARTIAL_EVERY_CHUNKS && inFlight === 0) {
      seg.sincePartial = 0;
      this.flush(seg, false);
    }
  }

  flush(seg, isFinal) {
    if (!this.ready) return;
    if (seg.speech < MIN_SPEECH_CHUNKS) {
      // Ruído curto: descarta, mas limpa a parcial que possa estar na tela.
      if (isFinal) this.emit('transcript', { text: '', isFinal: true, start: 0, end: 0 });
      return;
    }
    const pcm = Buffer.concat(seg.chunks);
    const start = (seg.startChunk * CHUNK_MS) / 1000;
    const end = start + seg.chunks.length * CHUNK_MS / 1000;
    inFlight++;
    const p = transcribe(pcm, this.sampleRate)
      .then((text) => {
        // Parcial que chega depois do trecho já ter fechado: descarta.
        if (!isFinal && this.segment !== seg) return;
        if (text || isFinal) this.emit('transcript', { text, isFinal, start, end });
      })
      .catch((err) => this.emit('error', err))
      .finally(() => { inFlight--; this.pending.delete(p); });
    this.pending.add(p);
  }

  // Pausa: fecha o trecho em andamento; o próximo começa do zero.
  pause() {
    if (this.segment) {
      this.flush(this.segment, true);
      this.segment = null;
    }
    this.preroll = [];
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.segment) {
      this.flush(this.segment, true);
      this.segment = null;
    }
    await Promise.allSettled([...this.pending]);
    this.emit('status', 'closed');
  }
}

function rms(buf) {
  const n = Math.floor(buf.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

module.exports = { WhisperTranscriber, isAvailable, stopServer, MODEL_PATH, SERVER_PATH };
