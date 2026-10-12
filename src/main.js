// Processo principal: janela, captura do áudio do sistema (loopback.exe),
// transcrição (Deepgram Nova-3 ou Whisper local), armazenamento (JSON)
// e notas melhoradas (Ollama local ou Claude).
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Chaves e configurações locais ficam em .env, na raiz do projeto.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { Transcriber } = require('./transcriber');
const whisper = require('./whisper');
const systemAudio = require('./system-audio');
const store = require('./store');
const { enhanceNotes } = require('./enhance');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Granolinha',
    icon: path.join(__dirname, '..', 'assets', 'icons', 'app.ico'),
    backgroundColor: '#f7f5f0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Repassa o console do renderer para o log do processo principal.
  win.webContents.on('console-message', (e) => {
    console.log(`[renderer:${e.level}] ${e.message}`);
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function log(...args) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

// Identidade na barra de tarefas. Rodando como Granolinha.exe (npm run
// build:exe), o atalho do Menu Iniciar com este mesmo ID faz o Windows mostrar
// nome e ícone do Granolinha. Via "npm start" o processo é o electron.exe e
// continua aparecendo como Electron.
const APP_ID = 'Granolinha';
app.setAppUserModelId(APP_ID);

function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || !/granolinha\.exe$/i.test(process.execPath)) return;
  const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Granolinha.lnk');
  const ok = shell.writeShortcutLink(lnk, 'create', {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    icon: process.execPath,
    iconIndex: 0,
    appUserModelId: APP_ID,
    description: 'Bloco de notas de reunião',
  });
  if (!ok) log('não consegui criar o atalho do Menu Iniciar');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // sem a barra File/Edit/View/Window/Help
  ensureStartMenuShortcut();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  session.system.stop();
  whisper.stopServer();
});

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

ipcMain.handle('meetings:list', () => store.list());
ipcMain.handle('meetings:get', (_e, id) => store.get(id));
ipcMain.handle('meetings:create', () => store.create());
ipcMain.handle('meetings:save', (_e, meeting) => store.save(meeting));
ipcMain.handle('meetings:delete', (_e, id) => store.remove(id));

// ---------- Dispositivos e motores ----------
ipcMain.handle('devices:outputs', async () => {
  try {
    return await systemAudio.listOutputs();
  } catch (err) {
    log('erro ao listar saídas:', err.message);
    return [];
  }
});

// Motores de transcrição: 'nova3' (Deepgram, nuvem) ou 'whisper' (local).
ipcMain.handle('transcription:engines', () => ({
  default: process.env.TRANSCRIPTION_ENGINE === 'whisper' ? 'whisper' : 'nova3',
  available: {
    nova3: Boolean(process.env.DEEPGRAM_API_KEY),
    whisper: whisper.isAvailable(),
  },
}));

function createTranscriber(engine, sampleRate) {
  if (engine === 'whisper') {
    if (!whisper.isAvailable()) {
      throw new Error(`Whisper não instalado. Esperado: ${whisper.SERVER_PATH} e ${whisper.MODEL_PATH}`);
    }
    return new whisper.WhisperTranscriber({ sampleRate });
  }
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('Defina DEEPGRAM_API_KEY no arquivo .env.');
  return new Transcriber({
    apiKey: key,
    sampleRate,
    language: process.env.DEEPGRAM_LANGUAGE || 'multi',
  });
}

// ---------- Sessão de gravação ----------
// Um transcritor por fonte: microfone = "Eu", sistema = "Eles".
const session = {
  active: false,
  paused: false,
  transcribers: { microphone: null, system: null },
  stats: { microphone: 0, system: 0 },
  system: new systemAudio.SystemAudio(),
};

function feed(source, pcm) {
  if (!session.active || session.paused) return;
  // Loga a cada ~5 s de áudio recebido por fonte, para diagnóstico.
  if (session.stats[source]++ % 50 === 0) log(`[${source}] áudio recebido: ${session.stats[source]} blocos`);
  session.transcribers[source]?.sendAudio(pcm);
}

session.system.on('chunk', (pcm) => {
  feed('system', pcm);
  if (!session.paused) send('audio:level', { source: 'system', rms: rms(pcm) });
});
session.system.on('started', (device) => {
  log(`[system] capturando: ${device.name}`);
  send('audio:system-device', device);
});
session.system.on('error', (err) => {
  log(`[system] erro de captura: ${err.message}`);
  send('transcription:status', { source: 'system', status: 'error', message: err.message });
});

ipcMain.handle('recording:start', async (_e, { sampleRate, engine, outputId }) => {
  log(`recording:start motor=${engine} saída=${outputId} sampleRate=${sampleRate}`);
  await stopSession();
  for (const source of Object.keys(session.transcribers)) {
    session.stats[source] = 0;
    const t = createTranscriber(engine, sampleRate);
    t.on('transcript', (seg) => {
      if (seg.isFinal && seg.text) log(`[${source}] final: ${seg.text}`);
      send('transcription:segment', { source, ...seg });
    });
    t.on('status', (status) => {
      log(`[${source}] status ${status}`);
      send('transcription:status', { source, status });
    });
    t.on('error', (err) => {
      log(`[${source}] erro ${err.message}`);
      send('transcription:status', { source, status: 'error', message: err.message });
    });
    t.start();
    session.transcribers[source] = t;
  }
  session.active = true;
  session.paused = false;
  session.system.start(outputId || 'default');
});

ipcMain.handle('recording:set-output', (_e, outputId) => {
  if (!session.active) return;
  log(`recording:set-output ${outputId}`);
  session.system.start(outputId || 'default');
});

ipcMain.handle('recording:pause', () => {
  if (!session.active || session.paused) return;
  log('recording:pause');
  session.paused = true;
  // Fecha o trecho em andamento para a última frase aparecer já.
  for (const t of Object.values(session.transcribers)) t?.pause?.();
});

ipcMain.handle('recording:resume', () => {
  if (!session.active || !session.paused) return;
  log('recording:resume');
  session.paused = false;
});

ipcMain.on('recording:mic-audio', (_e, pcm) => feed('microphone', Buffer.from(pcm)));

async function stopSession() {
  if (!session.active) return;
  log('recording:stop', session.stats);
  session.active = false;
  session.paused = false;
  session.system.stop();
  const stopping = Object.values(session.transcribers).map((t) => t?.stop());
  for (const source of Object.keys(session.transcribers)) session.transcribers[source] = null;
  await Promise.allSettled(stopping);
}

ipcMain.handle('recording:stop', () => stopSession());

// ---------- Notas ----------
ipcMain.handle('notes:enhance', async (_e, { meetingId }) => {
  const meeting = store.get(meetingId);
  if (!meeting) throw new Error('Reunião não encontrada.');
  const t0 = Date.now();
  log(`notes:enhance "${meeting.title}" notas=${meeting.notes.length} chars, transcrição=${meeting.transcript.length} falas`);
  try {
    const text = await enhanceNotes(meeting, (delta) => send('notes:delta', { meetingId, delta }));
    log(`notes:enhance ok em ${((Date.now() - t0) / 1000).toFixed(1)} s, ${text.length} chars`);
    meeting.enhanced = text;
    store.save(meeting);
    return text;
  } catch (err) {
    log(`notes:enhance erro após ${((Date.now() - t0) / 1000).toFixed(1)} s: ${err.message}`);
    throw err;
  }
});

function rms(buf) {
  const n = buf.length >> 1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return n ? Math.sqrt(sum / n) : 0;
}
