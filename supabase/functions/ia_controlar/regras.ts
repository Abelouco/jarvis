// Regras puras do modo controle (Fase 4 · etapa 8). Sem rede: o teste roda no Node.
// O texto da tela chega como dado. Quem decide o perigo é o modelo; aqui só se valida o plano.
import { normalizar } from '../ia_conversar/sensivel.ts';

export type Passo =
  | { acao: 'clicar'; alvo_id?: string; x?: number; y?: number; duplo?: boolean; direito?: boolean }
  | { acao: 'digitar'; texto: string }
  | { acao: 'tecla'; combinacao: string }
  | { acao: 'rolar'; direcao: 'cima' | 'baixo'; quantidade: number }
  | { acao: 'esperar'; ms: number }
  | { acao: 'abrir'; alvo: string }
  | { acao: 'pronto'; resumo: string }
  | { acao: 'pedir_dono'; motivo: string };

export interface Plano {
  pensamento: string;
  perigo: string | null;
  passos: Passo[];
}

const MODIFICADORES = ['ctrl', 'alt', 'shift', 'win'] as const;
const TECLAS = new Set<string>([
  'enter', 'esc', 'tab', 'backspace', 'delete', 'espaco',
  'cima', 'baixo', 'esquerda', 'direita', 'home', 'end', 'pageup', 'pagedown',
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  ...'0123456789'.split(''),
]);

const PASTAS: Record<string, string> = {
  downloads: '%USERPROFILE%\\Downloads',
  download: '%USERPROFILE%\\Downloads',
  documentos: '%USERPROFILE%\\Documents',
  documents: '%USERPROFILE%\\Documents',
  'meus documentos': '%USERPROFILE%\\Documents',
  'area de trabalho': '%USERPROFILE%\\Desktop',
  desktop: '%USERPROFILE%\\Desktop',
};
const EXT_ARQUIVO = /\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|pptx?|txt|mp[34]|exe|lnk|zip|csv)$/i;

function limparAlvo(bruto: string): string {
  let s = bruto.trim().replace(/^["']+|["']+$/g, '').trim();
  let anterior = '';
  while (s && s !== anterior) {
    anterior = s;
    s = s
      .replace(/^(pasta|programa|aplicativo|app|site|pagina)\s+/i, '')
      .replace(/^(o|a|os|as|um|uma)\s+/i, '')
      .trim();
  }
  return s;
}

/** Cópia de `classificarAlvo` da etapa 7 (`ia_conversar/computador.ts`). */
function classificarAlvo(alvo: string): { tipo: 'url' | 'caminho' | 'programa'; valor: string } {
  const original = alvo.trim();
  if (!original) return { tipo: 'programa', valor: '' };
  if (/^https?:\/\//i.test(original)) return { tipo: 'url', valor: original };
  const s = limparAlvo(original);
  if (!s) return { tipo: 'programa', valor: '' };
  const chave = normalizar(s).replace(/\s+/g, ' ');
  const pasta = PASTAS[chave];
  if (pasta) return { tipo: 'caminho', valor: pasta };
  if (/^[a-z]:[\\/]/i.test(s) || s.startsWith('\\\\') || s.startsWith('/') || s.includes('\\')) {
    return { tipo: 'caminho', valor: s };
  }
  if (!EXT_ARQUIVO.test(s) && /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[\/?#]\S*)?$/i.test(s)) {
    return { tipo: 'url', valor: `https://${s}` };
  }
  return { tipo: 'programa', valor: s };
}

/** Minúsculas, sem espaços, modificadores na ordem ctrl, alt, shift, win, e a tecla no fim. */
export function normalizarCombinacao(bruta: string): string | null {
  const partes = bruta.toLowerCase().replace(/\s+/g, '').split('+').filter(Boolean);
  if (!partes.length) return null;
  const mods: string[] = [];
  const teclas: string[] = [];
  for (const p of partes) {
    if ((MODIFICADORES as readonly string[]).includes(p)) mods.push(p);
    else teclas.push(p);
  }
  if (teclas.length !== 1 || !TECLAS.has(teclas[0]!)) return null;
  const ordem = MODIFICADORES.filter((m) => mods.includes(m));
  return [...ordem, teclas[0]].join('+');
}

export function combinacaoProibida(combinacao: string): boolean {
  const n = normalizarCombinacao(combinacao);
  return n === 'win+r' || n === 'win+x' || n === 'ctrl+shift+esc';
}

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function passoValido(bruto: unknown, tela: { largura: number; altura: number }): Passo | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const p = bruto as Record<string, unknown>;
  const acao = typeof p.acao === 'string' ? p.acao : '';
  if (acao === 'clicar') {
    const alvo = texto(p.alvo_id, 20);
    const x = typeof p.x === 'number' && Number.isFinite(p.x) ? Math.round(p.x) : undefined;
    const y = typeof p.y === 'number' && Number.isFinite(p.y) ? Math.round(p.y) : undefined;
    const coordsOk = x !== undefined && y !== undefined
      && x >= 0 && y >= 32 && x < tela.largura && y < tela.altura;
    if (!alvo && !coordsOk) return null;
    const passo: Extract<Passo, { acao: 'clicar' }> = { acao: 'clicar' };
    if (alvo) passo.alvo_id = alvo;
    if (coordsOk) {
      passo.x = x;
      passo.y = y;
    }
    if (p.duplo === true) passo.duplo = true;
    if (p.direito === true) passo.direito = true;
    return passo;
  }
  if (acao === 'digitar') {
    const t = texto(p.texto, 500);
    return t ? { acao: 'digitar', texto: t } : null;
  }
  if (acao === 'tecla') {
    const combinacao = normalizarCombinacao(typeof p.combinacao === 'string' ? p.combinacao : '');
    if (!combinacao || combinacaoProibida(combinacao)) return null;
    return { acao: 'tecla', combinacao };
  }
  if (acao === 'rolar') {
    const direcao = p.direcao === 'cima' || p.direcao === 'baixo' ? p.direcao : null;
    const q = typeof p.quantidade === 'number' && Number.isFinite(p.quantidade) ? Math.round(p.quantidade) : NaN;
    if (!direcao || q < 1 || q > 10) return null;
    return { acao: 'rolar', direcao, quantidade: q };
  }
  if (acao === 'esperar') {
    const ms = typeof p.ms === 'number' && Number.isFinite(p.ms) ? Math.round(p.ms) : NaN;
    if (ms < 100 || ms > 5000) return null;
    return { acao: 'esperar', ms };
  }
  if (acao === 'abrir') {
    const cls = classificarAlvo(texto(p.alvo, 2000));
    return cls.valor ? { acao: 'abrir', alvo: cls.valor } : null;
  }
  if (acao === 'pronto') {
    const resumo = texto(p.resumo, 200);
    return resumo ? { acao: 'pronto', resumo } : null;
  }
  if (acao === 'pedir_dono') {
    const motivo = texto(p.motivo, 200);
    return motivo ? { acao: 'pedir_dono', motivo } : null;
  }
  return null;
}

const PEDIR: Passo = { acao: 'pedir_dono', motivo: 'Não entendi o que fazer na tela.' };

/** Aceita no máximo 8 passos e descarta os inválidos, sem lançar erro. */
export function validarPlano(bruto: unknown, tela: { largura: number; altura: number }): Plano {
  const vazio: Plano = { pensamento: '', perigo: null, passos: [PEDIR] };
  if (!bruto || typeof bruto !== 'object') return vazio;
  const o = bruto as Record<string, unknown>;
  const pensamento = texto(o.pensamento, 400);
  const perigoBruto = texto(o.perigo, 200);
  const perigo = perigoBruto ? perigoBruto : null;
  const lista = Array.isArray(o.passos) ? o.passos : [];
  const passos: Passo[] = [];
  for (const item of lista) {
    if (passos.length >= 8) break;
    const passo = passoValido(item, tela);
    if (passo) passos.push(passo);
  }
  return { pensamento, perigo, passos: passos.length ? passos : [PEDIR] };
}
