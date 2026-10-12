// Ícones da interface (gerados no ChatGPT a partir do nosso prompt).
// Todos usam stroke="currentColor": herdam a cor do texto, então funcionam
// nos temas claro e escuro sem ajuste.
const ICON_PATHS = {
  'new-meeting': '<path d="M6.5 3.5h7l4 4v11a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"/><path d="M13.5 3.5v4h4"/><path d="M8.5 12h5"/><path d="M8.5 15.5h6.5"/><path d="M18.25 4.75v3"/><path d="M16.75 6.25h3"/>',
  record: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 6v12"/><path d="M15 6v12"/>',
  resume: '<path d="M9 7.5l7 4.5-7 4.5z"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2.25" fill="currentColor" stroke="none"/>',
  sparkles: '<path d="M12 4.5l1.8 5.7 5.7 1.8-5.7 1.8-1.8 5.7-1.8-5.7-5.7-1.8 5.7-1.8L12 4.5z"/><path d="M6.5 4.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
  trash: '<path d="M6.5 6.5h11"/><path d="M9.5 6.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1"/><path d="M8 8.5h8v8.75a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><path d="M10.5 11v5"/><path d="M13.5 11v5"/>',
  pencil: '<path d="M4.5 19.5l3.9-.8 9.4-9.4a2 2 0 0 0 0-2.8l-.9-.9a2 2 0 0 0-2.8 0l-9.4 9.4-.8 3.9z"/><path d="M13.5 6.5l4 4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M10 9.25a2.25 2.25 0 1 1 3.8 1.62c-.54.57-1.24 1.02-1.78 1.56-.55.55-.77 1.05-.77 2.07"/><path d="M12 17.25h.01"/>',
  microphone: '<rect x="9" y="3.75" width="6" height="8.5" rx="3"/><path d="M8.5 9.5v1a3.5 3.5 0 0 0 7 0v-1"/><path d="M12 14v4"/><path d="M9 20h6"/>',
  speaker: '<path d="M5.5 10h3l4-3v10l-4-3h-3z"/><path d="M16 10a3 3 0 0 1 0 4"/><path d="M18.5 8a6 6 0 0 1 0 8"/>',
  cloud: '<path d="M7.5 18h8.5a3.5 3.5 0 1 0-.65-6.94A5 5 0 0 0 6 12.25 3.25 3.25 0 0 0 7.5 18z"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><rect x="10" y="10" width="4" height="4" rx="1"/><path d="M9 4.5v2.5"/><path d="M12 4.5v2.5"/><path d="M15 4.5v2.5"/><path d="M9 17v2.5"/><path d="M12 17v2.5"/><path d="M15 17v2.5"/><path d="M4.5 9h2.5"/><path d="M4.5 12h2.5"/><path d="M4.5 15h2.5"/><path d="M17 9h2.5"/><path d="M17 12h2.5"/><path d="M17 15h2.5"/>',
  close: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
  notes: '<path d="M7 4.5h8l3 3v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z"/><path d="M15 4.5v3h3"/><path d="M8.5 10h7"/><path d="M8.5 13h7"/><path d="M8.5 16h5"/>',
  'notes-ai': '<path d="M6.5 4.5h8l3 3v10a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z"/><path d="M14.5 4.5v3h3"/><path d="M8 10h6.5"/><path d="M8 13h7"/><path d="M8 16h4.5"/><path d="M18 3.75l.55 1.7 1.7.55-1.7.55-.55 1.7-.55-1.7-1.7-.55 1.7-.55.55-1.7z"/>',
};

// Devolve o SVG de um ícone como string HTML.
function icon(name) {
  return `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

// Troca o conteúdo de um botão por ícone + texto.
function setIconLabel(el, name, text = '') {
  el.innerHTML = icon(name) + (text ? `<span>${text}</span>` : '');
}

// Preenche os elementos marcados com data-icon no HTML.
function applyIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  }
}
