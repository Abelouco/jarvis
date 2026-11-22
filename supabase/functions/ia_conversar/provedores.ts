// Provedores de IA (ambos com API no formato OpenAI). Cada um escolhe sozinho um modelo
// disponível a partir de uma lista de preferência, porque os provedores aposentam modelos.

export type NomeProvedor = 'groq' | 'gemini';

interface Provedor {
  nome: NomeProvedor;
  chave: () => string | undefined;
  url: string;
  modelosUrl: string;
  preferidos: () => string[];
  /** ids que não servem para conversa */
  naoChat: RegExp;
  /** filtro extra para o "qualquer um que sirva" */
  serve: (id: string) => boolean;
  extras: (modelo: string) => Record<string, unknown>;
  timeoutMs: number;
}

const PROVEDORES: Record<NomeProvedor, Provedor> = {
  groq: {
    nome: 'groq',
    chave: () => Deno.env.get('GROQ_API_KEY'),
    url: 'https://api.groq.com/openai/v1/chat/completions',
    modelosUrl: 'https://api.groq.com/openai/v1/models',
    preferidos: () => [
      Deno.env.get('GROQ_MODEL'),
      'openai/gpt-oss-120b',
      'llama-3.3-70b-versatile',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'qwen/qwen3-32b',
      'openai/gpt-oss-20b',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.1-8b-instant',
    ].filter((m): m is string => !!m),
    naoChat: /whisper|tts|playai|orpheus|guard|distil|compound|allam/i,
    serve: () => true,
    extras: (m) => ({
      // Modelos que "pensam" antes: pouco raciocínio (rápido) e sem o pensamento no texto.
      ...(/gpt-oss/.test(m) ? { reasoning_effort: 'low' } : {}),
      ...(/qwen3|deepseek-r1/.test(m) ? { reasoning_format: 'hidden' } : {}),
    }),
    timeoutMs: 30_000,
  },
  gemini: {
    nome: 'gemini',
    chave: () => Deno.env.get('GEMINI_API_KEY'),
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    modelosUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    preferidos: () => [
      Deno.env.get('GEMINI_MODEL'),
      'gemini-flash-latest',
      'gemini-3-flash',
      'gemini-3-flash-preview',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
    ].filter((m): m is string => !!m),
    naoChat: /image|tts|audio|live|embedding|vision|lite|thinking-exp|learnlm|gemma/i,
    serve: (id) => /flash/i.test(id),
    extras: () => ({ reasoning_effort: 'low' }),
    timeoutMs: 30_000,
  },
};

const cacheModelo = new Map<NomeProvedor, { id: string; ate: number }>();
/** Modelos disponíveis na conta (para achar um substituto quando o escolhido está sobrecarregado). */
const cacheLista = new Map<NomeProvedor, string[]>();

export function temChave(nome: NomeProvedor): boolean {
  return !!PROVEDORES[nome].chave();
}

async function escolherModelo(p: Provedor, chave: string, recarregar = false): Promise<string> {
  const c = cacheModelo.get(p.nome);
  if (!recarregar && c && c.ate > Date.now()) return c.id;
  const pref = p.preferidos();
  let id = pref[0]!;
  try {
    const r = await fetch(p.modelosUrl, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (r.ok) {
      const lista: string[] = ((await r.json())?.data ?? [])
        .filter((m: { active?: boolean }) => m.active !== false)
        .map((m: { id: string }) => String(m.id).replace(/^models\//, ''));
      cacheLista.set(p.nome, lista);
      id = pref.find((m) => lista.includes(m))
        ?? lista.find((m) => p.serve(m) && !p.naoChat.test(m))
        ?? id;
    }
  } catch {
    /* sem a lista: tenta o preferido mesmo */
  }
  cacheModelo.set(p.nome, { id, ate: Date.now() + 6 * 60 * 60 * 1000 });
  return id;
}

export interface Fonte {
  titulo: string;
  url: string;
}

export type Resultado =
  | { ok: true; texto: string; modelo: string; tokens: number; fontes?: Fonte[] }
  | { ok: false; limite: boolean; esperarSeg: number; erro: string };

export interface MensagemIA {
  role: string;
  content: string;
}

export interface OpcoesConversa {
  /** pede resposta em JSON (modo JSON do provedor) */
  json?: boolean;
  temperatura?: number;
  maxTokens?: number;
}

/** Chama o provedor. Se o modelo foi aposentado, recarrega a lista e tenta uma vez de novo. */
export async function conversar(nome: NomeProvedor, mensagens: MensagemIA[], op: OpcoesConversa = {}): Promise<Resultado> {
  const p = PROVEDORES[nome];
  const chave = p.chave();
  if (!chave) return { ok: false, limite: false, esperarSeg: 0, erro: `sem chave do ${nome}` };

  const chamar = (modelo: string) =>
    fetch(p.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelo, messages: mensagens, temperature: op.temperatura ?? 0.6, max_tokens: op.maxTokens ?? 1500,
        ...(op.json ? { response_format: { type: 'json_object' } } : {}),
        ...p.extras(modelo),
      }),
      signal: AbortSignal.timeout(p.timeoutMs),
    });

  let modelo = await escolherModelo(p, chave);
  let r: Response;
  try {
    r = await chamar(modelo);
    if (r.status === 404 || r.status === 400) {
      const corpo = await r.clone().text();
      if (/model_not_found|decommissioned|does not exist|not found for API version|is not supported/i.test(corpo)) {
        modelo = await escolherModelo(p, chave, true);
        r = await chamar(modelo);
      }
    }
  } catch (e) {
    return { ok: false, limite: false, esperarSeg: 0, erro: `${nome}/${modelo} não respondeu a tempo (${e instanceof Error ? e.message : e})` };
  }

  // Sobrecarregado (503/500/529): tenta uma vez outro modelo do mesmo provedor.
  if (r.status === 503 || r.status === 500 || r.status === 529) {
    const lista = cacheLista.get(nome) ?? [];
    const outro = p.preferidos().find((m) => m !== modelo && lista.includes(m))
      ?? lista.find((m) => m !== modelo && p.serve(m) && !p.naoChat.test(m));
    if (outro) {
      try {
        const r2 = await chamar(outro);
        if (r2.ok || r2.status === 429) {
          r = r2;
          modelo = outro;
        }
      } catch {
        /* segue com o erro do primeiro */
      }
    }
  }

  if (r.status === 429) {
    const esperar = Number(r.headers.get('retry-after')) || 60;
    return { ok: false, limite: true, esperarSeg: Math.min(Math.max(esperar, 10), 3600), erro: `limite do ${nome}` };
  }
  if (!r.ok) {
    return { ok: false, limite: false, esperarSeg: 0, erro: `${nome}/${modelo} ${r.status}: ${(await r.text()).slice(0, 300)}` };
  }
  const json = await r.json();
  const texto: string = json?.choices?.[0]?.message?.content?.trim() ?? '';
  if (!texto) return { ok: false, limite: false, esperarSeg: 0, erro: `${nome} respondeu vazio` };
  return { ok: true, texto, modelo: json?.model ?? modelo, tokens: Number(json?.usage?.total_tokens) || 0 };
}

// ---------- pesquisa na web ----------

/** Junta fontes únicas (mesmo endereço só uma vez), no máximo 8. */
function fontesUnicas(lista: Fonte[]): Fonte[] {
  const vistas = new Set<string>();
  const out: Fonte[] = [];
  for (const f of lista) {
    if (!f.url || !/^https?:\/\//.test(f.url) || vistas.has(f.url)) continue;
    vistas.add(f.url);
    out.push({ titulo: (f.titulo || new URL(f.url).hostname).slice(0, 120), url: f.url });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Gemini com Google Search (API nativa: a compatível com OpenAI não tem a busca).
 * Devolve a resposta e as fontes que o Google usou para fundamentá-la.
 */
export async function pesquisarGemini(sistema: string, historico: MensagemIA[]): Promise<Resultado> {
  const p = PROVEDORES.gemini;
  const chave = p.chave();
  if (!chave) return { ok: false, limite: false, esperarSeg: 0, erro: 'sem chave do gemini' };

  const chamar = (modelo: string) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: historico.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2500 },
      }),
      signal: AbortSignal.timeout(45_000),
    });

  let modelo = await escolherModelo(p, chave);
  let r: Response;
  try {
    r = await chamar(modelo);
    if (r.status === 503 || r.status === 500 || r.status === 529 || r.status === 404) {
      const lista = cacheLista.get('gemini') ?? [];
      const outro = p.preferidos().find((m) => m !== modelo && lista.includes(m));
      if (outro) {
        const r2 = await chamar(outro);
        if (r2.ok || r2.status === 429) {
          r = r2;
          modelo = outro;
        }
      }
    }
  } catch (e) {
    return { ok: false, limite: false, esperarSeg: 0, erro: `gemini/busca não respondeu a tempo (${e instanceof Error ? e.message : e})` };
  }
  if (r.status === 429) {
    const esperar = Number(r.headers.get('retry-after')) || 60;
    return { ok: false, limite: true, esperarSeg: Math.min(Math.max(esperar, 10), 3600), erro: 'limite do gemini (busca)' };
  }
  if (!r.ok) return { ok: false, limite: false, esperarSeg: 0, erro: `gemini/busca ${r.status}: ${(await r.text()).slice(0, 300)}` };

  const json = await r.json();
  const cand = json?.candidates?.[0];
  const texto: string = (cand?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? '').join('').trim();
  if (!texto) return { ok: false, limite: false, esperarSeg: 0, erro: 'gemini/busca respondeu vazio' };
  const fontes = fontesUnicas(
    (cand?.groundingMetadata?.groundingChunks ?? [])
      .map((c: { web?: { uri?: string; title?: string } }) => ({ titulo: c.web?.title ?? '', url: c.web?.uri ?? '' })),
  );
  return { ok: true, texto, modelo, tokens: Number(json?.usageMetadata?.totalTokenCount) || 0, fontes };
}

/** Reserva: Groq Compound (modelo do Groq que pesquisa na web sozinho). */
export async function pesquisarGroq(sistema: string, historico: MensagemIA[]): Promise<Resultado> {
  const chave = PROVEDORES.groq.chave();
  if (!chave) return { ok: false, limite: false, esperarSeg: 0, erro: 'sem chave do groq' };
  let r: Response;
  try {
    r = await fetch(PROVEDORES.groq.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'groq/compound',
        messages: [{ role: 'system', content: sistema }, ...historico],
        temperature: 0.3,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    return { ok: false, limite: false, esperarSeg: 0, erro: `groq/compound não respondeu a tempo (${e instanceof Error ? e.message : e})` };
  }
  if (r.status === 429) {
    const esperar = Number(r.headers.get('retry-after')) || 60;
    return { ok: false, limite: true, esperarSeg: Math.min(Math.max(esperar, 10), 3600), erro: 'limite do groq (busca)' };
  }
  if (!r.ok) return { ok: false, limite: false, esperarSeg: 0, erro: `groq/compound ${r.status}: ${(await r.text()).slice(0, 300)}` };
  const json = await r.json();
  const msg = json?.choices?.[0]?.message;
  const texto: string = msg?.content?.trim() ?? '';
  if (!texto) return { ok: false, limite: false, esperarSeg: 0, erro: 'groq/compound respondeu vazio' };
  // As fontes vêm nos resultados das ferramentas de busca; o formato pode variar, então procura {url, title}.
  const achadas: Fonte[] = [];
  const varrer = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(varrer);
    const o = x as Record<string, unknown>;
    if (typeof o.url === 'string') achadas.push({ titulo: String(o.title ?? ''), url: o.url });
    Object.values(o).forEach(varrer);
  };
  varrer(msg?.executed_tools);
  return { ok: true, texto, modelo: 'groq/compound', tokens: Number(json?.usage?.total_tokens) || 0, fontes: fontesUnicas(achadas) };
}
