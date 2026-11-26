// Repetição de tarefas. CÓPIA de packages/core/src/recorrencia.ts (o app usa aquele, a Edge Function
// usa esta); mude os dois juntos. Os testes (regras.test.ts e o do core) usam os mesmos casos.
// Datas AAAA-MM-DD, dias da semana 0 = domingo ... 6 = sábado, fuso America/Sao_Paulo.

export type Frequencia = 'diaria' | 'dias_uteis' | 'fim_de_semana' | 'semanal' | 'mensal';

export interface Recorrencia {
  freq: Frequencia;
  /** semanal: quais dias (0 = dom ... 6 = sáb) */
  dias?: number[];
  /** mensal: dia do mês (1-31; no mês curto vira o último dia) */
  dia_mes?: number;
  /** último dia da série (AAAA-MM-DD), opcional */
  ate?: string | null;
}

export const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
const NOMES_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const diaDaSemana = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay();

export function hojeSP(base = new Date()): string {
  return base.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function agoraHHMM(base = new Date()): string {
  return base.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "seg", "segunda", "segunda-feira", 1 -> 1. */
export function numeroDoDia(x: unknown): number | null {
  if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 6) return x;
  if (typeof x !== 'string') return null;
  const t = x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().slice(0, 3);
  const i = (NOMES_DIA as readonly string[]).indexOf(t);
  return i >= 0 ? i : null;
}

/** Valida e normaliza o que veio da IA ou da tela. */
export function normalizarRecorrencia(r: unknown): Recorrencia | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const freq = String(o.freq ?? o.frequencia ?? '');
  const ate = typeof o.ate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.ate) ? o.ate : null;
  if (freq === 'diaria' || freq === 'dias_uteis' || freq === 'fim_de_semana') return { freq, ate };
  if (freq === 'semanal') {
    const lista = Array.isArray(o.dias) ? o.dias : Array.isArray(o.dias_semana) ? o.dias_semana : [];
    const dias = [...new Set(lista.map(numeroDoDia).filter((n): n is number => n !== null))].sort();
    return dias.length ? { freq, dias, ate } : null;
  }
  if (freq === 'mensal') {
    const d = Number(o.dia_mes ?? o.dia_do_mes);
    return Number.isInteger(d) && d >= 1 && d <= 31 ? { freq, dia_mes: d, ate } : null;
  }
  return null;
}

function bate(r: Recorrencia, data: string): boolean {
  const dw = diaDaSemana(data);
  switch (r.freq) {
    case 'diaria': return true;
    case 'dias_uteis': return dw >= 1 && dw <= 5;
    case 'fim_de_semana': return dw === 0 || dw === 6;
    case 'semanal': return (r.dias ?? []).includes(dw);
    case 'mensal': {
      const [a, m, d] = data.split('-').map(Number) as [number, number, number];
      const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
      return d === Math.min(r.dia_mes ?? 1, ultimo);
    }
  }
}

/**
 * Próxima data da série a partir de `base`. `incluirBase` = a própria base vale.
 * Devolve null se passou do `ate`.
 */
export function proximaData(r: Recorrencia, base: string, incluirBase: boolean): string | null {
  let d = incluirBase ? base : somarDias(base, 1);
  for (let i = 0; i < 400; i++, d = somarDias(d, 1)) {
    if (r.ate && d > r.ate) return null;
    if (bate(r, d)) return d;
  }
  return null;
}

/** Primeira data de uma série criada agora (hoje só vale se a hora ainda não passou). */
export function primeiraData(r: Recorrencia, hora: string | null, agora = new Date()): string | null {
  const hoje = hojeSP(agora);
  const hojeVale = !hora || hora > agoraHHMM(agora);
  return proximaData(r, hoje, hojeVale);
}

/** Data seguinte ao concluir uma ocorrência (nunca volta para o passado). */
export function dataAposConcluir(r: Recorrencia, dataAtual: string | null, agora = new Date()): string | null {
  const hoje = hojeSP(agora);
  const base = dataAtual && dataAtual > hoje ? dataAtual : hoje;
  // Concluiu a de hoje (ou uma atrasada): a próxima é depois de hoje.
  return proximaData(r, base, false);
}

/** Texto curto: "toda seg", "seg e qua", "dias úteis", "todo dia 5". */
export function descreverRecorrencia(r: Recorrencia | null | undefined): string {
  if (!r) return '';
  switch (r.freq) {
    case 'diaria': return 'todo dia';
    case 'dias_uteis': return 'dias úteis';
    case 'fim_de_semana': return 'fins de semana';
    case 'mensal': return `todo dia ${r.dia_mes}`;
    case 'semanal': {
      const dias = r.dias ?? [];
      if (dias.length === 1) return `${dias[0] === 0 || dias[0] === 6 ? 'todo' : 'toda'} ${NOMES_LONGOS[dias[0]!]}`;
      return dias.map((d) => NOMES_DIA[d]).join(', ');
    }
  }
}

/** Data e hora em São Paulo -> instante ISO (UTC). São Paulo não tem horário de verão desde 2019: UTC-3. */
export function instanteSP(data: string, hora: string): string {
  return new Date(`${data}T${hora}:00-03:00`).toISOString();
}

/** Instante ISO -> data e hora em São Paulo. */
export function partesSP(iso: string): { data: string; hora: string } {
  const d = new Date(iso);
  return { data: hojeSP(d), hora: agoraHHMM(d) };
}
