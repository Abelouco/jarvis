// Modelos do Groq usados para ver a tela. Um lugar só, com reserva.
// Conferido em 2026-11-27 (console.groq.com/docs/vision e /docs/deprecations):
// qwen/qwen3.8-27b aceita imagem e JSON. qwen/qwen3.6-27b foi desligado em 2026-09-14.
// A reserva é meta-models/muse-spark-open (preview limitado). O secret GROQ_MODELO_VISAO entra na frente.

/** Modelos de visão, o melhor primeiro. */
export const MODELOS_VISAO_BASE = ['qwen/qwen3.8-27b', 'meta-models/muse-spark-open'];

export const MODELO_TEXTO_CONTROLE = 'openai/gpt-oss-120b';

/** Secret na frente, sem repetir. `extra` vazio devolve a base. */
export function ordenarModelos(extra: string, base: string[]): string[] {
  const limpo = extra.trim();
  if (!limpo) return [...base];
  return [limpo, ...base.filter((m) => m !== limpo)];
}

/** Modelos de visão do Groq, em ordem de preferência. O secret GROQ_MODELO_VISAO, se existir, vai na frente. */
export function modelosVisao(): string[] {
  return ordenarModelos(Deno.env.get('GROQ_MODELO_VISAO') ?? '', MODELOS_VISAO_BASE);
}

async function mensagemGroq(r: Response): Promise<string> {
  try {
    const texto = await r.clone().text();
    const json = JSON.parse(texto) as { error?: { message?: unknown } };
    if (typeof json?.error?.message === 'string' && json.error.message.trim()) return json.error.message;
    return texto;
  } catch {
    return '';
  }
}

/**
 * 404, ou 400 cuja mensagem cita o modelo, tenta o próximo.
 * 400 que cita response_format volta como está: o chamador repete sem esse campo.
 */
function modeloIndisponivel(status: number, mensagem: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  const m = mensagem.toLowerCase();
  if (m.includes('response_format')) return false;
  return m.includes('model');
}

/** POST no Groq, trocando de modelo de visão quando o atual não existe. Devolve a última resposta se todos falharem. */
export async function chamarGroqVisao(corpo: Record<string, unknown>): Promise<Response> {
  const chave = Deno.env.get('GROQ_API_KEY') ?? '';
  const modelos = modelosVisao();
  let ultima: Response | null = null;
  for (const model of modelos) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({ ...corpo, model }),
    });
    ultima = r;
    if (r.status === 404 || r.status === 400) {
      const mensagem = await mensagemGroq(r);
      if (modeloIndisponivel(r.status, mensagem)) {
        console.warn('groq visão: modelo indisponível', model, r.status);
        continue;
      }
    }
    return r;
  }
  return ultima ?? new Response('sem modelo de visão', { status: 502 });
}
