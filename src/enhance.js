// Notas melhoradas: junta as notas digitadas pelo usuário com a transcrição
// e pede a um LLM notas estruturadas.
//
// Provedores:
// - Ollama local (padrão): nada sai do computador.
// - Claude: usado quando ANTHROPIC_API_KEY está definida.

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
// Modelos preferidos, em ordem, caso OLLAMA_MODEL não esteja definido.
const OLLAMA_PREFERRED = ['qwen3:8b', 'qwen3:4b', 'llama3.1:8b', 'llama3.2'];
// Janela de contexto: ~1 h de reunião cabe em 16k tokens.
const OLLAMA_NUM_CTX = 16384;

const CLAUDE_MODEL = 'claude-opus-5-5';

const SYSTEM = `Você transforma anotações rápidas de reunião em notas finais claras, em português do Brasil.

Você recebe:
1. As notas que o usuário digitou durante a reunião. Elas são o esqueleto: mostram o que ele achou importante. Preserve a estrutura e os pontos dele, e complete-os com detalhes da transcrição.
2. A transcrição. Falas marcadas como "Eu" vêm do microfone do usuário; falas marcadas como "Eles" vêm do áudio do computador (os outros participantes). A transcrição automática tem erros; corrija nomes e termos pelo contexto quando der.

Escreva em Markdown:
- Um título curto com "# ".
- Seções com "## " organizadas por tema (use os temas das notas do usuário quando existirem).
- Tópicos objetivos com "- ". Destaque decisões e números com **negrito**.
- Termine com "## Próximos passos": cada item com responsável quando for possível identificar.

Não invente fatos que não estejam nas notas nem na transcrição. Se as notas estiverem vazias, baseie-se só na transcrição. Responda apenas com as notas, sem comentários antes ou depois.`;

function formatTranscript(transcript) {
  return transcript
    .map((s) => `${s.source === 'microphone' ? 'Eu' : 'Eles'}: ${s.text}`)
    .join('\n');
}

function buildUserContent(meeting) {
  return [
    `Título: ${meeting.title}`,
    `Data: ${new Date(meeting.createdAt).toLocaleString('pt-BR')}`,
    '',
    '<notas_do_usuario>',
    meeting.notes.trim() || '(vazio)',
    '</notas_do_usuario>',
    '',
    '<transcricao>',
    formatTranscript(meeting.transcript) || '(vazia)',
    '</transcricao>',
  ].join('\n');
}

// ---------- Ollama ----------
async function pickOllamaModel() {
  let tags;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    tags = await res.json();
  } catch {
    throw new Error(`Ollama não está rodando em ${OLLAMA_URL}. Abra o Ollama ou rode "ollama serve".`);
  }
  const installed = (tags.models ?? []).map((m) => m.name);
  if (process.env.OLLAMA_MODEL) {
    const wanted = process.env.OLLAMA_MODEL;
    if (!installed.some((n) => n === wanted || n === `${wanted}:latest`)) {
      throw new Error(`Modelo "${wanted}" não está instalado. Rode: ollama pull ${wanted}`);
    }
    return wanted;
  }
  for (const pref of OLLAMA_PREFERRED) {
    const hit = installed.find((n) => n === pref || n === `${pref}:latest`);
    if (hit) return hit;
  }
  if (installed.length > 0) return installed[0];
  throw new Error('Nenhum modelo no Ollama. Rode, por exemplo: ollama pull qwen3:8b');
}

async function enhanceWithOllama(meeting, onDelta) {
  const model = await pickOllamaModel();
  console.log(`[notas] provedor=ollama modelo=${model}`);
  const body = {
    model,
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUserContent(meeting) },
    ],
    options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.3 },
  };
  // Modelos com raciocínio (qwen3 etc.): desliga o "pensamento" para a resposta
  // vir direto nas notas.
  if (/qwen3|deepseek-r1|gpt-oss/.test(model)) body.think = false;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama respondeu HTTP ${res.status}: ${await res.text()}`);

  // Resposta em NDJSON: um objeto JSON por linha.
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(`Ollama: ${msg.error}`);
      const delta = msg.message?.content ?? '';
      if (delta) {
        text += delta;
        onDelta(delta);
      }
    }
  }
  return text;
}

// ---------- Claude ----------
async function enhanceWithClaude(meeting, onDelta) {
  const sdk = require('@anthropic-ai/sdk');
  const Anthropic = sdk.default || sdk;
  const client = new Anthropic(); // usa ANTHROPIC_API_KEY do ambiente
  console.log(`[notas] provedor=claude modelo=${CLAUDE_MODEL}`);

  const stream = client.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    // Se um classificador de segurança recusar, a própria API refaz o pedido
    // em outro modelo.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: buildUserContent(meeting) }],
  });

  stream.on('text', (delta) => onDelta(delta));
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error('O modelo recusou gerar as notas para esta reunião.');
  }
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

async function enhanceNotes(meeting, onDelta) {
  return process.env.ANTHROPIC_API_KEY
    ? enhanceWithClaude(meeting, onDelta)
    : enhanceWithOllama(meeting, onDelta);
}

module.exports = { enhanceNotes };
