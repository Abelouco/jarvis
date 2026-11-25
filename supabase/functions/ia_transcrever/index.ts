// J.A.R.V.I.S. · Edge Function `ia_transcrever`
// Recebe um áudio gravado no app (multipart, campo "audio"; opcional "contexto" com as últimas
// mensagens) e devolve o texto. Dois passos, os dois no Groq (grátis e rápido):
//   1. Whisper transcreve, com uma dica de vocabulário (nomes em inglês e o assunto da conversa);
//   2. um modelo de texto corrige só nomes próprios e termos em inglês que o Whisper "aportuguesou"
//      (ex.: "jogo medieval de Nastia" → "jogo Medieval Dynasty"), sem mudar o sentido.
// A chave fica só no secret GROQ_API_KEY. O áudio não é guardado.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_BYTES = 15 * 1024 * 1024; // ~ vários minutos de voz em opus
const GROQ = 'https://api.groq.com/openai/v1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

let listaEmCache: { ids: string[]; ate: number } | null = null;

/** Modelos da conta (o Groq aposenta modelos de tempos em tempos). */
async function modelosDaConta(chave: string): Promise<string[]> {
  if (listaEmCache && listaEmCache.ate > Date.now()) return listaEmCache.ids;
  let ids: string[] = [];
  try {
    const r = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(8_000) });
    if (r.ok) ids = ((await r.json())?.data ?? []).map((m: { id: string }) => m.id);
  } catch {
    /* usa os padrões */
  }
  listaEmCache = { ids, ate: Date.now() + 6 * 60 * 60 * 1000 };
  return ids;
}

/** O large-v3 completo erra menos nomes estrangeiros que o turbo; o turbo fica de reserva. */
function escolherWhisper(lista: string[]): string {
  return ['whisper-large-v3', 'whisper-large-v3-turbo'].find((m) => lista.includes(m))
    ?? lista.find((m) => /whisper/i.test(m))
    ?? 'whisper-large-v3';
}

function escolherCorretor(lista: string[]): string | null {
  const preferidos = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
  if (!lista.length) return preferidos[0];
  return preferidos.find((m) => lista.includes(m)) ?? null;
}

const DICA_BASE =
  'Conversa em português do Brasil com o assistente J.A.R.V.I.S. '
  + 'Nomes de jogos, filmes, séries, apps e marcas ficam em inglês, como Medieval Dynasty, Minecraft, '
  + 'The Witcher, Red Dead Redemption, Visual Studio Code, YouTube, Steam.';

/** O Whisper só aproveita ~220 tokens de dica: o final da conversa é o que mais importa. */
function dicaDoWhisper(contexto: string): string {
  const fim = contexto.replace(/\s+/g, ' ').trim().slice(-400);
  return fim ? `${DICA_BASE} ${fim}` : DICA_BASE;
}

async function corrigir(chave: string, modelo: string, texto: string, contexto: string): Promise<string> {
  const sistema = [
    'Você revisa transcrições de voz em português do Brasil feitas pelo Whisper.',
    'O Whisper às vezes escreve nomes em inglês (jogos, filmes, séries, apps, marcas, pessoas, termos técnicos) como se fossem palavras em português. Exemplo: "jogo medieval de Nastia" era "jogo Medieval Dynasty"; "maicrosoft vorde" era "Microsoft Word".',
    'Corrija APENAS esses nomes e termos, pelo som e pelo contexto. Corrija também pontuação óbvia.',
    'NÃO mude o sentido, NÃO responda a pergunta, NÃO acrescente nem tire informação, NÃO traduza o resto.',
    'Se nada precisar mudar, devolva o texto igual.',
    'Responda só com JSON: {"texto": "..."}',
  ].join('\n');
  const usuario = (contexto ? `Conversa recente (só para contexto):\n${contexto.slice(-1200)}\n\n` : '')
    + `Transcrição para revisar:\n${texto}`;
  try {
    const r = await fetch(`${GROQ}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
        temperature: 0,
        max_tokens: 600,
        response_format: { type: 'json_object' },
        ...(modelo.startsWith('openai/') ? { reasoning_effort: 'low' } : {}),
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!r.ok) {
      console.warn('ia_transcrever: correção falhou', r.status, (await r.text()).slice(0, 200));
      return texto;
    }
    const conteudo = (await r.json())?.choices?.[0]?.message?.content ?? '';
    const novo = String(JSON.parse(conteudo)?.texto ?? '').trim();
    // Proteção: se o "corretor" reescreveu demais (respondeu, resumiu…), fica com o original.
    if (!novo || novo.length > texto.length * 1.6 + 20 || novo.length < texto.length * 0.5) return texto;
    return novo;
  } catch (e) {
    console.warn('ia_transcrever: correção não respondeu', e instanceof Error ? e.message : e);
    return texto;
  }
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
  let contexto = '';
  try {
    const form = await req.formData();
    const campo = form.get('audio');
    audio = campo instanceof File ? campo : null;
    contexto = String(form.get('contexto') ?? '').slice(-2000);
  } catch {
    return responder(400, { erro: 'Envie o áudio como multipart (campo "audio").' });
  }
  if (!audio || audio.size < 800) return responder(400, { erro: 'Áudio vazio ou curto demais.' });
  if (audio.size > MAX_BYTES) return responder(413, { erro: 'Áudio longo demais.' });

  const lista = await modelosDaConta(chave);
  const modelo = escolherWhisper(lista);
  const envio = new FormData();
  envio.append('file', audio, audio.name || 'fala.webm');
  envio.append('model', modelo);
  envio.append('language', 'pt');
  envio.append('response_format', 'json');
  envio.append('temperature', '0');
  envio.append('prompt', dicaDoWhisper(contexto));

  const inicio = Date.now();
  let r: Response;
  try {
    r = await fetch(`${GROQ}/audio/transcriptions`, {
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
  const bruto = String((await r.json())?.text ?? '').trim();
  // O Whisper às vezes "ouve" a própria dica quando o áudio é quase silêncio.
  if (!bruto || bruto.includes('Medieval Dynasty, Minecraft')) return responder(200, { texto: '', modelo, ms: Date.now() - inicio });

  const corretor = escolherCorretor(lista);
  const texto = corretor ? await corrigir(chave, corretor, bruto, contexto) : bruto;
  return responder(200, { texto, bruto, modelo, corretor, ms: Date.now() - inicio });
});
