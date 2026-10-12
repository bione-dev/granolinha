// Áudio do sistema ("Eles"): controla native/loopback.exe, que captura o que
// toca num dispositivo de saída escolhido e entrega PCM 16 kHz mono no stdout.
const { EventEmitter } = require('node:events');
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const EXE = path.join(__dirname, '..', 'native', 'loopback.exe');
const CHUNK_BYTES = 3200; // 100 ms a 16 kHz Int16, o mesmo bloco do microfone

function isAvailable() {
  return fs.existsSync(EXE);
}

function listOutputs() {
  return new Promise((resolve, reject) => {
    if (!isAvailable()) return resolve([]);
    execFile(EXE, ['list'], { windowsHide: true, timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}

class SystemAudio extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this.deviceId = 'default';
  }

  start(deviceId = 'default') {
    this.stop();
    if (!isAvailable()) {
      this.emit('error', new Error(`Captura do sistema indisponível: ${EXE} não existe.`));
      return;
    }
    this.deviceId = deviceId;
    this.buffer = Buffer.alloc(0);
    const proc = spawn(EXE, ['capture', deviceId], { windowsHide: true });
    this.proc = proc;

    proc.stdout.on('data', (data) => {
      if (this.proc !== proc) return;
      this.buffer = Buffer.concat([this.buffer, data]);
      while (this.buffer.length >= CHUNK_BYTES) {
        this.emit('chunk', this.buffer.subarray(0, CHUNK_BYTES));
        this.buffer = this.buffer.subarray(CHUNK_BYTES);
      }
    });
    proc.stderr.on('data', (data) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        try {
          const info = JSON.parse(line);
          if (info.event === 'started') this.emit('started', info.device);
        } catch {
          this.emit('error', new Error(line.trim()));
        }
      }
    });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return; // troca de dispositivo, saída esperada
      this.proc = null;
      if (code) this.emit('error', new Error(`Captura do sistema encerrou (código ${code}).`));
    });
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    proc.stdin.end(); // o loopback.exe encerra quando o stdin fecha
    setTimeout(() => proc.kill(), 1000);
  }
}

module.exports = { SystemAudio, listOutputs, isAvailable };
