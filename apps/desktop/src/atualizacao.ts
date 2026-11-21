// Auto-update do PC: ao abrir, procura versão nova no GitHub Releases.
// Se achar, mostra uma faixa discreta; a instalação só começa quando o dono clica.
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const SEIS_HORAS = 6 * 60 * 60 * 1000;
let faixa: HTMLDivElement | null = null;

function mostrar(update: Update) {
  faixa?.remove();
  faixa = document.createElement('div');
  faixa.className = 'faixa-update';
  faixa.innerHTML = `<span>Versão ${update.version} disponível</span><button type="button">Atualizar</button>`;
  const botao = faixa.querySelector('button')!;
  const texto = faixa.querySelector('span')!;
  botao.addEventListener('click', async () => {
    botao.disabled = true;
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
    }
  });
  document.body.appendChild(faixa);
}

async function procurar() {
  try {
    const update = await check();
    if (update) mostrar(update);
  } catch {
    // Sem internet ou sem release ainda: tenta de novo mais tarde, em silêncio.
  }
}

export function ligarAtualizacao() {
  if (import.meta.env.DEV) return; // no `pnpm desktop` não faz sentido
  void procurar();
  setInterval(() => void procurar(), SEIS_HORAS);
}
