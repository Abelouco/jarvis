// Regras puras do vigia de avisos (sem banco, sem rede): detectores, decisão, junção e canal.
// Testadas em decisao.test.ts. Fuso America/Sao_Paulo = UTC-3 fixo (o Brasil não tem mais horário de verão).
import { avaliarSensibilidade } from './sensivel.ts'; // cópia de ia_conversar/sensivel.ts (teste confere)
import { cumpriu, previstoNoDia, sequencia, type RegraHabito } from './habitos_regras.ts'; // idem (com recorrencia.ts)

export type Prioridade = 'urgente' | 'normal' | 'baixa';
export type Status = 'enviado' | 'segurado_silencio' | 'juntado' | 'silenciado' | 'agendado';
export type Tipo =
  | 'tarefa_atrasada' | 'lembrete_hora' | 'habito_sequencia' | 'prazo_projeto'
  | 'diario_vazio' | 'resumo_manha' | 'resumo_noite';

/** Um aviso que o vigia quer dar (ainda sem decisão). */
export interface Candidato {
  kind: Tipo;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  body: string;
  reason: string;
  priority: Prioridade;
  dedupe_key: string;
}

export interface Preferencias {
  quiet_start: string; // HH:MM ou HH:MM:SS
  quiet_end: string;
}

export interface Regra {
  kind: string;
  entity_id: string | null;
  active: boolean;
  fixed_time: string | null;
  muted_until: string | null;
}

export interface Decisao {
  status: Status | 'enviar';
  scheduled_for: string | null;
  /** por que não saiu agora (vai para o motivo) */
  nota?: string;
}

// ---------- tempo em São Paulo ----------
const FUSO_MS = 3 * 3600_000;
const hhmm = (t: string) => t.slice(0, 5);
const emMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** AAAA-MM-DD em São Paulo */
export function diaSP(d: Date): string {
  return new Date(d.getTime() - FUSO_MS).toISOString().slice(0, 10);
}
/** minutos desde 00:00 em São Paulo */
export function minutoSP(d: Date): number {
  const x = new Date(d.getTime() - FUSO_MS);
  return x.getUTCHours() * 60 + x.getUTCMinutes();
}
/** instante de `dia` às `hora` (HH:MM) em São Paulo */
export function instanteSP(dia: string, hora: string): Date {
  return new Date(`${dia}T${hhmm(hora)}:00-03:00`);
}
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** a próxima vez que o relógio de São Paulo marca `hora` (hoje, se ainda não passou; senão amanhã) */
export function proximaHora(hora: string, agora: Date): Date {
  const hoje = instanteSP(diaSP(agora), hora);
  return hoje.getTime() > agora.getTime() ? hoje : instanteSP(somarDias(diaSP(agora), 1), hora);
}
export function emSilencio(agora: Date, p: Preferencias): boolean {
  const m = minutoSP(agora);
  const s = emMin(p.quiet_start);
  const e = emMin(p.quiet_end);
  if (s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e;
}
const rotuloHora = (d: Date) => {
  const x = new Date(d.getTime() - FUSO_MS);
  return `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`;
};
const rotuloDia = (dia: string, hoje: string) => {
  if (dia === hoje) return 'hoje';
  if (dia === somarDias(hoje, -1)) return 'ontem';
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
};

// ---------- detectores ----------
export interface LembreteBD { id: string; title: string; remind_at: string; priority: string; alarm: boolean }
export interface TarefaBD { id: string; title: string; due_date: string; due_time: string | null; priority: string }

/** Lembretes cuja hora chegou nos últimos 30 min (mais antigos que isso não avisam de surpresa). */
export function detectarLembretes(lista: LembreteBD[], agora: Date): Candidato[] {
  const hoje = diaSP(agora);
  return lista
    .filter((l) => {
      const t = new Date(l.remind_at).getTime();
      return t <= agora.getTime() && t > agora.getTime() - 30 * 60_000;
    })
    .map((l) => {
      const quando = new Date(l.remind_at);
      const urgente = l.alarm || l.priority === 'alta';
      return {
        kind: 'lembrete_hora' as const,
        entity_type: 'reminders',
        entity_id: l.id,
        title: l.title,
        body: `Lembrete · ${rotuloDia(diaSP(quando), hoje)} às ${rotuloHora(quando)}`,
        reason: `Lembrete marcado para ${rotuloDia(diaSP(quando), hoje)} às ${rotuloHora(quando)}${urgente ? (l.alarm ? ', com alarme' : ', prioridade alta') : ''}.`,
        priority: urgente ? 'urgente' : 'normal',
        dedupe_key: `lembrete_hora:${l.id}:${l.remind_at}`,
      };
    });
}

/** Momento em que a tarefa passa a estar atrasada: a hora do prazo, ou o fim do dia do prazo. */
export function vencimento(t: Pick<TarefaBD, 'due_date' | 'due_time'>): Date {
  return t.due_time ? instanteSP(t.due_date, t.due_time) : instanteSP(somarDias(t.due_date, 1), '00:00');
}

/**
 * Tarefas que atrasaram nas últimas 24 h. Uma vez por prazo: se o dono mudar o prazo, pode avisar de novo.
 * As que já estavam atrasadas antes disso ficam para o resumo da manhã (não viram enxurrada).
 */
export function detectarAtrasadas(lista: TarefaBD[], agora: Date): Candidato[] {
  const hoje = diaSP(agora);
  return lista
    .filter((t) => {
      const v = vencimento(t).getTime();
      return v <= agora.getTime() && v > agora.getTime() - 24 * 3600_000;
    })
    .map((t) => {
      const prazo = `${rotuloDia(t.due_date, hoje)}${t.due_time ? ` às ${hhmm(t.due_time)}` : ''}`;
      // Urgente só com hora marcada: tarefa sem hora vence à meia-noite e não deve acordar ninguém.
      const urgente = t.priority === 'alta' && !!t.due_time;
      return {
        kind: 'tarefa_atrasada' as const,
        entity_type: 'tasks',
        entity_id: t.id,
        title: t.title,
        body: `Tarefa atrasada · prazo ${prazo}`,
        reason: `A tarefa venceu ${prazo} e não foi concluída${t.priority === 'alta' ? ' (prioridade alta)' : ''}.`,
        priority: urgente ? 'urgente' : 'normal',
        dedupe_key: `tarefa_atrasada:${t.id}:${t.due_date}${t.due_time ? `T${hhmm(t.due_time)}` : ''}`,
      };
    });
}

/** Minuto do dia (SP) a `antes` minutos do início do silêncio, sem passar de `teto` (HH:MM). */
function antesDoSilencio(p: Preferencias, antes: number, teto: string): number {
  return Math.max(0, Math.min(emMin(teto), (emMin(p.quiet_start) - antes + 1440) % 1440));
}

export interface HabitoBD extends RegraHabito { id: string; name: string; paused: boolean }
export interface RegistroBD { habit_id: string; day: string; value: number | null }

/**
 * Sequência para quebrar: hábito por dias, com 3 dias ou mais seguidos, previsto hoje e ainda não feito.
 * Sai 2 h antes do silêncio (padrão 20:00), uma vez por dia. "N vezes por semana" fica de fora:
 * a semana ainda pode ser salva amanhã.
 */
export function detectarSequencias(habitos: HabitoBD[], registros: RegistroBD[], p: Preferencias, agora: Date): Candidato[] {
  if (minutoSP(agora) < antesDoSilencio(p, 120, '21:00')) return [];
  const hoje = diaSP(agora);
  const out: Candidato[] = [];
  for (const h of habitos) {
    if (h.paused || h.times_per_week || !previstoNoDia(h, hoje)) continue;
    const doHabito = registros.filter((r) => r.habit_id === h.id);
    if (cumpriu(h, doHabito.find((r) => r.day === hoje)?.value)) continue;
    const feitos = new Set(doHabito.filter((r) => cumpriu(h, r.value)).map((r) => r.day));
    const { n } = sequencia(h, feitos, hoje);
    if (n < 3) continue;
    out.push({
      kind: 'habito_sequencia', entity_type: 'habits', entity_id: h.id,
      title: `${h.name}: ${n} dias seguidos`,
      body: 'Ainda não foi feito hoje. Dá tempo de manter a sequência.',
      reason: `O hábito está com ${n} dias seguidos e ainda não foi marcado hoje; aviso 2 h antes do silêncio.`,
      priority: 'normal',
      dedupe_key: `habito_sequencia:${h.id}:${hoje}`,
    });
  }
  return out;
}

export interface ProjetoBD { id: string; name: string; due_date: string; status: string }

/** Prazo de projeto chegando: faltando 3 dias e faltando 1 dia (um aviso em cada). */
export function detectarPrazos(projetos: ProjetoBD[], agora: Date): Candidato[] {
  const hoje = diaSP(agora);
  const out: Candidato[] = [];
  for (const pr of projetos) {
    if (pr.status === 'concluido') continue;
    const falta = [3, 1].find((n) => somarDias(hoje, n) === pr.due_date);
    if (!falta) continue;
    const quando = falta === 1 ? 'amanhã' : `em 3 dias (${rotuloDia(pr.due_date, hoje)})`;
    out.push({
      kind: 'prazo_projeto', entity_type: 'projects', entity_id: pr.id,
      title: `${pr.name}: prazo ${falta === 1 ? 'amanhã' : 'em 3 dias'}`,
      body: `Prazo do projeto ${quando}.`,
      reason: `O projeto vence ${quando} e não está concluído.`,
      priority: 'normal',
      dedupe_key: `prazo_projeto:${pr.id}:${pr.due_date}:${falta}`,
    });
  }
  return out;
}

/** Dia sem diário: às 21:30 (ou meia hora antes do silêncio, se ele começar antes), prioridade baixa. */
export function detectarDiario(temDiarioHoje: boolean, p: Preferencias, agora: Date): Candidato[] {
  if (temDiarioHoje || minutoSP(agora) < antesDoSilencio(p, 30, '21:30')) return [];
  const hoje = diaSP(agora);
  return [{
    kind: 'diario_vazio', entity_type: 'notes', entity_id: null,
    title: 'Diário de hoje em branco',
    body: 'Quer contar como foi o dia? É só me dizer, que eu anoto.',
    reason: 'Ainda não há entrada no diário de hoje.',
    priority: 'baixa',
    dedupe_key: `diario_vazio:${hoje}`,
  }];
}

// ---------- decisão ----------
/** A regra mais específica que vale para o candidato (a do item vence a do tipo). */
function regraDe(c: Candidato, regras: Regra[]) {
  const doTipo = regras.filter((r) => r.kind === c.kind);
  return {
    item: c.entity_id ? doTipo.find((r) => r.entity_id === c.entity_id) : undefined,
    tipo: doTipo.find((r) => !r.entity_id),
  };
}
const calado = (r: Regra | undefined, agora: Date) =>
  !!r && (!r.active || (!!r.muted_until && new Date(r.muted_until).getTime() > agora.getTime()));

/** Ordem: silenciado → hora fixa → silêncio (urgente fura) → enviar. */
export function decidir(c: Candidato, p: Preferencias, regras: Regra[], agora: Date): Decisao {
  const { item, tipo } = regraDe(c, regras);
  if (calado(item, agora) || calado(tipo, agora)) {
    return { status: 'silenciado', scheduled_for: null, nota: 'você pediu para não avisar disso' };
  }
  const fixa = item?.fixed_time ?? tipo?.fixed_time;
  if (fixa && minutoSP(agora) !== emMin(fixa)) {
    return { status: 'agendado', scheduled_for: proximaHora(fixa, agora).toISOString(), nota: `você pediu para avisar só às ${hhmm(fixa)}` };
  }
  if (c.priority !== 'urgente' && emSilencio(agora, p)) {
    return { status: 'segurado_silencio', scheduled_for: proximaHora(p.quiet_end, agora).toISOString(), nota: 'chegou no horário de silêncio' };
  }
  return { status: 'enviar', scheduled_for: null };
}

// ---------- junção ----------
export const JANELA_MIN = 15;
/** Tipos que nunca esperam a janela nem se juntam: hora marcada é hora marcada. */
const SEM_JUNCAO = new Set<string>(['lembrete_hora']);

export interface AvisoPronto { id: string; kind: string; title: string; body: string; priority: Prioridade }

export interface Entrega {
  /** o aviso que sai (um só, ou o "grupo" novo quando junta) */
  principal: AvisoPronto;
  /** true = principal é um aviso novo de grupo (gravar antes dos filhos) */
  grupoNovo: boolean;
  filhos: AvisoPronto[];
}

/**
 * Agrupa o que vai sair agora. Mesmo tipo (fora lembretes e urgentes) na mesma rodada vira um aviso só.
 * Se o tipo já saiu nos últimos 15 min, espera o fim da janela (devolve em `adiar`).
 */
export function juntar(
  prontos: AvisoPronto[], ultimoEnvio: Record<string, string>, agora: Date, novoId: () => string,
): { entregas: Entrega[]; adiar: { id: string; ate: string }[] } {
  const entregas: Entrega[] = [];
  const adiar: { id: string; ate: string }[] = [];
  const porTipo = new Map<string, AvisoPronto[]>();
  for (const a of prontos) {
    if (SEM_JUNCAO.has(a.kind) || a.priority === 'urgente') {
      entregas.push({ principal: a, grupoNovo: false, filhos: [] });
      continue;
    }
    const ultimo = ultimoEnvio[a.kind];
    const fim = ultimo ? new Date(ultimo).getTime() + JANELA_MIN * 60_000 : 0;
    if (fim > agora.getTime()) {
      adiar.push({ id: a.id, ate: new Date(fim).toISOString() });
      continue;
    }
    porTipo.set(a.kind, [...(porTipo.get(a.kind) ?? []), a]);
  }
  for (const [kind, xs] of porTipo) {
    if (xs.length === 1) {
      entregas.push({ principal: xs[0]!, grupoNovo: false, filhos: [] });
      continue;
    }
    const nomes = xs.slice(0, 5).map((x) => `• ${x.title}`);
    if (xs.length > 5) nomes.push(`e mais ${xs.length - 5}`);
    entregas.push({
      principal: {
        id: novoId(), kind, title: tituloGrupo(kind, xs.length), body: nomes.join('\n'),
        priority: xs.some((x) => x.priority === 'normal') ? 'normal' : 'baixa',
      },
      grupoNovo: true,
      filhos: xs,
    });
  }
  return { entregas, adiar };
}

export function tituloGrupo(kind: string, n: number): string {
  switch (kind) {
    case 'tarefa_atrasada': return `${n} tarefas atrasaram`;
    case 'habito_sequencia': return `${n} sequências de hábito em risco`;
    case 'prazo_projeto': return `${n} prazos de projeto chegando`;
    default: return `${n} avisos`;
  }
}

// ---------- texto do push ----------
/**
 * O push passa pelos servidores da Expo e do Google: sensível (saúde, documento, finanças, senha...)
 * nunca vai no texto. O aviso completo continua no banco e no app.
 */
export function textoPush(a: { title: string; body: string }): { title: string; body: string } {
  if (avaliarSensibilidade(`${a.title}\n${a.body}`).sensivel) {
    return { title: 'J.A.R.V.I.S.', body: 'Um aviso com conteúdo reservado. Abra o app para ver.' };
  }
  return { title: a.title, body: a.body };
}

// ---------- canal ----------
export interface Aparelho { platform: string; seen_at: string; push_token: string | null }
export const PC_ABERTO_MS = 2 * 60_000;

/**
 * PC aberto → PC. Senão → push no celular (etapa 2). Urgente → os dois.
 * Lembrete com o PC aberto: o próprio app já avisa (lembretes.ts), então o servidor só registra ('pc_local').
 */
export function escolherCanais(a: Pick<AvisoPronto, 'kind' | 'priority'>, aparelhos: Aparelho[], agora: Date): string[] {
  const pc = aparelhos.some((d) => d.platform === 'pc' && agora.getTime() - new Date(d.seen_at).getTime() < PC_ABERTO_MS);
  const celular = aparelhos.some((d) => d.platform === 'android' && !!d.push_token);
  const canais: string[] = [];
  if (pc) canais.push(a.kind === 'lembrete_hora' ? 'pc_local' : 'pc');
  if (celular && (!pc || a.priority === 'urgente')) canais.push('push');
  return canais;
}
