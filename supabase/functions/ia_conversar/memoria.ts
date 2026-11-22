// Memória do J.A.R.V.I.S.: o que ele sabe do dono.
// - Antes de responder: busca as memórias parecidas com a pergunta + as mais importantes.
// - Depois de responder (em segundo plano): o Groq lê a conversa e decide o que guardar,
//   atualizar ou esquecer. Toda escrita gera recibo em undo_receipts (desfazer por 24 h).
// Memória sensível nunca entra no prompt que vai para o Gemini.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { avaliarSensibilidade } from './sensivel.ts';
import { conversar } from './provedores.ts';

export interface Memoria {
  id: string;
  kind: string;
  title: string | null;
  content: string;
  importance: number;
  sensitive: boolean;
}

const COLUNAS = 'id, kind, title, content, importance, sensitive';

/** Memórias relevantes para a pergunta (busca de texto) + as essenciais (importância alta). */
export async function lembrar(sb: SupabaseClient, pergunta: string): Promise<Memoria[]> {
  const [relevantes, essenciais] = await Promise.all([
    sb.rpc('buscar_memorias', { consulta: pergunta.slice(0, 500), limite: 8 }),
    sb.from('memories').select(COLUNAS).is('deleted_at', null).gte('importance', 8)
      .order('importance', { ascending: false }).order('updated_at', { ascending: false }).limit(6),
  ]);
  const todas = new Map<string, Memoria>();
  for (const m of [...(essenciais.data ?? []), ...(relevantes.data ?? [])] as Memoria[]) todas.set(m.id, m);
  return [...todas.values()];
}

/** Bloco que entra no prompt. `paraGemini` tira as memórias sensíveis. */
export function blocoMemoria(memorias: Memoria[], paraGemini: boolean): string {
  const usar = paraGemini ? memorias.filter((m) => !m.sensitive) : memorias;
  if (!usar.length) return '';
  return [
    'O que você já sabe sobre o dono (da sua memória; use quando ajudar, sem repetir tudo):',
    ...usar.map((m) => `- [${m.kind}] ${m.title ? `${m.title}: ` : ''}${m.content}`),
  ].join('\n');
}

interface Decisao {
  acao: 'criar' | 'atualizar' | 'apagar';
  id?: string;
  tipo?: 'fato' | 'preferencia';
  titulo?: string;
  conteudo?: string;
  importancia?: number;
  sensivel?: boolean;
}

const PROMPT_EXTRAIR = [
  'Você cuida da memória de longo prazo de um assistente pessoal. Leia a última troca de mensagens e decida o que guardar sobre o DONO.',
  'Responda SOMENTE com JSON no formato {"memorias": [...]} (lista vazia se não houver nada).',
  'Cada item: {"acao": "criar"|"atualizar"|"apagar", "id": "<id, só para atualizar/apagar>", "tipo": "fato"|"preferencia", "titulo": "até 6 palavras", "conteudo": "uma frase em 3ª pessoa, ex.: O dono trabalha de dia", "importancia": 1-10, "sensivel": true|false}.',
  'Guarde só o que é duradouro e pessoal do dono: nome, família, pessoas próximas, trabalho, estudos, rotina, gostos, objetivos, decisões tomadas, e como ele prefere que o assistente responda.',
  'NÃO guarde: perguntas de conhecimento geral, conteúdo das respostas do assistente, tarefas pontuais, coisas passageiras do dia, suposições.',
  'Se algo novo contradiz ou atualiza uma memória existente, use "atualizar" com o id dela. Se o dono pedir para esquecer algo, use "apagar" com o id. Se já está guardado igual, não repita.',
  'Se o dono pedir explicitamente para lembrar de algo, guarde com importância alta.',
  'Importância: 10 = identidade (nome); 8-9 = essencial; 5-7 = útil; 1-4 = detalhe.',
  '"sensivel": true para saúde, dinheiro, documentos, senhas, intimidade ou terceiros identificáveis em situação delicada.',
  'No máximo 3 itens.',
].join('\n');

/**
 * Lê a última troca e grava o que for memória. Roda depois da resposta (não atrasa o chat).
 * Usa sempre o Groq: a conversa pode ter conteúdo sensível.
 */
export async function aprender(
  sb: SupabaseClient,
  userId: string,
  troca: { pergunta: string; resposta: string; perguntaId: string; sensivel: boolean },
  conhecidas: Memoria[],
) {
  const conhecidasTxt = conhecidas.length
    ? conhecidas.map((m) => `{"id": "${m.id}", "tipo": "${m.kind}", "titulo": ${JSON.stringify(m.title ?? '')}, "conteudo": ${JSON.stringify(m.content)}}`).join('\n')
    : '(nenhuma)';
  const r = await conversar('groq', [
    { role: 'system', content: PROMPT_EXTRAIR },
    {
      role: 'user',
      content: `Memórias já guardadas (relacionadas):\n${conhecidasTxt}\n\nMensagem do dono:\n${troca.pergunta}\n\nResposta do assistente:\n${troca.resposta.slice(0, 1500)}`,
    },
  ], { json: true, temperatura: 0.1, maxTokens: 700 });
  if (!r.ok) {
    console.warn('memoria: não consegui extrair', r.erro);
    return;
  }

  let decisoes: Decisao[] = [];
  try {
    const bruto = r.texto.replace(/^```(?:json)?\s*|\s*```$/g, '');
    decisoes = (JSON.parse(bruto)?.memorias ?? []).slice(0, 3);
  } catch {
    console.warn('memoria: JSON inválido', r.texto.slice(0, 200));
    return;
  }

  const ids = new Set(conhecidas.map((m) => m.id));
  for (const d of decisoes) {
    try {
      if (d.acao === 'criar' && d.conteudo?.trim()) {
        const conteudo = d.conteudo.trim().slice(0, 500);
        const sensivel = !!d.sensivel || troca.sensivel || avaliarSensibilidade(conteudo).sensivel;
        const { data, error } = await sb.from('memories').insert({
          kind: d.tipo === 'preferencia' ? 'preferencia' : 'fato',
          title: d.titulo?.trim().slice(0, 80) || null,
          content: conteudo,
          importance: Math.min(10, Math.max(1, Math.round(d.importancia ?? 5))),
          sensitive: sensivel,
          source_message_id: troca.perguntaId,
        }).select().single();
        if (error) throw error;
        await recibo(sb, userId, 'memorias_criar', data.id, null, data);
      } else if (d.acao === 'atualizar' && d.id && ids.has(d.id) && d.conteudo?.trim()) {
        const { data: antes } = await sb.from('memories').select('*').eq('id', d.id).single();
        const conteudo = d.conteudo.trim().slice(0, 500);
        const { data, error } = await sb.from('memories').update({
          title: d.titulo?.trim().slice(0, 80) || antes?.title,
          content: conteudo,
          importance: d.importancia ? Math.min(10, Math.max(1, Math.round(d.importancia))) : antes?.importance,
          sensitive: !!antes?.sensitive || !!d.sensivel || troca.sensivel || avaliarSensibilidade(conteudo).sensivel,
          source_message_id: troca.perguntaId,
        }).eq('id', d.id).select().single();
        if (error) throw error;
        await recibo(sb, userId, 'memorias_atualizar', d.id, antes, data);
      } else if (d.acao === 'apagar' && d.id && ids.has(d.id)) {
        // Exclusão suave: nunca DELETE de verdade.
        const { data: antes } = await sb.from('memories').select('*').eq('id', d.id).single();
        const { data, error } = await sb.from('memories').update({ deleted_at: new Date().toISOString() })
          .eq('id', d.id).select().single();
        if (error) throw error;
        await recibo(sb, userId, 'memorias_apagar', d.id, antes, data);
      }
    } catch (e) {
      console.warn('memoria: falhou ao gravar', d.acao, e instanceof Error ? e.message : e);
    }
  }
}

async function recibo(
  sb: SupabaseClient, userId: string, acao: string, id: string,
  antes: unknown, depois: unknown,
) {
  // A coluna gerada `busca` não precisa ir para o recibo.
  const limpar = (x: unknown) => {
    if (!x || typeof x !== 'object') return x;
    const { busca: _b, ...resto } = x as Record<string, unknown>;
    return resto;
  };
  await sb.from('undo_receipts').insert({
    user_id: userId, action: acao, entity_type: 'memories', entity_id: id,
    before: limpar(antes), after: limpar(depois),
  });
}
