// Renderer: UI, captura do microfone, seleção de dispositivos e ajuda.
// O áudio do sistema é capturado no processo principal (native/loopback.exe).
const SAMPLE_RATE = 16000;
const $ = (id) => document.getElementById(id);

let meeting = null;
let rec = null; // gravação em andamento: { ctx, node, micStream, micSource, paused }
let saveTimer = null;
const interim = { microphone: '', system: '' };

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

// Reunião que já foi gravada e encerrada não pode ser gravada de novo.
// (Reuniões antigas, de antes do campo endedAt, contam como encerradas se
// já têm transcrição.)
function isEnded(m) {
  return Boolean(m.endedAt) || (m.transcript.length > 0 && !rec);
}

// ---------- Lista de reuniões ----------
async function refreshList({ animate = false } = {}) {
  const items = await window.api.listMeetings();
  const ul = $('meeting-list');
  ul.innerHTML = '';
  for (const m of items) {
    const li = document.createElement('li');
    li.dataset.id = m.id;
    li.title = new Date(m.createdAt).toLocaleString('pt-BR');
    if (meeting && m.id === meeting.id) li.classList.add('active');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = m.title;

    const actions = document.createElement('span');
    actions.className = 'actions';
    const renameBtn = document.createElement('button');
    renameBtn.className = 'ghost icon-only';
    renameBtn.innerHTML = icon('pencil');
    renameBtn.title = 'Renomear';
    renameBtn.onclick = (e) => { e.stopPropagation(); startRename(li, m); };
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'ghost icon-only';
    deleteBtn.innerHTML = icon('trash');
    deleteBtn.title = 'Excluir';
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteMeeting(m, li); };
    actions.append(renameBtn, deleteBtn);

    li.append(name, actions);
    li.onclick = () => {
      if (meeting && m.id === meeting.id) return;
      if (rec) {
        Anim.shake(li);
        return flashStatus('Encerre a gravação antes de trocar de reunião.');
      }
      openMeeting(m.id);
    };
    li.ondblclick = () => startRename(li, m);
    ul.appendChild(li);
  }
  if (animate) Anim.stagger(ul.children);
}

// Renomear direto na lista: Enter ou clicar fora salva, Esc cancela.
function startRename(li, m) {
  if (li.querySelector('input')) return;
  const input = document.createElement('input');
  input.className = 'rename';
  input.spellcheck = false;
  input.value = m.title;
  li.replaceChildren(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (save && title && title !== m.title) await renameMeeting(m.id, title);
    refreshList();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
  input.onclick = (e) => e.stopPropagation();
  input.ondblclick = (e) => e.stopPropagation();
}

async function renameMeeting(id, title) {
  if (meeting && meeting.id === id) {
    // Reunião aberta: atualiza o objeto em memória, senão o próximo
    // salvamento automático voltaria o nome antigo.
    meeting.title = title;
    $('title').value = title;
    await saveNow();
  } else {
    const m = await window.api.getMeeting(id);
    if (!m) return;
    m.title = title;
    await window.api.saveMeeting(m);
  }
}

async function deleteMeeting(m, li = document.querySelector('#meeting-list li.active')) {
  const isCurrent = meeting && meeting.id === m.id;
  if (isCurrent && rec) {
    Anim.shake($('stop'));
    return flashStatus('Encerre a gravação antes de excluir.');
  }
  if (!confirm(`Excluir "${m.title}"? Isso não pode ser desfeito.`)) return;
  await window.api.deleteMeeting(m.id);
  if (isCurrent) {
    clearTimeout(saveTimer); // não recriar o arquivo com um salvamento pendente
    meeting = null;
    $('editor').hidden = true;
    $('empty').hidden = false;
    Anim.fadeIn($('empty'));
  }
  if (li) await Anim.collapse(li);
  refreshList();
}

async function openMeeting(id) {
  meeting = await window.api.getMeeting(id);
  const wasEmpty = $('editor').hidden;
  $('empty').hidden = true;
  $('editor').hidden = false;
  $('title').value = meeting.title;
  $('notes').value = meeting.notes;
  $('enhanced').innerHTML = meeting.enhanced ? renderMarkdown(meeting.enhanced) : '';
  interim.microphone = interim.system = '';
  shownFinals = meeting.transcript.length; // não anima o que já existia
  renderTranscript();
  renderControls();
  showTab(meeting.enhanced ? 'enhanced' : 'notes', { animate: false });
  Anim.fadeIn(wasEmpty ? $('editor') : document.querySelector('.panes'), { y: 4, duration: 180 });
  // Só troca o destaque, sem redesenhar a lista: redesenhar entre os dois
  // cliques de um clique duplo impedia o "clique duplo para renomear".
  const items = [...document.querySelectorAll('#meeting-list li')];
  for (const li of items) li.classList.toggle('active', li.dataset.id === meeting.id);
  if (!items.some((li) => li.dataset.id === meeting.id)) refreshList(); // reunião nova
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => meeting && window.api.saveMeeting(meeting), 500);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (meeting) await window.api.saveMeeting(meeting);
}

$('new-meeting').onclick = async () => {
  if (rec) return flashStatus('Encerre a gravação atual antes de criar outra reunião.');
  const m = await window.api.createMeeting();
  await openMeeting(m.id);
  $('notes').focus();
  // A gravação só começa quando o usuário clicar em Gravar.
};

$('title').oninput = () => { meeting.title = $('title').value; scheduleSave(); };
$('title').onchange = refreshList;
$('notes').oninput = () => { meeting.notes = $('notes').value; scheduleSave(); };

$('delete').onclick = () => deleteMeeting(meeting);

// ---------- Abas ----------
function showTab(tab, { animate = true } = {}) {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  const wasHidden = $(tab).hidden;
  $('notes').hidden = tab !== 'notes';
  $('enhanced').hidden = tab !== 'enhanced';
  if (animate && wasHidden) Anim.fadeIn($(tab), { y: 4, duration: 180 });
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => showTab(b.dataset.tab);

// ---------- Estado dos controles ----------
function renderControls() {
  const ended = meeting && isEnded(meeting);
  $('record').hidden = Boolean(rec) || ended;
  $('pause').hidden = !rec;
  $('stop').hidden = !rec;
  $('meters').hidden = !rec;
  if (rec?.paused) setIconLabel($('pause'), 'resume', 'Retomar');
  else setIconLabel($('pause'), 'pause', 'Pausar');
  $('engine').disabled = Boolean(rec);

  const badge = $('badge');
  const before = badge.textContent;
  badge.className = '';
  if (rec && rec.paused) { badge.textContent = 'Pausada'; badge.classList.add('paused'); }
  else if (rec) { badge.textContent = 'Gravando'; badge.classList.add('live'); }
  else if (ended) { badge.textContent = 'Gravação encerrada'; badge.classList.add('ended'); }
  else badge.textContent = '';
  if (badge.textContent && badge.textContent !== before) Anim.pop(badge);

  if (!rec || rec.paused) resetMeters();
}

function resetMeters() {
  $('meter-mic').style.height = '0';
  $('meter-sys').style.height = '0';
}

let flashTimer = null;
function flashStatus(text) {
  $('status').textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { $('status').textContent = ''; }, 4000);
}

// ---------- Transcrição ----------
let shownFinals = 0; // quantas falas finais já estavam na tela (as novas entram animadas)

function renderTranscript() {
  const box = $('transcript');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = '';
  const add = (source, text, cls = '') => {
    const div = document.createElement('div');
    div.className = `seg ${source} ${cls}`;
    const who = document.createElement('b');
    who.textContent = source === 'microphone' ? 'Eu' : 'Eles';
    div.append(who, document.createTextNode(text));
    box.appendChild(div);
    return div;
  };
  meeting.transcript.forEach((s, i) => {
    const div = add(s.source, s.text);
    if (i >= shownFinals) Anim.fadeIn(div, { y: 4, duration: 240 });
  });
  shownFinals = meeting.transcript.length;
  for (const source of ['microphone', 'system']) if (interim[source]) add(source, interim[source], 'interim');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

window.api.onSegment((seg) => {
  if (!meeting || !rec) return;
  if (seg.isFinal) {
    interim[seg.source] = '';
    if (seg.text) {
      meeting.transcript.push({
        source: seg.source,
        text: seg.text,
        at: new Date(Date.now() - (seg.end - seg.start) * 1000).toISOString(),
      });
      scheduleSave();
    }
  } else {
    interim[seg.source] = seg.text;
  }
  renderTranscript();
});

const lastStatus = {};
window.api.onStatus(({ source, status, message }) => {
  lastStatus[source] = status;
  if (message) console.error(source, message);
  const values = Object.values(lastStatus);
  $('status').textContent = values.includes('error') ? 'erro na transcrição'
    : values.includes('connecting') ? 'conectando…' : '';
});

window.api.onLevel(({ source, rms }) => {
  if (source === 'system' && rec && !rec.paused) setMeter('meter-sys', rms);
});

function setMeter(id, rms) {
  $(id).style.height = `${Math.min(100, rms * 400)}%`;
}

// ---------- Dispositivos ----------
async function refreshDevices() {
  // Microfones: lista do Chromium.
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  fillSelect($('mic'), [
    { value: 'default', label: 'Padrão do Windows' },
    ...inputs
      .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ value: d.deviceId, label: d.label || `Microfone ${i + 1}` })),
  ], storageGet('mic'));

  // Saídas: lista do WASAPI (loopback.exe), com os IDs que ele entende.
  const outputs = await window.api.listOutputs();
  fillSelect($('output'), [
    { value: 'default', label: 'Padrão do Windows' },
    ...outputs.map((d) => ({ value: d.id, label: d.name + (d.isDefault ? ' (padrão)' : '') })),
  ], storageGet('output'));
}

function fillSelect(select, options, saved) {
  const current = select.value || saved;
  select.innerHTML = '';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    select.appendChild(opt);
  }
  select.value = options.some((o) => o.value === current) ? current : 'default';
}

async function getMic(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

$('mic').onchange = async () => {
  storageSet('mic', $('mic').value);
  if (!rec) return;
  // Troca o microfone sem parar a gravação: liga a nova fonte no mesmo worklet.
  try {
    const stream = await getMic($('mic').value);
    rec.micSource.disconnect();
    rec.micStream.getTracks().forEach((t) => t.stop());
    rec.micStream = stream;
    rec.micSource = rec.ctx.createMediaStreamSource(stream);
    rec.micSource.connect(rec.node);
    console.log('microfone trocado:', stream.getAudioTracks()[0]?.label);
  } catch (err) {
    console.error('Falha ao trocar microfone:', err.message);
    flashStatus('Não foi possível usar esse microfone.');
  }
};

$('output').onchange = async () => {
  storageSet('output', $('output').value);
  if (rec) await window.api.setOutput($('output').value);
};

navigator.mediaDevices.ondevicechange = () => refreshDevices();

// ---------- Gravação ----------
async function startRecording() {
  const micStream = await getMic($('mic').value);
  console.log('microfone ok:', micStream.getAudioTracks()[0]?.label);

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule('pcm-worklet.js');
  const sink = ctx.createGain();
  sink.gain.value = 0; // mantém o grafo rodando sem tocar nada nos alto-falantes
  sink.connect(ctx.destination);

  const node = new AudioWorkletNode(ctx, 'pcm-worklet');
  node.port.onmessage = ({ data }) => {
    if (!rec || rec.paused) return;
    window.api.sendMicAudio(data.pcm);
    setMeter('meter-mic', data.rms);
  };
  node.connect(sink);
  const micSource = ctx.createMediaStreamSource(micStream);
  micSource.connect(node);

  const engine = $('engine').value;
  try {
    await window.api.startRecording({ sampleRate: ctx.sampleRate, engine, outputId: $('output').value });
  } catch (err) {
    micStream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw err;
  }
  rec = { ctx, node, micStream, micSource, paused: false };
  meeting.engine = engine;
  meeting.startedAt ??= new Date().toISOString();
  await saveNow();
  // Depois da primeira permissão, os nomes dos microfones ficam disponíveis.
  refreshDevices();
}

async function stopRecording() {
  const r = rec;
  r.micStream.getTracks().forEach((t) => t.stop());
  await r.ctx.close();
  // Espera os últimos trechos (o Whisper ainda pode estar transcrevendo).
  await window.api.stopRecording();
  rec = null;
  interim.microphone = interim.system = '';
  meeting.endedAt = new Date().toISOString();
  await saveNow();
  renderTranscript();
  renderControls();
}

async function onRecord() {
  if (rec || isEnded(meeting)) return;
  $('record').disabled = true;
  try {
    await startRecording();
  } catch (err) {
    console.error('Falha ao gravar:', err.stack || err.message);
    alert(`Não foi possível gravar: ${err.message}`);
  } finally {
    $('record').disabled = false;
    renderControls();
  }
}
$('record').onclick = onRecord;

$('pause').onclick = async () => {
  if (!rec) return;
  if (rec.paused) {
    await window.api.resumeRecording();
    rec.paused = false;
  } else {
    rec.paused = true;
    await window.api.pauseRecording();
  }
  renderControls();
};

$('stop').onclick = async () => {
  if (!rec) return;
  if (!confirm('Encerrar a gravação? Esta reunião não poderá ser gravada de novo.')) return;
  $('stop').disabled = true;
  try {
    await stopRecording();
  } finally {
    $('stop').disabled = false;
  }
};

// ---------- Notas melhoradas ----------
let enhancedDraft = '';
window.api.onNotesDelta(({ meetingId, delta }) => {
  if (!meeting || meetingId !== meeting.id) return;
  enhancedDraft += delta;
  $('enhanced').innerHTML = renderMarkdown(enhancedDraft);
});

$('enhance').onclick = async () => {
  if (rec) {
    if (!confirm('Gerar as notas encerra a gravação, e esta reunião não poderá ser gravada de novo. Continuar?')) return;
    await stopRecording();
  }
  const btn = $('enhance');
  btn.disabled = true;
  btn.classList.add('generating');
  setIconLabel(btn, 'sparkles', 'Gerando…');
  enhancedDraft = '';
  // Esqueleto animado até o primeiro trecho de texto chegar.
  $('enhanced').innerHTML = skeletonHTML();
  showTab('enhanced');
  try {
    await saveNow();
    const text = await window.api.enhanceNotes(meeting.id);
    meeting.enhanced = text;
    $('enhanced').innerHTML = renderMarkdown(text);
  } catch (err) {
    $('enhanced').textContent = `Erro ao gerar notas: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.classList.remove('generating');
    setIconLabel(btn, 'sparkles', 'Gerar notas');
    Anim.pop(btn.querySelector('.icon'));
  }
};

// ---------- Motor de transcrição ----------
async function initEngines() {
  const { default: def, available } = await window.api.getEngines();
  const select = $('engine');
  for (const opt of select.options) {
    if (!available[opt.value]) {
      opt.disabled = true;
      opt.textContent += opt.value === 'whisper' ? ' — não instalado' : ' — sem chave';
    }
  }
  const choice = [storageGet('engine'), def, 'nova3', 'whisper'].find((e) => e && available[e]);
  if (choice) select.value = choice;
  const showEngineIcon = () => {
    $('engine-icon').innerHTML = icon(select.value === 'whisper' ? 'chip' : 'cloud');
  };
  showEngineIcon();
  select.onchange = () => {
    storageSet('engine', select.value);
    showEngineIcon();
  };
}

// ---------- Ajuda ----------
function openHelp(topicId = HELP_TOPICS[0].id) {
  const nav = $('help-nav');
  nav.innerHTML = '';
  for (const t of HELP_TOPICS) {
    const b = document.createElement('button');
    b.textContent = t.title;
    b.onclick = () => showHelpTopic(t.id);
    b.dataset.topic = t.id;
    nav.appendChild(b);
  }
  showHelpTopic(topicId, { animate: false });
  Anim.modalOpen($('modal'), document.querySelector('.modal-box'));
  $('modal-close').focus();
}

function showHelpTopic(id, { animate = true } = {}) {
  const topic = HELP_TOPICS.find((t) => t.id === id) ?? HELP_TOPICS[0];
  for (const b of $('help-nav').children) b.classList.toggle('active', b.dataset.topic === topic.id);
  $('help-body').innerHTML = `<h2 id="help-title">${topic.title}</h2>${topic.html}`;
  $('help-body').scrollTop = 0;
  if (animate) Anim.fadeIn($('help-body'), { y: 4, duration: 180 });
}

let closingHelp = false;
async function closeHelp() {
  if (closingHelp || $('modal').hidden) return;
  closingHelp = true;
  await Anim.modalClose($('modal'), document.querySelector('.modal-box'));
  closingHelp = false;
}

$('help-btn').onclick = () => openHelp();
for (const b of document.querySelectorAll('.help-icon')) b.onclick = () => openHelp(b.dataset.help);
$('modal-close').onclick = closeHelp;
$('modal').onclick = (e) => { if (e.target === $('modal')) closeHelp(); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modal').hidden) closeHelp();
  // F2 renomeia a reunião aberta, como no Explorador de Arquivos.
  if (e.key === 'F2' && meeting && $('modal').hidden) {
    const li = document.querySelector(`#meeting-list li[data-id="${meeting.id}"]`);
    if (li) {
      e.preventDefault();
      startRename(li, meeting);
    }
  }
});

// ---------- Início ----------
applyIcons();
initEngines();
refreshDevices();
refreshList({ animate: true });
Anim.fadeIn($('empty'), { y: 8, duration: 400 });
