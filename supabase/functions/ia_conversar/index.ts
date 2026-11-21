// J.A.R.V.I.S. · Edge Function `ia_conversar`
// Recebe a mensagem do dono, guarda no banco (RLS do próprio usuário), chama a IA
// e devolve a resposta já gravada. As chaves de IA ficam só nos secrets do Supabase.
//
// Secrets: GROQ_API_KEY (obrigatório), GROQ_MODEL (opcional).
// Etapa 2 acrescenta o roteador (Gemini Flash) e a troca automática no limite.
import { createClient } from 'npm:@supabase/supabase-js@2';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELOS_URL = 'https://api.groq.com/openai/v1/models';
// Ordem de preferência para conversa. O Groq aposenta modelos com frequência, então a
// função consulta a lista dos disponíveis e usa o primeiro desta lista que existir.
// GROQ_MODEL (secret opcional) fura a fila.
const PREFERIDOS = [
  Deno.env.get('GROQ_MODEL'),
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'qwen/qwen3-32b',
  'openai/gpt-oss-20b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant',
].filter((m): m is string => !!m);
// Modelos que não são de conversa (áudio, moderação etc.).
const NAO_CHAT = /whisper|tts|playai|orpheus|guard|prompt-guard|distil|compound|allam/i;
let modeloEmCache: { id: string; ate: number } | null = null;

async function escolherModelo(chave: string, forcarRecarga = false): Promise<string> {
  if (!forcarRecarga && modeloEmCache && modeloEmCache.ate > Date.now()) return modeloEmCache.id;
  let id = PREFERIDOS[0] ?? 'llama-3.1-8b-instant';
  try {
    const r = await fetch(GROQ_MODELOS_URL, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (r.ok) {
      const lista: string[] = ((await r.json())?.data ?? [])
        .filter((m: { active?: boolean }) => m.active !== false)
        .map((m: { id: string }) => m.id);
      id = PREFERIDOS.find((m) => lista.includes(m)) ?? lista.find((m) => !NAO_CHAT.test(m)) ?? id;
    }
  } catch {
    /* sem a lista: tenta o preferido mesmo */
  }
  modeloEmCache = { id, ate: Date.now() + 6 * 60 * 60 * 1000 };
  return id;
}
const MAX_TEXTO = 4000;
const HISTORICO = 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function promptSistema() {
  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return [
    'Você é o J.A.R.V.I.S., assistente pessoal do seu dono. Fale sempre em português do Brasil.',
    'J.A.R.V.I.S. significa "Just a Rather Very Intelligent System". Explique isso se perguntarem sobre o seu nome.',
    'Tom: calmo, confiante, um pouco distante e elegante; direto ao ponto, sem bajulação.',
    'Respostas curtas por padrão (1 a 4 frases); só se estenda quando pedirem detalhe.',
    'Se não souber algo, diga. Nunca invente fatos sobre o dono.',
    `Agora é ${agora} (fuso America/Sao_Paulo). Datas no formato AAAA-MM-DD quando precisar ser exato.`,
  ].join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder(405, { erro: 'Use POST.' });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return responder(401, { erro: 'Faça login.' });

  // Cliente com o token do próprio usuário: tudo passa pela RLS.
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: u, error: erroUser } = await sb.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  if (erroUser || !u.user) return responder(401, { erro: 'Sessão inválida. Entre de novo.' });

  let corpo: { conversation_id?: string; message_id?: string; text?: string };
  try {
    corpo = await req.json();
  } catch {
    return responder(400, { erro: 'Corpo inválido.' });
  }
  const texto = (corpo.text ?? '').trim();
  if (!corpo.conversation_id || !UUID.test(corpo.conversation_id)) return responder(400, { erro: 'conversation_id inválido.' });
  if (!corpo.message_id || !UUID.test(corpo.message_id)) return responder(400, { erro: 'message_id inválido.' });
  if (!texto) return responder(400, { erro: 'Mensagem vazia.' });
  if (texto.length > MAX_TEXTO) return responder(400, { erro: `Mensagem longa demais (máx. ${MAX_TEXTO} caracteres).` });

  const chave = Deno.env.get('GROQ_API_KEY');
  if (!chave) return responder(503, { erro: 'A chave do Groq ainda não foi configurada no Supabase.' });

  // Idempotente: se o app já sincronizou a conversa/mensagem, não duplica.
  const conv = await sb.from('conversations')
    .upsert({ id: corpo.conversation_id, title: texto.slice(0, 60) }, { onConflict: 'id', ignoreDuplicates: true });
  if (conv.error) return responder(500, { erro: conv.error.message });
  const msg = await sb.from('messages')
    .upsert({ id: corpo.message_id, conversation_id: corpo.conversation_id, role: 'user', content: texto },
      { onConflict: 'id', ignoreDuplicates: true });
  if (msg.error) return responder(500, { erro: msg.error.message });

  // A pergunta como está no servidor (o horário dela define o que vem "antes" e "depois").
  const pergunta = await sb.from('messages')
    .select('created_at').eq('id', corpo.message_id).single();
  if (pergunta.error) return responder(500, { erro: pergunta.error.message });

  // Já respondida (por outro aparelho ou numa tentativa anterior que caiu no meio)? Devolve a mesma.
  const jaRespondida = await sb.from('messages')
    .select('*')
    .eq('conversation_id', corpo.conversation_id)
    .eq('role', 'assistant')
    .is('deleted_at', null)
    .gt('created_at', pergunta.data.created_at)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (jaRespondida.data) return responder(200, { mensagem: jaRespondida.data, repetida: true });

  // Pulso de "pensando" no cérebro.
  await sb.from('events').insert({ kind: 'thinking', payload: { conversation_id: corpo.conversation_id } });

  // Histórico até a pergunta (inclusive): a resposta é sempre para ela, mesmo se chegou outra depois.
  const hist = await sb.from('messages')
    .select('role, content')
    .eq('conversation_id', corpo.conversation_id)
    .is('deleted_at', null)
    .lte('created_at', pergunta.data.created_at)
    .order('created_at', { ascending: false })
    .limit(HISTORICO);
  if (hist.error) return responder(500, { erro: hist.error.message });
  const mensagens = [
    { role: 'system', content: promptSistema() },
    ...(hist.data ?? []).reverse().map((m) => ({ role: m.role, content: m.content })),
  ];

  const inicio = Date.now();
  const chamar = (modelo: string) =>
    fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelo, messages: mensagens, temperature: 0.6, max_tokens: 1024,
        // Modelos que "pensam" antes: pouco raciocínio (resposta rápida) e sem o pensamento no texto.
        ...(/gpt-oss/.test(modelo) ? { reasoning_effort: 'low' } : {}),
        ...(/qwen3|deepseek-r1/.test(modelo) ? { reasoning_format: 'hidden' } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  let modelo = await escolherModelo(chave);
  let resposta: Response;
  try {
    resposta = await chamar(modelo);
    // Modelo aposentado no meio do caminho: recarrega a lista e tenta uma vez de novo.
    if (resposta.status === 404 || resposta.status === 400) {
      const corpoErro = await resposta.clone().text();
      if (/model_not_found|decommissioned|does not exist/i.test(corpoErro)) {
        modelo = await escolherModelo(chave, true);
        resposta = await chamar(modelo);
      }
    }
  } catch (e) {
    return responder(504, { erro: `A IA não respondeu a tempo (${e instanceof Error ? e.message : e}).` });
  }
  if (resposta.status === 429) return responder(429, { erro: 'Limite do Groq atingido. Tente de novo em instantes.' });
  if (!resposta.ok) {
    const detalhe = (await resposta.text()).slice(0, 300);
    return responder(502, { erro: `Erro do Groq (${resposta.status}): ${detalhe}` });
  }
  const json = await resposta.json();
  const conteudo: string = json?.choices?.[0]?.message?.content?.trim() || '…';
  const latencia = Date.now() - inicio;

  const salva = await sb.from('messages')
    .insert({
      conversation_id: corpo.conversation_id, role: 'assistant', content: conteudo,
      provider: 'groq', model: json?.model ?? modelo, latency_ms: latencia,
    })
    .select()
    .single();
  if (salva.error) return responder(500, { erro: salva.error.message });

  return responder(200, { mensagem: salva.data });
});
