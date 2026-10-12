// Cliente de streaming do Deepgram: nova-3, linear16 mono, interim_results,
// smart_format.
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';
const KEEPALIVE_MS = 8000;

class Transcriber extends EventEmitter {
  constructor({ apiKey, sampleRate, language }) {
    super();
    this.apiKey = apiKey;
    this.sampleRate = sampleRate;
    this.language = language;
    this.socket = null;
    this.pending = [];
    this.stopped = false;
    this.keepAlive = null;
  }

  start() {
    const params = new URLSearchParams({
      model: 'nova-3',
      language: this.language,
      encoding: 'linear16',
      sample_rate: String(this.sampleRate),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
    });
    if (this.language === 'multi') params.set('endpointing', '100');

    this.emit('status', 'connecting');
    const ws = new WebSocket(`${DEEPGRAM_URL}?${params}`, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });
    this.socket = ws;

    ws.on('open', () => {
      this.emit('status', 'live');
      for (const chunk of this.pending) ws.send(chunk);
      this.pending = [];
      this.keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }, KEEPALIVE_MS);
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type !== 'Results') return;
      const text = msg.channel?.alternatives?.[0]?.transcript ?? '';
      if (!text) return;
      this.emit('transcript', {
        text,
        isFinal: Boolean(msg.is_final),
        start: msg.start,
        end: msg.start + msg.duration,
      });
    });

    ws.on('unexpected-response', (_req, res) => {
      this.emit('error', new Error(`Deepgram respondeu HTTP ${res.statusCode}`));
    });
    ws.on('error', (err) => this.emit('error', err));
    ws.on('close', () => {
      clearInterval(this.keepAlive);
      this.emit('status', 'closed');
      // Reconecta se a conexão cair no meio da gravação.
      if (!this.stopped) setTimeout(() => !this.stopped && this.start(), 1000);
    });
  }

  sendAudio(buf) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(buf);
    else if (!this.stopped && this.pending.length < 200) this.pending.push(buf);
  }

  // Pausa: pede ao Deepgram para fechar a frase em andamento. A conexão
  // continua aberta (o KeepAlive segura) até a gravação ser retomada.
  pause() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'Finalize' }));
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.keepAlive);
    const ws = this.socket;
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN) {
      // Pede ao Deepgram para finalizar o que estiver pendente antes de fechar.
      ws.send(JSON.stringify({ type: 'CloseStream' }));
      setTimeout(() => ws.close(), 1500);
    } else {
      ws.terminate();
    }
  }
}

module.exports = { Transcriber };
