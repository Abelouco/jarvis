// Tema do app no PC (Fase 4 · etapa 1): escuro, claro ou seguir o Windows.
// A escolha fica no localStorage; o index.html aplica antes da primeira pintura (sem piscar).
export type Tema = 'escuro' | 'claro' | 'windows';

const CHAVE = 'jarvis.tema';
const claroNoWindows = window.matchMedia('(prefers-color-scheme: light)');
let escolhido: Tema = 'escuro';

export function temaSalvo(): Tema {
  const t = localStorage.getItem(CHAVE);
  return t === 'claro' || t === 'windows' ? t : 'escuro';
}

function pintar() {
  const claro = escolhido === 'claro' || (escolhido === 'windows' && claroNoWindows.matches);
  document.documentElement.dataset.tema = claro ? 'claro' : 'escuro';
}

export function aplicarTema(t: Tema): void {
  escolhido = t;
  localStorage.setItem(CHAVE, t);
  pintar();
}

/** Com "seguir o Windows", troca sozinho quando o Windows muda. */
claroNoWindows.addEventListener('change', () => {
  if (escolhido === 'windows') pintar();
});

export const proximoTema = (t: Tema): Tema => (t === 'escuro' ? 'claro' : t === 'claro' ? 'windows' : 'escuro');

const NOME: Record<Tema, string> = { escuro: 'escuro', claro: 'claro', windows: 'seguir o Windows' };
const ICONE: Record<Tema, string> = { escuro: '☾', claro: '☀', windows: '◐' };

/** Liga o botão do topo: mostra o tema atual e passa para o próximo no clique. */
export function ligarBotaoTema(botao: HTMLButtonElement): void {
  const mostrar = () => {
    const t = temaSalvo();
    botao.textContent = ICONE[t];
    botao.title = `Tema: ${NOME[t]} (clique para ${NOME[proximoTema(t)]})`;
    botao.setAttribute('aria-label', botao.title);
  };
  botao.onclick = () => {
    aplicarTema(proximoTema(temaSalvo()));
    mostrar();
  };
  mostrar();
}
