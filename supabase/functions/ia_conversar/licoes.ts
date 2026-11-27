// Lições (Fase 4 · Etapa 3): o like e o deslike do dono viram regras curtas que entram no prompt.
// - Deslike (com o motivo): o Groq escreve uma lição "evitar" (o que não fazer e o que fazer no lugar).
// - Likes: a cada 3 likes novos, o Groq procura um jeito de responder em comum e escreve uma lição "manter".
// - Acima de TETO lições ativas, o Groq junta as parecidas.
// - Pela conversa: licoes_listar, licoes_esquecer, licoes_ensinar (com recibo para desfazer).
// O like/deslike chega pela tela (corpo `feedback` em ia_conversar), não pela conversa.
// Sensível: lição tirada de conversa sensível é marcada e nunca vai para o Gemini; tudo aqui usa só o Groq.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { conversar } from './provedores.ts';
import { avaliarSensibilidade } from './sensivel.ts';
import { acharPorNome, falha, recibo, registrar, type ResultadoFerramenta } from './tarefas.ts';

export const ESCOPOS = ['geral', 'tarefas', 'lembretes', 'projetos', 'avisos', 'pesquisa'] as const;
export type Escopo = typeof ESCOPOS[number];
export type TipoLicao = 'evitar' | 'manter';
export const TETO = 25;

export interface Licao {
  id: string;
  lesson: string;
  kind: TipoLicao;
  scope: Escopo;
  active: boolean;
  hits: number;
  sensitive: boolean;
  created_at: string;
  source_feedback_id: string | null;
  deleted_at?: string | null;
}
const CAMPOS = 'id, lesson, kind, scope, active, hits, sensitive, created_at, source_feedback_id, deleted_at';

export async function licoesAtivas(sb: SupabaseClient): Promise<Licao[]> {
  const { data } = await sb.from('assistant_lessons').select(CAMPOS)
    .eq('active', true).is('deleted_at', null).order('created_at', { ascending: true }).limit(60);
  return (data ?? []) as Licao[];
}

/**
 * Bloco do prompt com as lições dos escopos pedidos. `semSensivel`: a chamada pode ir para o Gemini,
 * então as lições sensíveis ficam de fora. Devolve o texto e os ids (para contar o uso).
 */
export function blocoLicoes(ls: Licao[], escopos: readonly string[], semSensivel: boolean): { texto: string; ids: string[] } {
  const usadas = ls.filter((l) => l.active && escopos.includes(l.scope) && !(semSensivel && l.sensitive));
  if (!usadas.length) return { texto: '', ids: [] };
  const linha = (l: Licao) => `- ${l.kind === 'evitar' ? 'EVITE' : 'MANTENHA'}${l.scope !== 'geral' ? ` (${l.scope})` : ''}: ${l.lesson}`;
  return {
    texto: ['O QUE O DONO TE ENSINOU (pelo like/deslike; siga sempre, vale mais que o estilo padrão acima):', ...usadas.map(linha)].join('\n'),
    ids: usadas.map((l) => l.id),
  };
}

/** Resposta do Groq -> lição válida (ou null). */
export function normalizarLicao(j: unknown): { lesson: string; scope: Escopo; frase: string } | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  const lesson = String(o.licao ?? o.lesson ?? '').trim().replace(/\s+/g, ' ').slice(0, 400);
  if (lesson.length < 3) return null;
  const esc = String(o.escopo ?? o.scope ?? 'geral').trim().toLowerCase();
  const scope = (ESCOPOS as readonly string[]).includes(esc) ? esc as Escopo : 'geral';
  const frase = String(o.frase ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
  return { lesson, scope, frase };
}

const lerJson = (t: string) => JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, ''));

const ESCOPO_TXT = 'escopo: "geral" (jeito de conversar/responder), ou "tarefas", "lembretes", "projetos", "avisos" (quando é sobre agir nesses itens), ou "pesquisa" (respostas com pesquisa na web)';

async function escreverEvitar(pergunta: string, resposta: string, motivo: string, manter: Licao[]) {
  const r = await conversar('groq', [
    {
      role: 'system', content: [
        'Você ajuda o assistente J.A.R.V.I.S. a aprender com uma crítica do dono. Leia a pergunta, a resposta criticada e o motivo do dono.',
        'Escreva UMA lição curta e acionável (máx. 2 frases, em português do Brasil, no imperativo, para o próprio assistente): o que não fazer e o que fazer no lugar. Geral o bastante para valer em casos parecidos, sem citar detalhes que só valem para esta conversa.',
        'Não contradiga o que o dono já aprovou (lista MANTER abaixo); se o motivo parecer contradizer, escreva a lição de um jeito compatível.',
        `Responda só JSON: {"licao": "...", "escopo": "...", "frase": "Entendido, Senhor: ..."} (${ESCOPO_TXT}). "frase" é a confirmação ao dono em UMA linha, começando com "Entendido, Senhor:".`,
        manter.length ? `MANTER (aprovado pelo dono):\n${manter.map((l) => `- ${l.lesson}`).join('\n')}` : '',
      ].filter(Boolean).join('\n'),
    },
    { role: 'user', content: `PERGUNTA DO DONO:\n${pergunta.slice(0, 1500)}\n\nRESPOSTA CRITICADA:\n${resposta.slice(0, 3000)}\n\nMOTIVO DO DONO:\n${motivo}` },
  ], { json: true, temperatura: 0.2, maxTokens: 400 });
  if (!r.ok) throw new Error(r.erro);
  return normalizarLicao(lerJson(r.texto));
}

async function escreverManter(pares: { pergunta: string; resposta: string }[], existentes: Licao[]) {
  const r = await conversar('groq', [
    {
      role: 'system', content: [
        'O dono do assistente J.A.R.V.I.S. deu like nestas respostas. Procure UM padrão claro e comum no JEITO de responder (formato, tamanho, tom, estrutura, o que foi incluído) que valha a pena manter.',
        'Se não houver padrão claro em comum, ou se ele já estiver nas lições existentes, responda {"licao": null}.',
        `Senão, responda só JSON: {"licao": "...", "escopo": "..."} (${ESCOPO_TXT}); a lição no imperativo, em 1 frase, em português do Brasil.`,
        existentes.length ? `Lições existentes:\n${existentes.map((l) => `- ${l.lesson}`).join('\n')}` : '',
      ].filter(Boolean).join('\n'),
    },
    { role: 'user', content: pares.map((p, i) => `#${i + 1}\nPERGUNTA: ${p.pergunta.slice(0, 500)}\nRESPOSTA: ${p.resposta.slice(0, 900)}`).join('\n\n') },
  ], { json: true, temperatura: 0.2, maxTokens: 300 });
  if (!r.ok) throw new Error(r.erro);
  return normalizarLicao(lerJson(r.texto));
}

/** Pergunta do dono logo antes de uma resposta. */
async function perguntaAntes(sb: SupabaseClient, conversa: string, antesDe: string): Promise<string> {
  const { data } = await sb.from('messages').select('content').eq('conversation_id', conversa).eq('role', 'user')
    .is('deleted_at', null).lt('created_at', antesDe).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data?.content as string | undefined) ?? '';
}

async function desativar(sb: SupabaseClient, id: string | null) {
  if (id) await sb.from('assistant_lessons').update({ active: false }).eq('id', id);
}

/** Muitas lições ativas: o Groq junta as parecidas (as originais ficam inativas, não somem). */
export async function juntarLicoes(sb: SupabaseClient): Promise<number> {
  const ls = await licoesAtivas(sb);
  if (ls.length <= TETO) return 0;
  const r = await conversar('groq', [
    {
      role: 'system', content: [
        'Estas são lições que o assistente J.A.R.V.I.S. aprendeu com o dono. Há lições demais: junte as que dizem a mesma coisa ou se completam.',
        `Responda só JSON: {"grupos": [{"ids": ["n", "n"], "licao": "...", "tipo": "evitar"|"manter", "escopo": "..."}]}, com pelo menos 2 ids por grupo e sem repetir id. ${ESCOPO_TXT}. Não junte lições de tipos diferentes.`,
      ].join('\n'),
    },
    { role: 'user', content: ls.map((l, i) => `${i + 1}. [${l.kind}/${l.scope}] ${l.lesson}`).join('\n') },
  ], { json: true, temperatura: 0.1, maxTokens: 1500 });
  if (!r.ok) return 0;
  let juntadas = 0;
  const usados = new Set<number>();
  for (const g of (lerJson(r.texto)?.grupos ?? []) as Record<string, unknown>[]) {
    const idx = (Array.isArray(g.ids) ? g.ids : []).map(Number).filter((n) => n >= 1 && n <= ls.length && !usados.has(n));
    const nova = normalizarLicao(g);
    if (idx.length < 2 || !nova) continue;
    const velhas = idx.map((n) => ls[n - 1]!);
    const kind: TipoLicao = g.tipo === 'manter' ? 'manter' : g.tipo === 'evitar' ? 'evitar' : velhas[0]!.kind;
    if (velhas.some((v) => v.kind !== kind)) continue;
    const { error } = await sb.from('assistant_lessons').insert({
      lesson: nova.lesson, kind, scope: nova.scope, sensitive: velhas.some((v) => v.sensitive),
      hits: velhas.reduce((s, v) => s + v.hits, 0),
    });
    if (error) continue;
    idx.forEach((n) => usados.add(n));
    await sb.from('assistant_lessons').update({ active: false }).in('id', velhas.map((v) => v.id));
    juntadas += velhas.length;
  }
  return juntadas;
}

export interface PedidoFeedback {
  message_id?: unknown;
  rating?: unknown; // 'like' | 'dislike' | null (tirar)
  reason?: unknown;
}
export interface RespostaFeedback {
  rating: 'like' | 'dislike' | null;
  licao?: string;
  frase?: string;
}

/** Like, deslike (com motivo) ou tirar o feedback de uma resposta do J.A.R.V.I.S. Erro = texto para o dono. */
export async function registrarFeedback(sb: SupabaseClient, p: PedidoFeedback): Promise<RespostaFeedback | string> {
  const id = String(p.message_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return 'Mensagem inválida.';
  const rating = p.rating === 'like' || p.rating === 'dislike' ? p.rating : p.rating == null ? null : undefined;
  if (rating === undefined) return 'Avaliação inválida.';
  const { data: msg } = await sb.from('messages').select('id, conversation_id, role, content, sensitive, created_at')
    .eq('id', id).maybeSingle();
  if (!msg || msg.role !== 'assistant') return 'Só dá para avaliar respostas do J.A.R.V.I.S.';
  const { data: atual } = await sb.from('message_feedback').select('id, rating, lesson_id, deleted_at')
    .eq('message_id', id).maybeSingle();

  // Tirar (clicou de novo): some o feedback e a lição que ele gerou.
  if (rating === null) {
    if (atual && !atual.deleted_at) {
      await sb.from('message_feedback').update({ deleted_at: new Date().toISOString() }).eq('id', atual.id);
      await desativar(sb, atual.lesson_id);
    }
    return { rating: null };
  }

  const motivo = String(p.reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 1000);
  if (rating === 'dislike' && motivo.length < 3) return 'Diga em poucas palavras o que não ficou bom.';
  // Trocou de ideia: a lição do feedback anterior deixa de valer.
  if (atual?.lesson_id) await desativar(sb, atual.lesson_id);

  const gravado = await sb.from('message_feedback').upsert({
    ...(atual ? { id: atual.id } : {}), message_id: id, conversation_id: msg.conversation_id, rating,
    reason: rating === 'dislike' ? motivo : null, lesson_id: null, deleted_at: null,
  }, { onConflict: 'user_id,message_id' }).select('id').single();
  if (gravado.error) return `Não consegui guardar (${gravado.error.message}).`;
  const fbId = gravado.data.id as string;

  if (rating === 'like') {
    await talvezManter(sb).catch((e) => console.warn('licoes: manter', e instanceof Error ? e.message : e));
    return { rating };
  }

  const pergunta = await perguntaAntes(sb, msg.conversation_id, msg.created_at);
  const ativas = await licoesAtivas(sb);
  const nova = await escreverEvitar(pergunta, msg.content, motivo, ativas.filter((l) => l.kind === 'manter'))
    .catch((e) => {
      console.warn('licoes: evitar', e instanceof Error ? e.message : e);
      return null;
    });
  // Sem IA agora: guarda o motivo do dono como a lição (melhor do que perder).
  const licao = nova ?? { lesson: `Evite repetir isto, que o dono criticou: ${motivo}`.slice(0, 400), scope: 'geral' as Escopo, frase: '' };
  const sensivel = !!msg.sensitive || avaliarSensibilidade(`${pergunta}\n${motivo}`).sensivel;
  const ins = await sb.from('assistant_lessons').insert({
    lesson: licao.lesson, kind: 'evitar', scope: licao.scope, source_feedback_id: fbId, sensitive: sensivel,
  }).select('id').single();
  if (ins.error) return `Guardei o deslike, mas não a lição (${ins.error.message}).`;
  await sb.from('message_feedback').update({ lesson_id: ins.data.id }).eq('id', fbId);
  await juntarLicoes(sb).catch(() => 0);
  const frase = licao.frase && /^entendido/i.test(licao.frase) ? licao.frase : `Entendido, Senhor. Daqui para frente: ${licao.lesson}`;
  return { rating, licao: licao.lesson, frase };
}

/** A cada 3 likes novos (desde a última lição "manter"), tenta tirar uma lição do que o dono aprovou. */
async function talvezManter(sb: SupabaseClient) {
  const { data: ultima } = await sb.from('assistant_lessons').select('created_at').eq('kind', 'manter')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  let q = sb.from('message_feedback').select('id, message_id, created_at').eq('rating', 'like').is('deleted_at', null);
  if (ultima) q = q.gt('created_at', ultima.created_at);
  const { data: likes } = await q.order('created_at', { ascending: false }).limit(30);
  const n = likes?.length ?? 0;
  if (n < 3 || n % 3 !== 0) return;
  const recentes = likes!.slice(0, 5);
  const { data: msgs } = await sb.from('messages').select('id, conversation_id, content, sensitive, created_at')
    .in('id', recentes.map((l) => l.message_id));
  const pares = await Promise.all((msgs ?? []).map(async (m) => ({
    pergunta: await perguntaAntes(sb, m.conversation_id, m.created_at), resposta: m.content as string, sensivel: !!m.sensitive,
  })));
  const nova = await escreverManter(pares, await licoesAtivas(sb));
  if (!nova) return;
  await sb.from('assistant_lessons').insert({
    lesson: nova.lesson, kind: 'manter', scope: nova.scope, source_feedback_id: recentes[0]!.id,
    sensitive: pares.some((p) => p.sensivel),
  });
  await juntarLicoes(sb).catch(() => 0);
}

// ---------- ferramentas da conversa ----------
const comoItem = (l: Licao) => ({ ...l, title: l.lesson });

async function resolverLicao(sb: SupabaseClient, ref: string): Promise<Licao | string> {
  const ls = await licoesAtivas(sb);
  if (!ls.length) return 'Ainda não aprendi nenhuma lição.';
  const r = ref.trim().toLowerCase();
  if (!r || /^(essa|esta|ultima|última|a ultima|a última)$/.test(r)) {
    return [...ls].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]!;
  }
  if (/^\d{1,2}$/.test(r)) return ls[Number(r) - 1] ?? `Não há a lição número ${r}.`;
  const achadas = acharPorNome(ref, ls.map(comoItem));
  if (achadas.length === 1) return achadas[0]!;
  if (achadas.length > 1) return `"${ref}" bate com mais de uma lição: ${achadas.slice(0, 4).map((l) => `**${l.lesson}**`).join('; ')}. Qual?`;
  return `Não achei uma lição com "${ref}".`;
}

const FERRAMENTAS = `
licoes_listar {}   (o que o J.A.R.V.I.S. aprendeu com o like/deslike e com o que o dono ensinou)
licoes_esquecer {ref: "número da lista, trecho da lição, ou \\"essa\\" (a última)"}
licoes_ensinar {licao: "regra no imperativo", tipo?: "evitar"|"manter", escopo?: "geral"|"tarefas"|"lembretes"|"projetos"|"avisos"|"pesquisa"}`;

const REGRAS = [
  '- LIÇÕES (o jeito de o J.A.R.V.I.S. responder e agir) = licoes_*. "o que você aprendeu?" / "quais lições?" -> licoes_listar; "esquece essa lição" / "esquece a 3" -> licoes_esquecer; "daqui pra frente, sempre responda em tópicos" / "de agora em diante não me chame de senhor" -> licoes_ensinar {licao:"...", tipo:"manter" ou "evitar"}. Pedido para lembrar um FATO do dono (gosto, endereço, nome) NÃO é lição: {"acoes": []}.',
];

registrar({
  ferramentas: FERRAMENTAS,
  regras: REGRAS,
  detector: /\b(licao|licoes|aprendeu|daqui (pra|para) (frente|diante)|de agora em diante)\b/,
  executores: {
    async licoes_listar(ctx): Promise<ResultadoFerramenta> {
      const ls = await licoesAtivas(ctx.sb);
      const texto = ls.length
        ? `**O que aprendi com você (${ls.length})**\n${ls.map((l, i) => `${i + 1}. ${l.kind === 'evitar' ? 'Evitar' : 'Manter'}${l.scope !== 'geral' ? ` (${l.scope})` : ''}: ${l.lesson}${l.hits ? ` · usada ${l.hits}×` : ''}`).join('\n')}\n\nPara tirar uma, diga "esquece a lição N".`
        : 'Ainda não aprendi nenhuma lição. Use o 👍 e o 👎 nas respostas, ou diga "daqui pra frente, ...".';
      return { ferramenta: 'licoes_listar', ok: true, resumo: `${ls.length} lição(ões)`, fatos: { licoes: ls }, texto, ids: ls.map((l) => l.id) };
    },

    async licoes_esquecer(ctx, a) {
      const l = await resolverLicao(ctx.sb, String(a.ref ?? ''));
      if (typeof l === 'string') return falha('licoes_esquecer', l);
      const { data, error } = await ctx.sb.from('assistant_lessons').update({ deleted_at: new Date().toISOString() })
        .eq('id', l.id).select(CAMPOS).single();
      if (error) return falha('licoes_esquecer', `Não consegui esquecer (${error.message}).`);
      await recibo(ctx.sb, 'licoes_esquecer', l, data as Licao, 'assistant_lessons');
      return {
        ferramenta: 'licoes_esquecer', ok: true, resumo: 'lição esquecida', fatos: { licao: l },
        texto: `Esqueci: _${l.lesson}_. Se mudar de ideia, diga "desfaz".`, ids: [l.id],
      };
    },

    async licoes_ensinar(ctx, a) {
      const nova = normalizarLicao({ licao: a.licao, escopo: a.escopo });
      if (!nova) return falha('licoes_ensinar', 'O que devo aprender?');
      const kind: TipoLicao = a.tipo === 'evitar' ? 'evitar' : 'manter';
      const { data, error } = await ctx.sb.from('assistant_lessons').insert({
        lesson: nova.lesson, kind, scope: nova.scope, sensitive: avaliarSensibilidade(nova.lesson).sensivel,
      }).select(CAMPOS).single();
      if (error) return falha('licoes_ensinar', `Não consegui guardar (${error.message}).`);
      await recibo(ctx.sb, 'licoes_ensinar', null, data as Licao, 'assistant_lessons');
      await juntarLicoes(ctx.sb).catch(() => 0);
      return {
        ferramenta: 'licoes_ensinar', ok: true, resumo: 'lição guardada', fatos: { licao: data },
        texto: `Entendido, Senhor. Daqui para frente: ${nova.lesson}`, ids: [(data as Licao).id],
      };
    },
  },
});
