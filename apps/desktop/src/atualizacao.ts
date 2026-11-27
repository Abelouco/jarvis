// Auto-update do PC: procura versão nova no GitHub Releases ao abrir, a cada 5 minutos
// e sempre que a janela volta a ficar em foco (no máximo 1 vez por minuto).
// Achou: BAIXA SOZINHO, em segundo plano, sempre a mais recente (o `latest.json` aponta para a
// última; quem ficou várias versões sem abrir pula direto para ela). Pronta, a faixa oferece
// "Reiniciar" (instalar fecha o app, então essa parte espera o clique do dono).
// Se sair uma versão ainda mais nova depois do download, ela substitui a baixada.
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state';

const CINCO_MINUTOS = 5 * 60 * 1000;
const UM_MINUTO = 60 * 1000;
let faixa: HTMLDivElement | null = null;
let ultimaBusca = 0;
let baixando = false;
let instalando = false;
/** Versão já baixada e pronta para instalar. */
let pronta: Update | null = null;

function desenharFaixa(texto: string, botao: string | null, aoClicar?: () => void) {
  if (!faixa) {
    faixa = document.createElement('div');
    faixa.className = 'faixa-update';
    document.body.appendChild(faixa);
  }
  faixa.innerHTML = `<span></span>${botao ? '<button type="button"></button>' : ''}`;
  faixa.querySelector('span')!.textContent = texto;
  const b = faixa.querySelector('button');
  if (b && botao) {
    b.textContent = botao;
    b.onclick = () => aoClicar?.();
  }
}

async function instalar() {
  if (!pronta || instalando) return;
  instalando = true;
  desenharFaixa(`Instalando a versão ${pronta.version}…`, null);
  // A instalação fecha o app: guarda antes o monitor, a posição e o tamanho da janela.
  await saveWindowState(StateFlags.ALL).catch(() => {});
  try {
    await pronta.install();
    await relaunch();
  } catch (e) {
    instalando = false;
    desenharFaixa(`Falhou ao instalar: ${e instanceof Error ? e.message : String(e)}`, 'Tentar de novo', () => void instalar());
  }
}

async function baixar(update: Update) {
  baixando = true;
  let total = 0;
  let baixado = 0;
  try {
    await update.download((ev) => {
      if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
      if (ev.event === 'Progress') {
        baixado += ev.data.chunkLength;
        // Só mostra o progresso se não houver outra versão pronta esperando o clique.
        if (!pronta) desenharFaixa(total ? `Baixando a versão ${update.version}… ${Math.round((baixado / total) * 100)}%` : `Baixando a versão ${update.version}…`, null);
      }
    });
    const antiga = pronta;
    pronta = update;
    if (antiga && antiga !== update) void antiga.close().catch(() => {});
    desenharFaixa(`Versão ${update.version} pronta`, 'Reiniciar e atualizar', () => void instalar());
  } catch {
    // Caiu a internet no meio: some a faixa (se nada estava pronto) e tenta de novo na próxima busca.
    void update.close().catch(() => {});
    if (!pronta) {
      faixa?.remove();
      faixa = null;
    }
  } finally {
    baixando = false;
  }
}

async function procurar() {
  if (baixando || instalando) return;
  ultimaBusca = Date.now();
  try {
    const update = await check();
    if (!update) return;
    if (pronta && pronta.version === update.version) {
      void update.close().catch(() => {});
      return;
    }
    await baixar(update);
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
