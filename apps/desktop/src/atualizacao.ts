// Auto-update do PC: procura versão nova no GitHub Releases ao abrir, a cada 5 minutos
// e sempre que a janela volta a ficar em foco (no máximo 1 vez por minuto).
// Se achar, mostra uma faixa discreta; a instalação só começa quando o dono clica.
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state';

const CINCO_MINUTOS = 5 * 60 * 1000;
const UM_MINUTO = 60 * 1000;
let faixa: HTMLDivElement | null = null;
let ultimaBusca = 0;
let instalando = false;

function mostrar(update: Update) {
  faixa?.remove();
  faixa = document.createElement('div');
  faixa.className = 'faixa-update';
  faixa.innerHTML = `<span>Versão ${update.version} disponível</span><button type="button">Atualizar</button>`;
  const botao = faixa.querySelector('button')!;
  const texto = faixa.querySelector('span')!;
  botao.addEventListener('click', async () => {
    botao.disabled = true;
    instalando = true;
    // A instalação fecha o app: guarda antes o monitor, a posição e o tamanho da janela.
    await saveWindowState(StateFlags.ALL).catch(() => {});
    let total = 0;
    let baixado = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        if (ev.event === 'Progress') {
          baixado += ev.data.chunkLength;
          texto.textContent = total ? `Baixando… ${Math.round((baixado / total) * 100)}%` : 'Baixando…';
        }
        if (ev.event === 'Finished') texto.textContent = 'Instalando…';
      });
      await relaunch();
    } catch (e) {
      texto.textContent = `Falhou: ${e instanceof Error ? e.message : String(e)}`;
      botao.disabled = false;
      instalando = false;
    }
  });
  document.body.appendChild(faixa);
}

async function procurar() {
  // A faixa já está na tela (ou baixando): não precisa procurar de novo.
  if (faixa || instalando) return;
  ultimaBusca = Date.now();
  try {
    const update = await check();
    if (update && !faixa) mostrar(update);
  } catch {
    // Sem internet ou sem release ainda: tenta de novo mais tarde, em silêncio.
  }
}

export function ligarAtualizacao() {
  if (import.meta.env.DEV) return; // no `pnpm desktop` não faz sentido
  void procurar();
  setInterval(() => void procurar(), CINCO_MINUTOS);
  addEventListener('focus', () => {
    if (Date.now() - ultimaBusca > UM_MINUTO) void procurar();
  });
}
