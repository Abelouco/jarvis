// Pesquisa na web pelo Tavily (grátis: 1.000 créditos/mês, sem cartão). Secret: TAVILY_API_KEY.
// Busca básica = 1 crédito (a avançada custaria 2). Cada pergunta faz 2 buscas básicas = 2 créditos.
// Os serviços grátis do Gemini e do Groq não oferecem busca na conta gratuita, então a busca
// é feita aqui e a IA só escreve a resposta a partir dos trechos encontrados.
import type { Fonte, MensagemIA } from './provedores.ts';
import { conversar } from './provedores.ts';

export interface Trecho {
  titulo: string;
  url: string;
  conteudo: string;
}

export function temBusca(): boolean {
  return !!Deno.env.get('TAVILY_API_KEY');
}

async function tavily(consulta: string): Promise<Trecho[]> {
  const chave = Deno.env.get('TAVILY_API_KEY');
  if (!chave) return [];
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: consulta.slice(0, 380),
      search_depth: 'basic',
      max_results: 6,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`tavily ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const json = await r.json();
  return (json?.results ?? [])
    .filter((x: { url?: string; content?: string }) => x.url && x.content)
    .map((x: { title?: string; url: string; content: string }) => ({
      titulo: (x.title ?? '').slice(0, 140),
      url: x.url,
      conteudo: x.content.slice(0, 1400),
    }));
}

/** Pesquisa já feita antes (tabela web_searches), candidata a ser reaproveitada. */
export interface PesquisaAnterior {
  id: string;
  question: string;
  queries: string;
  created_at: string;
}

interface Plano {
  consultas: string[];
  /** Índice da pesquisa anterior que já responde a pergunta (não precisa pesquisar de novo). */
  reusar: number | null;
}

const dataSP = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * Decide se dá para reaproveitar uma pesquisa anterior e, se não der, transforma a pergunta
 * (com o contexto da conversa) em duas consultas: uma em português e outra em inglês
 * (wikis de jogos e documentação costumam estar em inglês). Uma chamada só ao Groq.
 */
async function planejar(historico: MensagemIA[], anteriores: PesquisaAnterior[]): Promise<Plano> {
  const pergunta = historico.at(-1)?.content ?? '';
  const contexto = historico.slice(-5, -1).map((m) => `${m.role === 'user' ? 'Dono' : 'Assistente'}: ${m.content.slice(0, 300)}`).join('\n');
  const hoje = dataSP(new Date().toISOString());
  const blocoAnteriores = anteriores.length
    ? `\n\nPESQUISAS ANTERIORES (já feitas; hoje é ${hoje}):\n${anteriores.map((a, i) =>
      `${i + 1}. (${dataSP(a.created_at)}) Pergunta: ${a.question.slice(0, 300)} | Consultas: ${a.queries.replace(/\n/g, ' / ').slice(0, 300)}`).join('\n')}`
    : '';
  const r = await conversar('groq', [
    {
      role: 'system',
      content: [
        'Você planeja a pesquisa na web para responder a pergunta do dono.',
        'Responda SOMENTE JSON: {"reusar": número ou null, "pt": "consulta em português", "en": "consulta em inglês"}.',
        'Consultas curtas e específicas (nomes próprios exatos, sem palavras de enchimento). Use o contexto só para entender a quem a pergunta se refere.',
        'REUSAR: se uma das PESQUISAS ANTERIORES já buscou exatamente o mesmo assunto e a mesma dúvida (mesmo jogo/produto/tema, mesma coisa perguntada, mesmo que com outras palavras), ponha o número dela em "reusar".',
        'Só reuse informação que não muda com o tempo (como algo funciona num jogo, receitas, tutoriais, história, ciência). NUNCA reuse para notícias, preços, clima, placares, cotações, lançamentos, versões ou atualizações, a não ser que a pesquisa anterior seja de hoje.',
        'Se a pergunta pede algo a mais ou diferente do que a anterior buscou, não reuse. Na dúvida, "reusar": null.',
      ].join('\n'),
    },
    { role: 'user', content: `${contexto ? `Contexto:\n${contexto}\n\n` : ''}Pergunta: ${pergunta}${blocoAnteriores}` },
  ], { json: true, temperatura: 0, maxTokens: 250 });
  if (r.ok) {
    try {
      const j = JSON.parse(r.texto.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      const lista = [j.pt, j.en].filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 2);
      const n = Number(j.reusar);
      const reusar = Number.isInteger(n) && n >= 1 && n <= anteriores.length ? n - 1 : null;
      return { consultas: lista.length ? lista : [pergunta], reusar };
    } catch {
      /* usa a pergunta como está */
    }
  }
  return { consultas: [pergunta], reusar: null };
}

export interface ResultadoBusca {
  trechos: Trecho[];
  /** Créditos do Tavily gastos (0 quando reaproveitou). */
  creditos: number;
  consultas: string[];
  /** id da pesquisa anterior reaproveitada, se foi o caso. */
  reusada: string | null;
}

/**
 * Pesquisa (ou reaproveita uma pesquisa anterior) e junta os trechos, sem repetir endereço.
 * `carregar` busca os trechos guardados de uma pesquisa anterior.
 */
export async function buscar(
  historico: MensagemIA[],
  anteriores: PesquisaAnterior[] = [],
  carregar?: (id: string) => Promise<Trecho[] | null>,
): Promise<ResultadoBusca> {
  const plano = await planejar(historico, anteriores);
  if (plano.reusar !== null && carregar) {
    const anterior = anteriores[plano.reusar]!;
    const guardados = await carregar(anterior.id).catch(() => null);
    if (guardados?.length) return { trechos: guardados, creditos: 0, consultas: plano.consultas, reusada: anterior.id };
  }
  const qs = plano.consultas;
  const resultados = await Promise.allSettled(qs.map((q) => tavily(q)));
  const creditos = resultados.filter((r) => r.status === 'fulfilled').length;
  const vistos = new Set<string>();
  const trechos: Trecho[] = [];
  for (const r of resultados) {
    if (r.status !== 'fulfilled') {
      console.warn('busca: falhou', r.reason instanceof Error ? r.reason.message : r.reason);
      continue;
    }
    for (const t of r.value) {
      if (vistos.has(t.url)) continue;
      vistos.add(t.url);
      trechos.push(t);
    }
  }
  return { trechos: trechos.slice(0, 10), creditos, consultas: qs, reusada: null };
}

/** Bloco com os trechos numerados, para a IA responder só com base neles. */
export function blocoTrechos(trechos: Trecho[]): string {
  return [
    'RESULTADOS DA PESQUISA NA WEB (use SOMENTE isto para os fatos; cite pelo número entre colchetes, ex.: [1][3]):',
    ...trechos.map((t, i) => `[${i + 1}] ${t.titulo} (${new URL(t.url).hostname})\n${t.conteudo}`),
  ].join('\n\n');
}

export function fontesDe(trechos: Trecho[]): Fonte[] {
  return trechos.map((t) => ({ titulo: t.titulo || new URL(t.url).hostname, url: t.url }));
}
