# Granolinha

Bloco de notas de reunião para Windows, inspirado no Granola. Você anota os pontos principais durante a chamada; o app transcreve ao vivo o seu microfone ("Eu") e o áudio do computador ("Eles"); no fim, um modelo de linguagem junta suas notas com a transcrição e gera notas organizadas, com decisões e próximos passos.

- **Transcrição na nuvem ou local:** Deepgram Nova-3 (rápido, pago por minuto) ou Whisper rodando na sua GPU (grátis, o áudio não sai do computador).
- **Notas com IA local:** Ollama (padrão, `qwen3:8b`) ou Claude, se houver chave da Anthropic.
- **Escolha de dispositivos:** microfone e alto-falante capturado podem ser trocados antes ou durante a gravação.
- Pausar, retomar e encerrar a gravação; renomear e excluir reuniões; ajuda embutida.

## Requisitos

- Windows 10/11 x64
- [Node.js](https://nodejs.org) 20+
- [Go](https://go.dev) 1.21+ (para compilar a captura do áudio do sistema)
- [Ollama](https://ollama.com) com um modelo baixado: `ollama pull qwen3:8b`
- Para transcrever, pelo menos um destes:
  - uma chave do [Deepgram](https://deepgram.com) (Nova-3), ou
  - o Whisper local (veja abaixo); recomendada placa NVIDIA

## Instalação

```powershell
git clone https://github.com/bione-dev/granolinha.git
cd granolinha
npm install
npm run build:native
copy .env.example .env
```

Edite o `.env` (veja a tabela abaixo) e gere o executável com nome e ícone próprios. Isso também cria os atalhos na área de trabalho e no Menu Iniciar:

```powershell
npm run build:exe
```

Abra pelo atalho **Granolinha**. O `app-win\Granolinha.exe` carrega o código direto da pasta do projeto: alterações no código valem sem gerar de novo. Rode `build:exe` outra vez só se mover a pasta, atualizar o Electron ou trocar o ícone. Para desenvolver, `npm start` também funciona (a barra de tarefas mostra "Electron").

### Whisper local (opcional)

A pasta `whisper/` não vai para o repositório (~1,2 GB). Para usar o Whisper:

1. Baixe `whisper-cublas-12.4.0-bin-x64.zip` da release [b5130 do whisper.cpp](https://github.com/ggml-org/whisper.cpp/releases/tag/b5130) e extraia o conteúdo da pasta `Release/` em `whisper/`.
2. Baixe o modelo [`ggml-large-v3-turbo-q5_0.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin) para `whisper/models/`.

O app inicia o servidor do Whisper sozinho na primeira gravação. Sem placa NVIDIA, use o pacote `whisper-bin-x64.zip` (só processador, bem mais lento).

## Configuração (`.env`)

| Variável | Para quê |
|---|---|
| `TRANSCRIPTION_ENGINE` | Motor padrão: `nova3` (Deepgram) ou `whisper` (local). Também dá para trocar no app; a escolha fica salva |
| `DEEPGRAM_API_KEY` | Necessária só para o Nova-3 |
| `DEEPGRAM_LANGUAGE` | `multi` (padrão, mistura português e inglês) ou `pt-BR` |
| `WHISPER_LANGUAGE` | Idioma do Whisper: `pt` (padrão), `en` ou `auto` |
| `WHISPER_VAD_THRESHOLD` | Nível de volume que conta como fala (padrão `0.01`) |
| `WHISPER_SERVER_PATH`, `WHISPER_MODEL_PATH` | Caminhos alternativos para o servidor e o modelo |
| `OLLAMA_MODEL` | Modelo das notas. Sem ela, o app procura `qwen3:8b`, `qwen3:4b`, `llama3.1:8b`, `llama3.2`, nessa ordem |
| `OLLAMA_URL` | Padrão `http://127.0.0.1:11434` |
| `ANTHROPIC_API_KEY` | Opcional. Se definida, usa o Claude no lugar do Ollama |
| `GRANOLINHA_DATA_DIR` | Pasta das reuniões (padrão `Documentos\Granolinha\reunioes`) |

## Uso

**+ Nova reunião** → confira microfone e alto-falante → **● Gravar** → anote → **⏸ Pausar / ▶ Retomar** se precisar → **■ Encerrar** → **✨ Gerar notas**.

- Uma reunião encerrada não pode ser gravada de novo.
- Renomeie com o lápis, clique duplo no nome ou F2; exclua com a lixeira.
- O botão **? Ajuda** explica cada parte.
- Cada reunião é um arquivo JSON em `Documentos\Granolinha\reunioes`.

> **Use fones de ouvido.** Sem eles, o microfone capta a voz dos outros saindo dos alto-falantes e ela aparece duplicada como "Eu". O app só tem o `echoCancellation` do Chromium, que não cobre o áudio de outros programas.

## Como funciona

```
 microfone ──► AudioWorklet (16 kHz PCM) ──┐
                                           ├─► Nova-3 (WebSocket) ou Whisper (VAD + whisper-server) ──► transcrição "Eu" / "Eles"
 alto-falante ──► loopback.exe (WASAPI) ───┘
                                                     notas do usuário + transcrição ──► Ollama / Claude ──► notas organizadas
```

A ideia central, também usada pelo Granola, é **transcrever o microfone e o áudio do sistema separadamente**: assim o app sabe quem é você e quem são os outros participantes sem precisar identificar vozes. As notas que você digita servem de esqueleto, e o modelo as completa com o que foi dito.

| Arquivo | Função |
|---|---|
| `src/main.js` | Janela, sessão de gravação (pausar, retomar, encerrar), IPC |
| `native/loopback/main.go` | Captura WASAPI loopback de uma saída escolhida → PCM 16 kHz mono no stdout (Go puro, `go-wca`) |
| `src/system-audio.js` | Inicia/troca o `loopback.exe` e corta o áudio em blocos de 100 ms |
| `src/transcriber.js` | Nova-3: WebSocket do Deepgram (um por fonte de áudio) |
| `src/whisper.js` | Whisper local: inicia o `whisper-server`, corta o áudio em trechos de fala e transcreve cada um |
| `src/enhance.js` | Prompt + streaming das notas: Ollama (padrão) ou Claude |
| `src/store.js` | Uma reunião por arquivo JSON |
| `renderer/app.js` | Interface, captura do microfone, transcrição ao vivo, notas |
| `renderer/pcm-worklet.js` | Converte o áudio para PCM 16 kHz mono Int16 em blocos de 100 ms |
| `renderer/animations.js`, `icons.js`, `help.js` | Animações, ícones e conteúdo da ajuda |
| `scripts/make-exe.mjs` | Gera o `Granolinha.exe` (nome e ícone gravados com `rcedit`) e os atalhos |

### Diferenças em relação ao Granola

O Granolinha é um projeto de estudo, muito mais simples:

- Não detecta reuniões automaticamente nem se integra a calendário.
- Não tem cancelamento de eco próprio (por isso os fones).
- Guarda as reuniões em JSON sem criptografia.
- Roda tudo localmente; as chaves de API ficam no `.env` da sua máquina.

Próximos passos possíveis: criptografar as reuniões, detectar reuniões pelos programas que usam o microfone, modelos de notas e chat sobre as reuniões.

## Privacidade

- Com Whisper e Ollama, nada sai do computador.
- Com o Nova-3, o áudio vai para o Deepgram durante a gravação; com o Claude, notas e transcrição vão para a Anthropic ao gerar as notas.
- Avise os participantes de que a reunião está sendo transcrita.

## Licença

[MIT](LICENSE). Granolinha não tem relação com o Granola nem com a empresa que o desenvolve; o nome é só uma homenagem.
