// Armazenamento local: um arquivo JSON por reunião em Documentos\Granolinha\reunioes
// (ou GRANOLINHA_DATA_DIR). Fica fora do AppData de propósito: quando o app é
// aberto de dentro de um app empacotado (MSIX), o Windows virtualiza o AppData
// e as reuniões "sumiriam" ao abrir pelo atalho.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let dataDir = null;

function dir() {
  if (dataDir) return dataDir;
  dataDir = process.env.GRANOLINHA_DATA_DIR
    || path.join(app.getPath('documents'), 'Granolinha', 'reunioes');
  fs.mkdirSync(dataDir, { recursive: true });
  migrateLegacy(dataDir);
  return dataDir;
}

// Versões anteriores salvavam em <userData>/meetings. Copia o que ainda não
// existir no local novo (não apaga nada do antigo).
function migrateLegacy(target) {
  const legacy = path.join(app.getPath('userData'), 'meetings');
  if (!fs.existsSync(legacy)) return;
  for (const f of fs.readdirSync(legacy)) {
    if (!f.endsWith('.json') || fs.existsSync(path.join(target, f))) continue;
    fs.copyFileSync(path.join(legacy, f), path.join(target, f));
  }
}

function file(id) {
  if (!/^[a-f0-9-]+$/.test(id)) throw new Error('id inválido');
  return path.join(dir(), `${id}.json`);
}

function get(id) {
  try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; }
}

function save(meeting) {
  meeting.updatedAt = new Date().toISOString();
  const tmp = `${file(meeting.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meeting, null, 2));
  fs.renameSync(tmp, file(meeting.id));
  return meeting;
}

function create() {
  const now = new Date();
  return save({
    id: crypto.randomUUID(),
    title: `Reunião ${now.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`,
    createdAt: now.toISOString(),
    notes: '',
    transcript: [],
    enhanced: '',
  });
}

function list() {
  return fs.readdirSync(dir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => get(f.slice(0, -5)))
    .filter(Boolean)
    .map(({ id, title, createdAt }) => ({ id, title, createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function remove(id) {
  fs.rmSync(file(id), { force: true });
}

module.exports = { get, save, create, list, remove };
