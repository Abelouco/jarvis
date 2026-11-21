// Barra da janela própria (a do Windows foi desligada em tauri.conf: decorations false).
// Botões minimizar / maximizar / fechar no estilo do J.A.R.V.I.S.; arrastar pela faixa do topo.
import { getCurrentWindow } from '@tauri-apps/api/window';

const ICONES = {
  min: '<svg viewBox="0 0 10 10"><path d="M1 5h8"/></svg>',
  max: '<svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" rx="1"/></svg>',
  restaurar: '<svg viewBox="0 0 10 10"><rect x="1.5" y="3" width="5.5" height="5.5" rx="1"/><path d="M3.5 3V1.8h4.7v4.7H7"/></svg>',
  fechar: '<svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6"/></svg>',
};

export function montarControlesJanela() {
  // Fora do Tauri (ex.: laboratório no navegador) não há janela para controlar.
  if (!('__TAURI_INTERNALS__' in window)) return;
  const janela = getCurrentWindow();
  const caixa = document.createElement('div');
  caixa.className = 'controles-janela';
  caixa.innerHTML = `
    <button type="button" data-a="min" title="Minimizar">${ICONES.min}</button>
    <button type="button" data-a="max" title="Maximizar">${ICONES.max}</button>
    <button type="button" data-a="fechar" class="fechar" title="Fechar">${ICONES.fechar}</button>`;
  document.body.appendChild(caixa);
  document.body.classList.add('sem-moldura');

  const botaoMax = caixa.querySelector<HTMLButtonElement>('[data-a="max"]')!;
  const atualizarMax = async () => {
    const maximizada = await janela.isMaximized();
    botaoMax.innerHTML = maximizada ? ICONES.restaurar : ICONES.max;
    botaoMax.title = maximizada ? 'Restaurar' : 'Maximizar';
  };
  caixa.onclick = (e) => {
    const a = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.a;
    if (a === 'min') void janela.minimize();
    if (a === 'max') void janela.toggleMaximize();
    if (a === 'fechar') void janela.close();
  };
  void janela.onResized(() => void atualizarMax());
  void atualizarMax();
}
