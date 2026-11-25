// J.A.R.V.I.S. · Edge Function `ia_transcrever`
// Recebe um áudio gravado no app (multipart, campo "audio") e devolve o texto, transcrito pelo
// Whisper do Groq (grátis e rápido). A chave fica só no secret GROQ_API_KEY.
// O áudio não é guardado: só passa por aqui até o Groq e volta como texto.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_BYTES = 15 * 1024 * 1024; // ~ vários minutos de voz em opus

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

let modeloEmCache: { id: string; ate: number } | null = null;

/** O Groq já trocou modelos de voz antes: pega o melhor Whisper disponível na conta. */
async function escolherModelo(chave: string): Promise<string> {
  if (modeloEmCache && modeloEmCache.ate > Date.now()) return modeloEmCache.id;
  let id = 'whisper-large-v3-turbo';
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (r.ok) {
      const lista: string[] = ((await r.json())?.data ?? []).map((m: { id: string }) => m.id);
      id = ['whisper-large-v3-turbo', 'whisper-large-v3'].find((m) => lista.includes(m))
        ?? lista.find((m) => /whisper/i.test(m))
        ?? id;
    }
  } catch {
    /* usa o padrão */
  }
  modeloEmCache = { id, ate: Date.now() + 6 * 60 * 60 * 1000 };
  return id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder(405, { erro: 'Use POST.' });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return responder(401, { erro: 'Faça login.' });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: u, error } = await sb.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  if (error || !u.user) return responder(401, { erro: 'Sessão inválida. Entre de novo.' });

  const chave = Deno.env.get('GROQ_API_KEY');
  if (!chave) return responder(503, { erro: 'A chave do Groq não está configurada no Supabase.' });

  let audio: File | null = null;
  try {
    const form = await req.formData();
    const campo = form.get('audio');
    audio = campo instanceof File ? campo : null;
  } catch {
    return responder(400, { erro: 'Envie o áudio como multipart (campo "audio").' });
  }
  if (!audio || audio.size < 800) return responder(400, { erro: 'Áudio vazio ou curto demais.' });
  if (audio.size > MAX_BYTES) return responder(413, { erro: 'Áudio longo demais.' });

  const modelo = await escolherModelo(chave);
  const envio = new FormData();
  envio.append('file', audio, audio.name || 'fala.webm');
  envio.append('model', modelo);
  envio.append('language', 'pt');
  envio.append('response_format', 'json');
  envio.append('temperature', '0');
  // Dica de vocabulário: ajuda o Whisper a escrever os nomes certos.
  envio.append('prompt', 'Conversa em português do Brasil com o assistente J.A.R.V.I.S.');

  const inicio = Date.now();
  let r: Response;
  try {
    r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}` },
      body: envio,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return responder(504, { erro: `A transcrição não respondeu a tempo (${e instanceof Error ? e.message : e}).` });
  }
  if (r.status === 429) return responder(429, { erro: 'Limite de voz do Groq atingido. Tente de novo em instantes.' });
  if (!r.ok) {
    console.warn('ia_transcrever: falhou', r.status, (await r.text()).slice(0, 300));
    return responder(502, { erro: `Não consegui transcrever (Groq ${r.status}).` });
  }
  const json = await r.json();
  const texto = String(json?.text ?? '').trim();
  return responder(200, { texto, modelo, ms: Date.now() - inicio });
});
