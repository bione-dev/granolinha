// Conteúdo da Ajuda. Cada tópico vira um item no menu lateral do modal.
const HELP_TOPICS = [
  {
    id: 'inicio',
    title: 'Primeiros passos',
    html: `
      <p>O Granolinha é um bloco de notas para reuniões. Você anota o que acha importante; ele transcreve a conversa e, no fim, junta tudo em notas organizadas.</p>
      <ol>
        <li>Clique em <b>${icon('new-meeting')}Nova reunião</b>, confira o microfone e o alto-falante e clique em <b>${icon('record')}Gravar</b> quando a reunião começar.</li>
        <li>Escreva tópicos curtos em <b>Minhas notas</b> enquanto a reunião acontece. A transcrição aparece à direita.</li>
        <li>No fim, clique em <b>${icon('stop')}Encerrar</b> e depois em <b>${icon('sparkles')}Gerar notas</b>.</li>
      </ol>
      <p>Na transcrição, <b class="me">Eu</b> é o seu microfone e <b class="them">Eles</b> é o som do computador (os outros participantes).</p>
      <p><b>Renomear ou excluir</b>: passe o mouse sobre a reunião na lista e use ${icon('pencil')} ou ${icon('trash')}. Também dá para renomear com clique duplo no nome ou com a tecla <b>F2</b> (reunião aberta).</p>`,
  },
  {
    id: 'gravacao',
    title: 'Gravar, pausar e encerrar',
    html: `
      <ul>
        <li><b>${icon('record')}Gravar</b>: começa a transcrever. Só aparece em reuniões que ainda não foram gravadas.</li>
        <li><b>${icon('pause')}Pausar</b>: para de ouvir temporariamente (um intervalo, um assunto privado). Nada é transcrito enquanto estiver pausado. Clique em <b>${icon('resume')}Retomar</b> para continuar na mesma reunião.</li>
        <li><b>${icon('stop')}Encerrar</b>: finaliza a gravação de vez. <b>Uma reunião encerrada não pode ser gravada de novo</b>; para outra conversa, crie uma nova reunião.</li>
      </ul>
      <p>Clicar em <b>${icon('sparkles')}Gerar notas</b> durante a gravação também a encerra (o app pede confirmação).</p>`,
  },
  {
    id: 'dispositivos',
    title: 'Microfone e alto-falante',
    html: `
      <ul>
        <li><b>${icon('microphone')}Microfone</b>: de onde vem a sua voz (<b class="me">Eu</b>).</li>
        <li><b>${icon('speaker')}Alto-falante</b>: a saída de som que o app escuta para captar os outros participantes (<b class="them">Eles</b>). Escolha a mesma saída em que você ouve a reunião: o fone, se estiver de fone.</li>
      </ul>
      <p>Os dois podem ser trocados <b>antes ou durante</b> a gravação; a troca vale na hora, sem perder o que já foi transcrito. A escolha fica salva para as próximas reuniões.</p>
      <p>As barrinhas ao lado dos botões mostram o volume de cada fonte. Se uma delas ficar parada enquanto alguém fala, o dispositivo escolhido provavelmente não é o certo.</p>
      <p><b>Use fone de ouvido.</b> Sem ele, o microfone capta a voz dos outros saindo das caixas de som, e ela aparece duplicada como "Eu".</p>`,
  },
  {
    id: 'motores',
    title: 'Motores de transcrição',
    html: `
      <table>
        <tr><th></th><th>Nova-3 (nuvem)</th><th>Whisper (local)</th></tr>
        <tr><td>Onde roda</td><td>Servidores do Deepgram</td><td>Na sua placa de vídeo</td></tr>
        <tr><td>Custo</td><td>Pago por minuto de áudio</td><td>Grátis</td></tr>
        <tr><td>Privacidade</td><td>O áudio é enviado ao Deepgram</td><td>O áudio não sai do computador</td></tr>
        <tr><td>Velocidade</td><td>Quase instantâneo</td><td>Frase final ~1 s após a pausa</td></tr>
        <tr><td>Idiomas</td><td>Português e inglês misturados</td><td>Um idioma por vez (português por padrão)</td></tr>
      </table>
      <p>O motor é escolhido antes de gravar e fica travado durante a gravação. Um motor marcado como "não instalado" ou "sem chave" precisa ser configurado no arquivo <code>.env</code> (veja o README).</p>`,
  },
  {
    id: 'notas',
    title: 'Notas com IA',
    html: `
      <p><b>${icon('sparkles')}Gerar notas</b> envia suas anotações e a transcrição para um modelo de linguagem, que devolve notas organizadas por tema, com decisões destacadas e uma lista de próximos passos.</p>
      <ul>
        <li>Suas notas são o esqueleto: o modelo mantém os tópicos que você escreveu e os completa com o que foi dito.</li>
        <li>Por padrão, roda localmente no <b>Ollama</b> (modelo <code>qwen3:8b</code>). O Ollama precisa estar aberto.</li>
        <li>Se houver uma chave da Anthropic no <code>.env</code>, o Claude é usado no lugar.</li>
      </ul>
      <p>Você pode gerar de novo quantas vezes quiser; o resultado anterior é substituído.</p>`,
  },
  {
    id: 'privacidade',
    title: 'Privacidade e dados',
    html: `
      <ul>
        <li>As reuniões ficam em <code>Documentos\\Granolinha\\reunioes</code>, um arquivo por reunião. Não são enviadas a nenhum servidor.</li>
        <li>Com o <b>Whisper</b> e o <b>Ollama</b>, nada sai do computador.</li>
        <li>Com o <b>Nova-3</b>, o áudio vai para o Deepgram durante a gravação. Com o <b>Claude</b>, notas e transcrição vão para a Anthropic ao gerar as notas.</li>
        <li>O app registra um log técnico (incluindo as frases transcritas) na pasta temporária do Windows.</li>
      </ul>
      <p>Avise os participantes de que a reunião está sendo transcrita.</p>`,
  },
  {
    id: 'problemas',
    title: 'Problemas comuns',
    html: `
      <dl>
        <dt>Não aparece nada em "Eles"</dt>
        <dd>Confira se o ${icon('speaker')}alto-falante escolhido é o mesmo em que você está ouvindo a reunião.</dd>
        <dt>Não aparece nada em "Eu"</dt>
        <dd>Confira o ${icon('microphone')}microfone escolhido e se ele não está mudo no Windows.</dd>
        <dt>Minha fala aparece também como "Eles" (ou vice-versa)</dt>
        <dd>É eco das caixas de som. Use fone de ouvido.</dd>
        <dt>"Erro na transcrição"</dt>
        <dd>No Nova-3, verifique a internet e a chave do Deepgram. No Whisper, o primeiro uso leva alguns segundos para carregar o modelo.</dd>
        <dt>"Gerar notas" falha</dt>
        <dd>Abra o Ollama e tente de novo.</dd>
      </dl>`,
  },
];
