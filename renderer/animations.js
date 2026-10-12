// Animações da interface (Web Animations API, sem dependências).
// Respeita "Mostrar animações" desligado no Windows (prefers-reduced-motion):
// nesse caso tudo acontece na hora, sem movimento.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const EASE_OUT = 'cubic-bezier(.2, .7, .2, 1)';

function animate(el, keyframes, options = {}) {
  if (!el || reduceMotion.matches || !el.animate) return Promise.resolve();
  return el
    .animate(keyframes, { duration: 220, easing: EASE_OUT, ...options })
    .finished.catch(() => {}); // animação cancelada não é erro
}

const Anim = {
  // Surge subindo levemente.
  fadeIn(el, { y = 6, duration = 220, delay = 0 } = {}) {
    return animate(el, [
      { opacity: 0, transform: `translateY(${y}px)` },
      { opacity: 1, transform: 'none' },
    ], { duration, delay, fill: 'backwards' });
  },

  fadeOut(el, { y = 4, duration = 160 } = {}) {
    return animate(el, [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: `translateY(${y}px)` },
    ], { duration, easing: 'ease-in', fill: 'forwards' });
  },

  // Vários elementos em sequência (lista lateral ao abrir o app).
  stagger(elements, { step = 35, max = 12 } = {}) {
    [...elements].forEach((el, i) => Anim.fadeIn(el, { delay: Math.min(i, max) * step }));
  },

  // Encolhe até sumir (item excluído da lista).
  collapse(el) {
    const h = el.getBoundingClientRect().height;
    el.style.overflow = 'hidden';
    return animate(el, [
      { opacity: 1, height: `${h}px`, transform: 'none' },
      { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', minHeight: '0px', transform: 'translateX(-12px)' },
    ], { duration: 220, easing: 'ease-in', fill: 'forwards' });
  },

  // "Pulo" curto para chamar atenção (selo de gravação, botão).
  pop(el) {
    return animate(el, [
      { transform: 'scale(.85)', opacity: 0 },
      { transform: 'scale(1.06)', opacity: 1, offset: .6 },
      { transform: 'scale(1)' },
    ], { duration: 320 });
  },

  // Balança de leve (ação recusada, ex.: trocar de reunião gravando).
  shake(el) {
    return animate(el, [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(5px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(0)' },
    ], { duration: 300, easing: 'ease-in-out' });
  },

  // Modal: fundo escurece e a caixa cresce a partir de 96%.
  async modalOpen(overlay, box) {
    overlay.hidden = false;
    await Promise.all([
      animate(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 }),
      animate(box, [
        { opacity: 0, transform: 'translateY(10px) scale(.96)' },
        { opacity: 1, transform: 'none' },
      ], { duration: 240 }),
    ]);
  },

  async modalClose(overlay, box) {
    await Promise.all([
      animate(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in' }),
      animate(box, [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(6px) scale(.98)' },
      ], { duration: 160, easing: 'ease-in' }),
    ]);
    overlay.hidden = true;
  },
};

// Esqueleto "carregando" para o painel de notas melhoradas, enquanto o
// modelo ainda não devolveu nenhum texto.
function skeletonHTML() {
  const widths = [55, 92, 84, 70, 40, 88, 76, 62];
  return `<div class="skeleton">${widths
    .map((w, i) => `<span style="width:${w}%;${i === 0 ? 'height:18px;margin-bottom:18px' : ''}"></span>`)
    .join('')}</div>`;
}
