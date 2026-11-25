// Ferramentas de tarefas da IA (padrão `dominio_verbo`, herdado do Néctar).
// Fluxo: uma regra local decide se a mensagem pode ser sobre tarefas; se sim, o Groq (JSON) escolhe
// as ferramentas e os argumentos, e este arquivo executa tudo pelo cliente do usuário (RLS).
// Cada escrita gera recibo em `undo_receipts` (desfazer por 24 h); apagar, e mexer em várias de uma
// vez, pede confirmação (prévia + código `cf_…` em `pending_confirmations`).
// Os eventos em `events` saem sozinhos pelo trigger `log_entity_event` (pulso verde no núcleo).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { conversar, temChave, type MensagemIA, type NomeProvedor } from './provedores.ts';
import { normalizar } from './sensivel.ts';
import {
  dataAposConcluir, descreverRecorrencia, hojeSP, normalizarRecorrencia, numeroDoDia, primeiraData, proximaData,
  somarDias, type Recorrencia,
} from './recorrencia.ts';

export { hojeSP, somarDias };

const FUSO = 'America/Sao_Paulo';
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const PRIOS = ['alta', 'media', 'baixa'] as const;
type Prioridade = typeof PRIOS[number];

export interface Tarefa {
  id: string;
  title: string;
  notes: string | null;
  priority: Prioridade;
  due_date: string | null;
  due_time: string | null;
  done_at: string | null;
  deleted_at: string | null;
  recurrence: Recorrencia | null;
}

/** Resposta em camadas: resumo, fatos estruturados, texto pronto e ids. */
export interface ResultadoFerramenta {
  ferramenta: string;
  ok: boolean;
  resumo: string;
  fatos: Record<string, unknown>;
  texto: string;
  ids: string[];
}

export interface Acao {
  ferramenta: string;
  args: Record<string, unknown>;
}

// ---------- datas (sempre no fuso de São Paulo) ----------

const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const diaDaSemana = (data: string) => SEMANA[new Date(`${data}T12:00:00Z`).getUTCDay()]!;

/** Calendário das próximas semanas, para a IA não errar "sexta que vem". */
export function calendario(hoje: string, dias = 21): string {
  return Array.from({ length: dias }, (_, i) => {
    const d = somarDias(hoje, i);
    const rotulo = i === 0 ? ' (hoje)' : i === 1 ? ' (amanhã)' : '';
    return `${d} ${diaDaSemana(d)}${rotulo}`;
  }).join('\n');
}

export function dataValida(s: unknown): s is string {
  if (typeof s !== 'string' || !DATA.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "9" / "9h" / "09:00" / "9h30" -> "09:00" / "09:30". */
export function normalizarHora(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?:[:h](\d{2})?)?h?$/);
  if (!m) return null;
  const h = `${m[1]!.padStart(2, '0')}:${m[2] ?? '00'}`;
  return HORA.test(h) ? h : null;
}

/** Data para pessoas: "hoje", "amanhã", "sexta, 29/11". */
export function dataHumana(data: string | null, hoje: string): string {
  if (!data) return 'sem data';
  if (data === hoje) return 'hoje';
  if (data === somarDias(hoje, 1)) return 'amanhã';
  if (data === somarDias(hoje, -1)) return 'ontem';
  const [, m, d] = data.split('-');
  return `${diaDaSemana(data)}, ${d}/${m}`;
}

const quando = (t: Pick<Tarefa, 'due_date' | 'due_time' | 'recurrence'>, hoje: string) => {
  const hora = t.due_time ? ` às ${t.due_time.slice(0, 5)}` : '';
  if (t.recurrence) {
    return `${descreverRecorrencia(t.recurrence)}${hora}${t.due_date ? ` (próxima: ${dataHumana(t.due_date, hoje)})` : ''}`;
  }
  return t.due_date ? `${dataHumana(t.due_date, hoje)}${hora}` : 'sem data';
};

/**
 * A data sai daqui, nunca da IA: ela só diz "amanhã", "segunda", "daqui a 3 dias", "dia 5"
 * ou uma data completa que o dono falou. `undefined` = não falou de data.
 */
export function resolverQuando(a: Record<string, unknown>, hoje: string): string | null | undefined {
  const q = typeof a.quando === 'string' ? normalizar(a.quando).trim().replace(/\s+/g, '_') : '';
  if (q === 'hoje') return hoje;
  if (q === 'amanha') return somarDias(hoje, 1);
  if (q === 'depois_de_amanha') return somarDias(hoje, 2);
  if (q === 'sem_data' || a.data === null) return null;
  const dw = numeroDoDia(a.dia_semana);
  if (dw !== null) {
    let d = proximaData({ freq: 'semanal', dias: [dw] }, hoje, false)!;
    // "da semana que vem": se a próxima ainda cai nesta semana (até domingo), pula uma semana.
    const diasAteDomingo = (7 - new Date(`${hoje}T12:00:00Z`).getUTCDay()) % 7;
    if (a.semana_que_vem === true && d <= somarDias(hoje, diasAteDomingo)) d = somarDias(d, 7);
    return d;
  }
  const n = Number(a.daqui_dias);
  if (a.daqui_dias !== undefined && Number.isInteger(n) && n >= 0 && n <= 366) return somarDias(hoje, n);
  const dm = Number(a.dia_mes);
  if (Number.isInteger(dm) && dm >= 1 && dm <= 31) return proximaData({ freq: 'mensal', dia_mes: dm }, hoje, true);
  if (dataValida(a.data)) return a.data;
  return undefined;
}

// ---------- detector local (não gasta IA à toa) ----------

const SOBRE_TAREFAS =
  /\b(tarefas?|afazer\w*|a ?fazeres|pendenc\w*|to-?do|checklist|o que (eu )?(tenho|tem|preciso fazer)|minha (lista|agenda)|minhas (coisas|pendencias)|conclu\w*|terminei|finalizei|ja fiz|fiz a|marc\w* (a|o|como)|risc\w*|apag\w*|exclu\w*|remov\w*|desfaz\w*|adia\w*|remarc\w*|reagend\w*|muda (a|o|pra|para)|passa (a|o|pra|para)|cria (uma|a)|anota (ai|que|pra)|bota na lista|coloca na lista)\b/;
const RESPOSTA_CURTA = /^(sim|pode|confirm\w*|isso|ok|manda|vai|nao|cancel\w*|deixa|esquece)\b/;

export function pareceTarefa(texto: string, temPendente: boolean): boolean {
  const t = normalizar(texto).trim();
  if (SOBRE_TAREFAS.test(t) || EXTENSOES.some((e) => e.detector.test(t))) return true;
  return temPendente && RESPOSTA_CURTA.test(t) && t.split(/\s+/).length <= 6;
}

// ---------- achar tarefa por "nome ou id" ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VAZIAS = new Set(['a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'tarefa', 'tarefas', 'que', 'e', 'pra', 'para', 'no', 'na']);
const palavras = (s: string) => normalizar(s).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((p) => p && !VAZIAS.has(p));

/** Melhores candidatas para a referência (exata > todas as palavras > prefixo de palavra). */
export function acharPorNome<T extends Pick<Tarefa, 'id' | 'title'>>(ref: string, lista: T[]): T[] {
  const r = ref.trim();
  if (UUID.test(r)) return lista.filter((t) => t.id === r.toLowerCase());
  if (/^[0-9a-f]{6,}$/i.test(r)) {
    const porId = lista.filter((t) => t.id.startsWith(r.toLowerCase()));
    if (porId.length) return porId;
  }
  const alvo = normalizar(r);
  const exatas = lista.filter((t) => normalizar(t.title) === alvo);
  if (exatas.length) return exatas;
  const ps = palavras(r);
  if (!ps.length) return [];
  const pontuar = (t: T) => {
    const ws = palavras(t.title);
    let pts = 0;
    for (const p of ps) {
      if (ws.includes(p)) pts += 2;
      else if (ws.some((w) => w.startsWith(p) || (p.length >= 4 && p.startsWith(w) && w.length >= 4))) pts += 1;
      else return 0;
    }
    return pts;
  };
  const notas = lista.map((t) => [t, pontuar(t)] as const).filter(([, n]) => n > 0);
  const melhor = Math.max(0, ...notas.map(([, n]) => n));
  return notas.filter(([, n]) => n === melhor).map(([t]) => t);
}

// ---------- o planejador (Groq em JSON; Gemini só se não for sensível) ----------

const FERRAMENTAS = `
tarefas_criar {titulo, QUANDO?, hora?: "HH:MM", repetir?: REPETIR, prioridade?: "alta"|"media"|"baixa", notas?}
tarefas_listar {filtro: "hoje"|"atrasadas"|"proximas"|"abertas"|"concluidas"|"periodo", de?: "AAAA-MM-DD", ate?: "AAAA-MM-DD", termo?}
tarefas_concluir {refs: ["nome ou id", ...]}
tarefas_reabrir {refs: ["nome ou id", ...]}
tarefas_editar {ref: "nome ou id", titulo?, QUANDO?, hora?: "HH:MM"|null, repetir?: REPETIR|null, prioridade?, notas?}
tarefas_apagar {refs: ["nome ou id", ...]}
jarvis_confirmar {}   (o dono disse sim para a confirmação pendente)
jarvis_cancelar {}    (o dono desistiu da confirmação pendente)
jarvis_desfazer {}    (desfaz a última ação, até 24 h)

QUANDO = UM destes campos (você NUNCA calcula a data; o app calcula):
  quando: "hoje"|"amanha"|"depois_de_amanha"|"sem_data"
  dia_semana: "dom"|"seg"|"ter"|"qua"|"qui"|"sex"|"sab"   (ex.: "na segunda" -> "seg"; some semana_que_vem: true se o dono disser "da semana que vem")
  daqui_dias: número   (ex.: "daqui a 3 dias" -> 3)
  dia_mes: número      (ex.: "dia 5" sem mês -> 5)
  data: "AAAA-MM-DD"   (só quando o dono disser dia E mês, ex.: "5 de dezembro")
REPETIR (tarefa fixa) = {freq: "diaria"|"dias_uteis"|"fim_de_semana"|"semanal"|"mensal", dias_semana?: ["seg", ...] (semanal), dia_mes?: número (mensal), ate?: "AAAA-MM-DD"}`;

function promptPlanejador(hoje: string, abertas: Tarefa[], pendente: string | null) {
  const agora = new Date().toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  return [
    'Você decide se a última mensagem do dono pede uma ação nas TAREFAS (afazeres) ou nos LEMBRETES (avisos numa hora certa) dele e quais ferramentas chamar.',
    'Responda só JSON: {"acoes": [{"ferramenta": "...", "args": {...}}]}. Se a mensagem não for sobre tarefas (ex.: pergunta geral, conversa, pesquisa), responda {"acoes": []}.',
    'Ferramentas:', FERRAMENTAS, ...EXTENSOES.map((e) => e.ferramentas),
    '',
    'Regras:',
    '- NUNCA escreva a data de um dia da semana: use dia_semana. "amanhã às 9h" -> quando:"amanha", hora:"09:00". Horas HH:MM em 24 h: "8 da noite" = "20:00", "meio-dia" = "12:00". "de manhã" sem hora: não invente hora.',
    '- TAREFA FIXA: "toda/todo/todas/todos", "sempre", "cada", "diariamente", "semanalmente", "de segunda a sexta" = repetir. Ex.: "toda segunda às 20h" -> repetir:{freq:"semanal", dias_semana:["seg"]}, hora:"20:00" (sem QUANDO). "todo dia" -> diaria. "dias úteis"/"de segunda a sexta" -> dias_uteis. "toda segunda e quarta" -> semanal ["seg","qua"]. "todo dia 10" -> mensal dia_mes 10.',
    '- Título curto e limpo, começando com verbo quando der (ex.: "Comprar pão"); sem a data/hora no título.',
    '- Para concluir/editar/apagar, use o título exato da lista de tarefas abertas abaixo quando der para saber qual é (ex.: "a do mercado" -> "Ir ao mercado"). Se não der, repita as palavras do dono.',
    '- "o que tenho hoje?" -> tarefas_listar {filtro:"hoje"} (já inclui as atrasadas). "essa semana" -> periodo de hoje até domingo.',
    '- Várias tarefas numa frase = várias ações tarefas_criar.',
    ...EXTENSOES.flatMap((e) => e.regras),
    '- Não invente prioridade: só use se o dono disser (urgente/importante = alta).',
    pendente ? `- HÁ uma confirmação esperando resposta: ${pendente}. "sim/pode/confirma" -> jarvis_confirmar; "não/cancela/deixa" -> jarvis_cancelar.` : '- Não há confirmação pendente.',
    '',
    `Agora: ${hoje} ${agora} (${FUSO}).`,
    'Calendário:', calendario(hoje),
    '',
    'Tarefas abertas (título | data | hora):',
    abertas.length
      ? abertas.slice(0, 60).map((t) => `- ${t.title} | ${t.due_date ?? '-'} | ${t.due_time?.slice(0, 5) ?? '-'}${t.recurrence ? ` | ${descreverRecorrencia(t.recurrence)}` : ''}`).join('\n')
      : '(nenhuma)',
  ].join('\n');
}

export async function planejar(
  conversa: MensagemIA[], hoje: string, abertas: Tarefa[], pendente: string | null, sensivel: boolean,
): Promise<{ acoes: Acao[]; provedor: NomeProvedor | null; tokens: number }> {
  const recente = conversa.slice(-6);
  const provedores: NomeProvedor[] = sensivel ? ['groq'] : ['groq', 'gemini'];
  for (const p of provedores) {
    if (!temChave(p)) continue;
    const r = await conversar(p, [{ role: 'system', content: promptPlanejador(hoje, abertas, pendente) }, ...recente],
      { json: true, temperatura: 0, maxTokens: 700 });
    if (!r.ok) continue;
    try {
      const j = JSON.parse(r.texto.replace(/^```(json)?|```$/g, ''));
      const acoes = (Array.isArray(j?.acoes) ? j.acoes : [])
        .filter((a: Acao) => a && typeof a.ferramenta === 'string' && EXECUTORES[a.ferramenta])
        .slice(0, 10)
        .map((a: Acao) => ({ ferramenta: a.ferramenta, args: a.args && typeof a.args === 'object' ? a.args : {} }));
      return { acoes, provedor: p, tokens: r.tokens };
    } catch {
      continue;
    }
  }
  return { acoes: [], provedor: null, tokens: 0 };
}

// ---------- execução ----------

export interface Ctx {
  sb: SupabaseClient;
  hoje: string;
}

const CAMPOS = 'id, title, notes, priority, due_date, due_time, done_at, deleted_at, recurrence';

async function abertasDe(sb: SupabaseClient): Promise<Tarefa[]> {
  const { data, error } = await sb.from('tasks').select(CAMPOS)
    .is('deleted_at', null).is('done_at', null).eq('archived', false)
    .order('due_date', { ascending: true, nullsFirst: false }).limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as Tarefa[];
}

export async function carregarAbertas(sb: SupabaseClient) {
  return abertasDe(sb).catch(() => [] as Tarefa[]);
}

export async function recibo(
  sb: SupabaseClient, action: string, antes: { id: string } | null, depois: { id: string } | null, tabela = 'tasks',
) {
  const { error } = await sb.from('undo_receipts').insert({
    action, entity_type: tabela, entity_id: (depois ?? antes)?.id, before: antes, after: depois,
  });
  if (error) console.warn('tarefas: recibo não gravado', error.message);
}

export const falha = (ferramenta: string, resumo: string, fatos: Record<string, unknown> = {}): ResultadoFerramenta =>
  ({ ferramenta, ok: false, resumo, fatos, texto: resumo, ids: [] });

const linha = (t: Tarefa, hoje: string) =>
  `- **${t.title}** · ${quando(t, hoje)}${t.priority === 'alta' ? ' · prioridade alta' : ''}`;

/** Resolve várias referências; devolve as achadas e o que ficou ambíguo ou não existe. */
async function resolver(sb: SupabaseClient, refs: unknown, incluirFeitas = false) {
  const lista = (Array.isArray(refs) ? refs : [refs]).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  let base = await abertasDe(sb);
  if (incluirFeitas) {
    const { data } = await sb.from('tasks').select(CAMPOS).is('deleted_at', null).not('done_at', 'is', null)
      .order('done_at', { ascending: false }).limit(100);
    base = [...base, ...((data ?? []) as Tarefa[])];
  }
  const achadas: Tarefa[] = [];
  const ambiguas: { ref: string; opcoes: string[] }[] = [];
  const faltando: string[] = [];
  for (const ref of lista) {
    const c = acharPorNome(ref, base);
    if (c.length === 1) {
      if (!achadas.some((t) => t.id === c[0]!.id)) achadas.push(c[0]!);
    } else if (c.length > 1) ambiguas.push({ ref, opcoes: c.slice(0, 5).map((t) => t.title) });
    else faltando.push(ref);
  }
  return { achadas, ambiguas, faltando };
}

function avisoReferencias(r: { ambiguas: { ref: string; opcoes: string[] }[]; faltando: string[] }) {
  const partes: string[] = [];
  for (const a of r.ambiguas) partes.push(`"${a.ref}" bate com mais de uma: ${a.opcoes.map((o) => `**${o}**`).join(', ')}. Qual delas?`);
  if (r.faltando.length) partes.push(`Não achei tarefa aberta para ${r.faltando.map((f) => `"${f}"`).join(', ')}.`);
  return partes.join('\n');
}

export async function pedirConfirmacao(
  sb: SupabaseClient, ferramenta: string, alvo: { id: string; title: string }[], descricao: string,
): Promise<ResultadoFerramenta> {
  // Uma confirmação nova substitui a anterior que ainda não foi respondida.
  await sb.from('pending_confirmations').update({ used_at: new Date().toISOString() })
    .is('used_at', null).gt('expires_at', new Date().toISOString());
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const code = `cf_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  const ids = alvo.map((t) => t.id);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify({ ferramenta, ids }))))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const { error } = await sb.from('pending_confirmations').insert({
    code, action: ferramenta, args_hash: hash,
    preview: { ferramenta, ids, titulos: alvo.map((t) => t.title), descricao },
  });
  if (error) return falha(ferramenta, `Não consegui preparar a confirmação (${error.message}).`);
  return {
    ferramenta, ok: true, resumo: `aguardando confirmação para ${descricao}`,
    fatos: { aguardando_confirmacao: true, codigo: code, tarefas: alvo.map((t) => t.title) },
    texto: `Vou ${descricao}:\n${alvo.map((t) => `- ${t.title}`).join('\n')}\n\nConfirma? (dá para desfazer em até 24 h)`,
    ids,
  };
}

async function atualizar(ctx: Ctx, t: Tarefa, mudanca: Partial<Tarefa>, acao: string): Promise<Tarefa | null> {
  const { data, error } = await ctx.sb.from('tasks').update(mudanca).eq('id', t.id).select(CAMPOS).single();
  if (error) {
    console.warn('tarefas: update falhou', error.message);
    return null;
  }
  await recibo(ctx.sb, acao, t, data as Tarefa);
  return data as Tarefa;
}

async function concluirVarias(ctx: Ctx, alvo: Tarefa[]) {
  const agora = new Date().toISOString();
  const feitas: Tarefa[] = [];
  for (const t of alvo) {
    // Tarefa fixa: concluir esta vez leva para a próxima data (ela continua aberta).
    const proxima = t.recurrence ? dataAposConcluir(t.recurrence, t.due_date) : null;
    const nova = await atualizar(ctx, t, proxima ? { due_date: proxima } : { done_at: agora }, 'tarefas_concluir');
    if (nova) feitas.push(nova);
  }
  return feitas;
}

async function apagarVarias(ctx: Ctx, alvo: Tarefa[]) {
  const agora = new Date().toISOString();
  const apagadas: Tarefa[] = [];
  for (const t of alvo) {
    const nova = await atualizar(ctx, t, { deleted_at: agora }, 'tarefas_apagar');
    if (nova) apagadas.push(nova);
  }
  return apagadas;
}

export type Executor = (ctx: Ctx, args: Record<string, unknown>) => Promise<ResultadoFerramenta>;

const EXECUTORES: Record<string, Executor> = {
  async tarefas_criar(ctx, a) {
    const titulo = String(a.titulo ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!titulo) return falha('tarefas_criar', 'Faltou dizer qual é a tarefa.');
    const hora = normalizarHora(a.hora);
    const rec = normalizarRecorrencia(a.repetir);
    const pedida = resolverQuando(a, ctx.hoje) ?? null;
    const data = rec ? (pedida && proximaData(rec, pedida, true)) || primeiraData(rec, hora) : pedida;
    const prioridade: Prioridade = PRIOS.includes(a.prioridade as Prioridade) ? a.prioridade as Prioridade : 'media';
    // Não duplica uma tarefa aberta igual.
    const abertas = await abertasDe(ctx.sb);
    const igual = abertas.find((t) => normalizar(t.title) === normalizar(titulo) && t.due_date === data);
    if (igual) {
      return {
        ferramenta: 'tarefas_criar', ok: true, resumo: 'já existia', fatos: { ja_existia: true, tarefa: igual },
        texto: `Essa já está na lista: **${igual.title}** · ${quando(igual, ctx.hoje)}.`, ids: [igual.id],
      };
    }
    const { data: nova, error } = await ctx.sb.from('tasks').insert({
      title: titulo, priority: prioridade, due_date: data, due_time: data ? hora : null, recurrence: rec,
      notes: typeof a.notas === 'string' && a.notas.trim() ? a.notas.trim().slice(0, 2000) : null,
    }).select(CAMPOS).single();
    if (error) return falha('tarefas_criar', `Não consegui criar a tarefa (${error.message}).`);
    await recibo(ctx.sb, 'tarefas_criar', null, nova as Tarefa);
    const t = nova as Tarefa;
    return {
      ferramenta: 'tarefas_criar', ok: true, resumo: `criada "${t.title}"`, fatos: { tarefa: t },
      texto: `Anotado: **${t.title}** · ${quando(t, ctx.hoje)}${t.priority === 'alta' ? ' · prioridade alta' : ''}.${rec ? ' Ao concluir, ela passa para a próxima data.' : ''}`,
      ids: [t.id],
    };
  },

  async tarefas_listar(ctx, a) {
    const filtro = String(a.filtro ?? 'hoje');
    const { hoje } = ctx;
    let q = ctx.sb.from('tasks').select(CAMPOS).is('deleted_at', null).eq('archived', false);
    let titulo = '';
    if (filtro === 'concluidas') {
      q = q.not('done_at', 'is', null).order('done_at', { ascending: false }).limit(15);
      titulo = 'Concluídas recentemente';
    } else {
      q = q.is('done_at', null).order('due_date', { ascending: true, nullsFirst: false })
        .order('due_time', { ascending: true, nullsFirst: false }).limit(100);
      if (filtro === 'atrasadas') q = q.lt('due_date', hoje);
      else if (filtro === 'hoje') q = q.lte('due_date', hoje);
      else if (filtro === 'proximas') q = q.gt('due_date', hoje).lte('due_date', somarDias(hoje, 14));
      else if (filtro === 'periodo') {
        const de = dataValida(a.de) ? a.de : hoje;
        const ate = dataValida(a.ate) ? a.ate : de;
        q = q.gte('due_date', de).lte('due_date', ate);
        titulo = de === ate ? `Para ${dataHumana(de, hoje)}` : `De ${dataHumana(de, hoje)} a ${dataHumana(ate, hoje)}`;
      }
    }
    const { data, error } = await q;
    if (error) return falha('tarefas_listar', `Não consegui ler as tarefas (${error.message}).`);
    let lista = (data ?? []) as Tarefa[];
    if (typeof a.termo === 'string' && a.termo.trim()) lista = acharPorNome(a.termo, lista);

    const atrasadas = lista.filter((t) => t.due_date && t.due_date < hoje && !t.done_at);
    const deHoje = lista.filter((t) => t.due_date === hoje && !t.done_at);
    let texto: string;
    if (filtro === 'hoje') {
      const partes: string[] = [];
      if (atrasadas.length) partes.push(`**Atrasadas (${atrasadas.length})**\n${atrasadas.map((t) => linha(t, hoje)).join('\n')}`);
      partes.push(deHoje.length
        ? `**Hoje (${deHoje.length})**\n${deHoje.map((t) => linha(t, hoje)).join('\n')}`
        : 'Nada marcado para hoje.');
      texto = partes.join('\n\n');
    } else {
      const nomes: Record<string, string> = {
        atrasadas: 'Atrasadas', proximas: 'Próximos 14 dias', abertas: 'Tarefas abertas', concluidas: 'Concluídas recentemente',
      };
      titulo ||= nomes[filtro] ?? 'Tarefas';
      texto = lista.length
        ? `**${titulo} (${lista.length})**\n${lista.slice(0, 30).map((t) => linha(t, hoje)).join('\n')}${lista.length > 30 ? `\n- … e mais ${lista.length - 30}` : ''}`
        : `${titulo}: nenhuma tarefa.`;
    }
    return {
      ferramenta: 'tarefas_listar', ok: true,
      resumo: `${lista.length} tarefa(s)${filtro === 'hoje' ? `, ${atrasadas.length} atrasada(s)` : ''}`,
      fatos: { filtro, total: lista.length, atrasadas: atrasadas.length, hoje: deHoje.length, tarefas: lista.slice(0, 30) },
      texto, ids: lista.map((t) => t.id),
    };
  },

  async tarefas_concluir(ctx, a) {
    const r = await resolver(ctx.sb, a.refs ?? a.ref);
    const aviso = avisoReferencias(r);
    if (!r.achadas.length) return falha('tarefas_concluir', aviso || 'Qual tarefa?', r);
    if (r.achadas.length > 3) {
      const c = await pedirConfirmacao(ctx.sb, 'tarefas_concluir', r.achadas, `concluir ${r.achadas.length} tarefas`);
      if (aviso) c.texto += `\n\n${aviso}`;
      return c;
    }
    const feitas = await concluirVarias(ctx, r.achadas);
    return {
      ferramenta: 'tarefas_concluir', ok: feitas.length > 0, resumo: `${feitas.length} concluída(s)`, fatos: { concluidas: feitas, ...r },
      texto: [feitas.length
        ? `Feito: ${feitas.map((t) => `**${t.title}**${t.recurrence && !t.done_at ? ` (próxima: ${dataHumana(t.due_date, ctx.hoje)})` : ''}`).join(', ')} ✓`
        : 'Não consegui concluir.', aviso].filter(Boolean).join('\n\n'),
      ids: feitas.map((t) => t.id),
    };
  },

  async tarefas_reabrir(ctx, a) {
    const r = await resolver(ctx.sb, a.refs ?? a.ref, true);
    const alvo = r.achadas.filter((t) => t.done_at);
    if (!alvo.length) return falha('tarefas_reabrir', avisoReferencias(r) || 'Não achei tarefa concluída com esse nome.');
    const reabertas: Tarefa[] = [];
    for (const t of alvo) {
      const n = await atualizar(ctx, t, { done_at: null }, 'tarefas_reabrir');
      if (n) reabertas.push(n);
    }
    return {
      ferramenta: 'tarefas_reabrir', ok: true, resumo: `${reabertas.length} reaberta(s)`, fatos: { reabertas },
      texto: `Reaberta: ${reabertas.map((t) => `**${t.title}**`).join(', ')}.`, ids: reabertas.map((t) => t.id),
    };
  },

  async tarefas_editar(ctx, a) {
    const r = await resolver(ctx.sb, a.ref ?? (Array.isArray(a.refs) ? a.refs[0] : undefined));
    if (r.achadas.length !== 1) return falha('tarefas_editar', avisoReferencias(r) || 'Qual tarefa?', r);
    const t = r.achadas[0]!;
    const m: Partial<Tarefa> = {};
    if (typeof a.titulo === 'string' && a.titulo.trim()) m.title = a.titulo.trim().slice(0, 200);
    const pedida = resolverQuando(a, ctx.hoje);
    if (pedida === null) {
      m.due_date = null;
      m.due_time = null;
    } else if (pedida) m.due_date = pedida;
    if (a.hora === null) m.due_time = null;
    else if (a.hora !== undefined) {
      const h = normalizarHora(a.hora);
      if (h) {
        m.due_time = h;
        if (!t.due_date && !m.due_date) m.due_date = ctx.hoje;
      }
    }
    if (a.repetir === null) m.recurrence = null;
    else if (a.repetir !== undefined) {
      const rec = normalizarRecorrencia(a.repetir);
      if (rec) {
        m.recurrence = rec;
        const base = m.due_date ?? null;
        m.due_date = (base && proximaData(rec, base, true)) || primeiraData(rec, m.due_time ?? t.due_time);
      }
    }
    if (PRIOS.includes(a.prioridade as Prioridade)) m.priority = a.prioridade as Prioridade;
    if (typeof a.notas === 'string') m.notes = a.notas.trim().slice(0, 2000) || null;
    if (!Object.keys(m).length) return falha('tarefas_editar', `O que devo mudar em **${t.title}**?`);
    const nova = await atualizar(ctx, t, m, 'tarefas_editar');
    if (!nova) return falha('tarefas_editar', 'Não consegui salvar a mudança.');
    return {
      ferramenta: 'tarefas_editar', ok: true, resumo: `editada "${nova.title}"`, fatos: { antes: t, depois: nova },
      texto: `Atualizada: **${nova.title}** · ${quando(nova, ctx.hoje)}${nova.priority === 'alta' ? ' · prioridade alta' : ''}.`,
      ids: [nova.id],
    };
  },

  async tarefas_apagar(ctx, a) {
    const r = await resolver(ctx.sb, a.refs ?? a.ref, true);
    const aviso = avisoReferencias(r);
    if (!r.achadas.length) return falha('tarefas_apagar', aviso || 'Qual tarefa?', r);
    const n = r.achadas.length;
    const c = await pedirConfirmacao(ctx.sb, 'tarefas_apagar', r.achadas, n === 1 ? 'apagar esta tarefa' : `apagar ${n} tarefas`);
    if (aviso) c.texto += `\n\n${aviso}`;
    return c;
  },

  async jarvis_confirmar(ctx) {
    const { data: p } = await ctx.sb.from('pending_confirmations').select('*')
      .is('used_at', null).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!p) return falha('jarvis_confirmar', 'Não há nada esperando confirmação (ou o prazo de 10 minutos passou).');
    // Marca como usada antes de executar: o mesmo código nunca roda duas vezes.
    const { data: usada } = await ctx.sb.from('pending_confirmations').update({ used_at: new Date().toISOString() })
      .eq('code', p.code).is('used_at', null).select('code').maybeSingle();
    if (!usada) return falha('jarvis_confirmar', 'Essa confirmação já foi usada.');
    const ids: string[] = p.preview?.ids ?? [];
    const outra = EXTENSOES.find((e) => e.confirmar?.[p.action]);
    if (outra) return outra.confirmar![p.action]!(ctx, ids);
    const { data: linhas } = await ctx.sb.from('tasks').select(CAMPOS).in('id', ids).is('deleted_at', null);
    const alvo = (linhas ?? []) as Tarefa[];
    if (!alvo.length) return falha('jarvis_confirmar', 'As tarefas não existem mais.');
    const feitas = p.action === 'tarefas_apagar' ? await apagarVarias(ctx, alvo) : await concluirVarias(ctx, alvo);
    const verbo = p.action === 'tarefas_apagar' ? 'Apagada' : 'Concluída';
    return {
      ferramenta: 'jarvis_confirmar', ok: true, resumo: `${p.action}: ${feitas.length}`, fatos: { acao: p.action, tarefas: feitas },
      texto: `${verbo}${feitas.length > 1 ? 's' : ''}: ${feitas.map((t) => `**${t.title}**`).join(', ')}. Se mudar de ideia, é só dizer "desfaz".`,
      ids: feitas.map((t) => t.id),
    };
  },

  async jarvis_cancelar(ctx) {
    const { data } = await ctx.sb.from('pending_confirmations').update({ used_at: new Date().toISOString() })
      .is('used_at', null).gt('expires_at', new Date().toISOString()).select('code');
    return {
      ferramenta: 'jarvis_cancelar', ok: true, resumo: 'cancelado', fatos: { canceladas: data?.length ?? 0 },
      texto: data?.length ? 'Certo, deixei como estava.' : 'Não havia nada pendente.', ids: [],
    };
  },

  async jarvis_desfazer(ctx) {
    const { data: rec } = await ctx.sb.from('undo_receipts').select('*')
      .in('entity_type', ['tasks', 'reminders']).is('undone_at', null).eq('irreversible', false).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!rec) return falha('jarvis_desfazer', 'Não há ação recente para desfazer (o prazo é de 24 h).');
    // Ações feitas juntas (mesma confirmação) são desfeitas juntas.
    const { data: lote } = await ctx.sb.from('undo_receipts').select('*')
      .eq('entity_type', rec.entity_type).eq('action', rec.action).is('undone_at', null)
      .gte('created_at', new Date(Date.parse(rec.created_at) - 5000).toISOString());
    const recibos = (lote ?? [rec]) as typeof rec[];
    const desfeitas: string[] = [];
    for (const r of recibos) {
      const antes = r.before as Tarefa | null;
      // Volta todos os campos de antes (menos os de controle); desfazer uma criação = apagar (suave).
      const mudanca = antes
        ? Object.fromEntries(Object.entries(antes).filter(([k]) => !['id', 'user_id', 'created_at', 'updated_at', 'busca'].includes(k)))
        : { deleted_at: new Date().toISOString() };
      const { error } = await ctx.sb.from(r.entity_type).update(mudanca).eq('id', r.entity_id);
      if (error) continue;
      await ctx.sb.from('undo_receipts').update({ undone_at: new Date().toISOString() }).eq('id', r.id);
      desfeitas.push((antes ?? (r.after as Tarefa | null))?.title ?? 'tarefa');
    }
    const nome: Record<string, string> = {
      tarefas_criar: 'criação', lembretes_criar: 'criação', lembretes_concluir: 'conclusão', lembretes_apagar: 'exclusão',
      lembretes_editar: 'edição', lembretes_adiar: 'mudança', tarefas_concluir: 'conclusão', tarefas_apagar: 'exclusão', tarefas_editar: 'edição', tarefas_reabrir: 'reabertura',
    };
    return {
      ferramenta: 'jarvis_desfazer', ok: desfeitas.length > 0, resumo: `desfeita ${rec.action}`, fatos: { acao: rec.action, tarefas: desfeitas },
      texto: desfeitas.length ? `Desfiz a ${nome[rec.action] ?? 'ação'}: ${desfeitas.map((t) => `**${t}**`).join(', ')}.` : 'Não consegui desfazer.',
      ids: recibos.map((r) => r.entity_id),
    };
  },
};

/** Outros domínios (lembretes...) entram no mesmo planejador e na mesma confirmação/desfazer. */
export interface Extensao {
  ferramentas: string;
  regras: string[];
  detector: RegExp;
  executores: Record<string, Executor>;
  confirmar?: Record<string, (ctx: Ctx, ids: string[]) => Promise<ResultadoFerramenta>>;
}
const EXTENSOES: Extensao[] = [];
export function registrar(e: Extensao) {
  EXTENSOES.push(e);
  Object.assign(EXECUTORES, e.executores);
}

export async function executar(sb: SupabaseClient, acoes: Acao[], hoje = hojeSP()): Promise<ResultadoFerramenta[]> {
  const ctx: Ctx = { sb, hoje };
  const saida: ResultadoFerramenta[] = [];
  for (const a of acoes) {
    try {
      saida.push(await EXECUTORES[a.ferramenta]!(ctx, a.args));
    } catch (e) {
      saida.push(falha(a.ferramenta, `Erro ao executar (${e instanceof Error ? e.message : e}).`));
    }
  }
  return saida;
}

/** Há confirmação esperando resposta? Devolve a descrição (para o planejador). */
export async function confirmacaoPendente(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb.from('pending_confirmations').select('preview')
    .is('used_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const p = data.preview as { descricao?: string; titulos?: string[] };
  return `${p.descricao ?? 'ação'} (${(p.titulos ?? []).join(', ')})`;
}

/** Junta os textos prontos das ferramentas numa resposta só. */
export function textoFinal(resultados: ResultadoFerramenta[]): string {
  return resultados.map((r) => r.texto).filter(Boolean).join('\n\n');
}
