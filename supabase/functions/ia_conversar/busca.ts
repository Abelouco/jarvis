// Pesquisa na web pelo Tavily (grátis: 1.000 créditos/mês, sem cartão). Secret: TAVILY_API_KEY.
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

async function tavily(consulta: string, profunda: boolean): Promise<Trecho[]> {
  const chave = Deno.env.get('TAVILY_API_KEY');
  if (!chave) return [];
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: consulta.slice(0, 380),
      search_depth: profunda ? 'advanced' : 'basic',
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

/**
 * Transforma a pergunta (com o contexto da conversa) em duas consultas de busca:
 * uma em português e outra em inglês (wikis de jogos e documentação costumam estar em inglês).
 */
async function consultas(historico: MensagemIA[]): Promise<string[]> {
  const pergunta = historico.at(-1)?.content ?? '';
  const contexto = historico.slice(-5, -1).map((m) => `${m.role === 'user' ? 'Dono' : 'Assistente'}: ${m.content.slice(0, 300)}`).join('\n');
  const r = await conversar('groq', [
    {
      role: 'system',
      content: 'Gere consultas de busca na web para responder a pergunta do dono. Responda SOMENTE JSON: {"pt": "consulta em português", "en": "consulta em inglês"}. Consultas curtas e específicas (nomes próprios exatos, sem palavras de enchimento). Use o contexto só para entender a quem a pergunta se refere.',
    },
    { role: 'user', content: `${contexto ? `Contexto:\n${contexto}\n\n` : ''}Pergunta: ${pergunta}` },
  ], { json: true, temperatura: 0, maxTokens: 200 });
  if (r.ok) {
    try {
      const j = JSON.parse(r.texto.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      const lista = [j.pt, j.en].filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 2);
      if (lista.length) return lista;
    } catch {
      /* usa a pergunta como está */
    }
  }
  return [pergunta];
}

/** Faz as buscas e junta os trechos (sem repetir endereço). */
export async function buscar(historico: MensagemIA[]): Promise<Trecho[]> {
  const qs = await consultas(historico);
  const resultados = await Promise.allSettled(qs.map((q, i) => tavily(q, i === qs.length - 1)));
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
  return trechos.slice(0, 10);
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
