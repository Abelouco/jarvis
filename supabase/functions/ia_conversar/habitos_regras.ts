// Regras dos hábitos. CÓPIA de packages/core/src/habitos.ts (o app usa aquela, a Edge Function esta); mude os dois juntos.
// Funções puras: sequência, semana, mês, id do registro do dia. Datas AAAA-MM-DD, semana de segunda a domingo.
import { diaDaSemana, NOMES_DIA, somarDias } from './recorrencia.ts';

export type TipoHabito = 'boolean' | 'duration' | 'quantity';

export interface RegraHabito {
  kind: TipoHabito;
  daily_target: number | null;
  unit?: string | null;
  /** 0 = domingo ... 6 = sábado; nulo ou vazio = todo dia */
  weekdays: number[] | null;
  /** "N vezes por semana", em qualquer dia; tem precedência sobre `weekdays` */
  times_per_week: number | null;
}

/** id do registro de um hábito num dia: o mesmo em qualquer aparelho e no servidor. */
export function idRegistro(habitId: string, dia: string): string {
  const texto = `${habitId}:${dia}`;
  let hex = '';
  for (const semente of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]) {
    let h = semente >>> 0;
    for (let i = 0; i < texto.length; i++) {
      h ^= texto.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12;
    hex += (h >>> 0).toString(16).padStart(8, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** O hábito conta neste dia? (por vezes na semana, qualquer dia conta) */
export function previstoNoDia(h: RegraHabito, dia: string): boolean {
  if (h.times_per_week) return true;
  if (!h.weekdays || !h.weekdays.length) return true;
  return h.weekdays.includes(diaDaSemana(dia));
}

/** O valor do dia cumpre o hábito? Sim/não: qualquer registro. Minutos/quantidade: chegou à meta do dia. */
export function cumpriu(h: RegraHabito, valor: number | null | undefined): boolean {
  if (valor == null) return false;
  if (h.kind === 'boolean' || !h.daily_target || h.daily_target <= 0) return valor > 0;
  return valor >= h.daily_target;
}

/** Segunda-feira da semana do dia. */
export function inicioSemana(dia: string): string {
  return somarDias(dia, -((diaDaSemana(dia) + 6) % 7));
}

/**
 * Sequência atual. Por dias: dias previstos seguidos cumpridos (hoje ainda em aberto não quebra).
 * Por vezes na semana: semanas seguidas que bateram a meta (a semana atual só conta quando bate).
 */
export function sequencia(h: RegraHabito, feitos: Set<string>, hoje: string): { n: number; unidade: 'dias' | 'semanas' } {
  if (h.times_per_week) {
    let n = 0;
    let w = inicioSemana(hoje);
    for (let i = 0; i < 104; i++, w = somarDias(w, -7)) {
      let c = 0;
      for (let d = 0; d < 7; d++) if (feitos.has(somarDias(w, d))) c++;
      if (c >= h.times_per_week) n++;
      else if (i > 0) break;
    }
    return { n, unidade: 'semanas' };
  }
  let n = 0;
  let d = feitos.has(hoje) ? hoje : somarDias(hoje, -1);
  for (let i = 0; i < 800; i++, d = somarDias(d, -1)) {
    if (!previstoNoDia(h, d)) continue;
    if (!feitos.has(d)) break;
    n++;
  }
  return { n, unidade: 'dias' };
}

/** Vezes cumpridas nesta semana e a meta da semana. */
export function semana(h: RegraHabito, feitos: Set<string>, hoje: string): { feitas: number; meta: number } {
  const w = inicioSemana(hoje);
  let feitas = 0;
  let previstos = 0;
  for (let d = 0; d < 7; d++) {
    const dia = somarDias(w, d);
    if (feitos.has(dia)) feitas++;
    if (previstoNoDia(h, dia)) previstos++;
  }
  return { feitas, meta: h.times_per_week ?? previstos };
}

/** Vezes cumpridas no mês do dia. */
export function vezesNoMes(feitos: Set<string>, hoje: string): number {
  const mes = hoje.slice(0, 7);
  let n = 0;
  for (const d of feitos) if (d.startsWith(mes) && d <= hoje) n++;
  return n;
}

/** "todo dia", "dias úteis", "seg, qua, sex", "3x por semana". */
export function descreverFrequencia(h: RegraHabito): string {
  if (h.times_per_week) return `${h.times_per_week}x por semana`;
  const ds = [...new Set(h.weekdays ?? [])].sort();
  if (!ds.length || ds.length === 7) return 'todo dia';
  if (ds.join() === '1,2,3,4,5') return 'dias úteis';
  if (ds.join() === '0,6') return 'fins de semana';
  return ds.map((d) => NOMES_DIA[d]).join(', ');
}

/** "30 min", "8 copos", "" (sim/não). */
export function descreverMeta(h: RegraHabito): string {
  if (h.kind === 'boolean' || !h.daily_target) return '';
  if (h.kind === 'duration') return `${h.daily_target} min`;
  return `${h.daily_target}${h.unit ? ` ${h.unit}` : ''}`;
}
