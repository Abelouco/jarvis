// J.A.R.V.I.S. · Edge Function `google_conectar` (Fase 4 · etapa 4): conexão com o Google por OAuth + PKCE.
//
// POST (com o login do dono)  {acao: "iniciar"}     -> devolve a URL do Google (o app abre no navegador)
//                             {acao: "desconectar"} -> revoga o token no Google e apaga o segredo do Vault
// GET  ?code&state (o Google volta aqui)            -> troca o código, guarda o refresh token SÓ no Vault
//
// Publicada com --no-verify-jwt: o retorno do Google não traz o login; quem liga o retorno ao dono é o
// `state` de uso único (oauth_states, 10 min). Os POSTs conferem o login aqui dentro.
// Secrets: GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (do dono). O Supabase já dá SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';

export const ESCOPOS = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.modify', // ler, rascunhar, arquivar, lixeira
  'https://www.googleapis.com/auth/gmail.send',
];

const URL_PROJETO = Deno.env.get('SUPABASE_URL')!;
const RETORNO = `${URL_PROJETO}/functions/v1/google_conectar`;
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
// O Supabase troca text/html por texto puro nas funções: a página de retorno é texto simples.
const pagina = (status: number, texto: string) =>
  new Response(`J.A.R.V.I.S.\n\n${texto}\n`, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

const servico = () => createClient(URL_PROJETO, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const aleatorio = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)));
async function desafio(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

async function iniciar(userId: string) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return json(503, { erro: 'O Google ainda não foi configurado no servidor (faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET).' });
  }
  const state = aleatorio(32);
  const verifier = aleatorio(64);
  const sb = servico();
  // Estados velhos do dono saem (só vale o último pedido).
  await sb.from('oauth_states').delete().eq('user_id', userId).is('used_at', null);
  const { error } = await sb.from('oauth_states').insert({ user_id: userId, provider: 'google', state, code_verifier: verifier });
  if (error) return json(500, { erro: error.message });
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: RETORNO, response_type: 'code', scope: ESCOPOS.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    code_challenge: await desafio(verifier), code_challenge_method: 'S256',
  });
  return json(200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
}

async function retorno(url: URL) {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const erroGoogle = url.searchParams.get('error');
  const sb = servico();
  const { data: est } = await sb.from('oauth_states').select('id, user_id, code_verifier, expires_at, used_at')
    .eq('state', state).maybeSingle();
  if (!state || !est || est.used_at || Date.parse(est.expires_at) < Date.now()) {
    return pagina(400, 'Este link de conexão expirou ou já foi usado. Volte ao app e clique em "Conectar Google" de novo.');
  }
  await sb.from('oauth_states').update({ used_at: new Date().toISOString() }).eq('id', est.id);
  if (erroGoogle || !code) {
    return pagina(400, erroGoogle === 'access_denied'
      ? 'Conexão cancelada: o acesso não foi permitido. Nada foi guardado.'
      : `O Google não completou a conexão (${erroGoogle ?? 'sem código'}).`);
  }

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: RETORNO,
      grant_type: 'authorization_code', code_verifier: est.code_verifier,
    }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) {
    console.error('google_conectar: troca do código falhou', r.status, tok.error, tok.error_description);
    return pagina(502, `O Google recusou a conexão (${tok.error ?? r.status}). Tente de novo pelo app.`);
  }
  if (!tok.refresh_token) {
    return pagina(502, 'O Google não mandou o acesso permanente. Em myaccount.google.com/permissions, remova o J.A.R.V.I.S. e conecte de novo.');
  }
  const escopos = String(tok.scope ?? '').split(' ').filter(Boolean);
  const faltam = ESCOPOS.filter((e) => e.startsWith('https://') && !escopos.includes(e));
  const eu = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } })
    .then((x) => x.json()).catch(() => ({}));

  const { data: integ, error } = await sb.from('integrations').upsert({
    user_id: est.user_id, provider: 'google', account_email: eu.email ?? null, scopes: escopos,
    status: 'ativa', connected_at: new Date().toISOString(), last_error: null, deleted_at: null,
  }, { onConflict: 'user_id,provider' }).select('id').single();
  if (error) return pagina(500, `Não consegui guardar a conexão (${error.message}).`);
  const v = await sb.rpc('integracao_guardar_token', { p_integracao: integ.id, p_token: tok.refresh_token });
  if (v.error) return pagina(500, `Não consegui guardar o acesso com segurança (${v.error.message}).`);
  await sb.from('oauth_states').delete().lt('expires_at', new Date(Date.now() - 86_400_000).toISOString());

  return pagina(200, [
    `Google conectado${eu.email ? `: ${eu.email}` : ''}.`,
    faltam.length ? `Atenção: o Google não liberou tudo (${faltam.map((f) => f.split('/').pop()).join(', ')}). Para o e-mail funcionar inteiro, conecte de novo e marque todas as caixas.` : '',
    'Pode fechar esta aba e voltar ao J.A.R.V.I.S.',
  ].filter(Boolean).join('\n'));
}

async function desconectar(userId: string) {
  const sb = servico();
  const { data: integ } = await sb.from('integrations').select('id').eq('user_id', userId).eq('provider', 'google').maybeSingle();
  if (!integ) return json(200, { ok: true, status: 'revogada' });
  const { data: token } = await sb.rpc('integracao_ler_token', { p_integracao: integ.id });
  if (token) {
    // Revoga no Google também (se falhar, o segredo some do mesmo jeito).
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token as string)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => null);
  }
  await sb.rpc('integracao_apagar_token', { p_integracao: integ.id });
  await sb.from('integrations').update({ status: 'revogada', last_error: null }).eq('id', integ.id);
  return json(200, { ok: true, status: 'revogada' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  if (req.method === 'GET') return retorno(url);
  if (req.method !== 'POST') return json(405, { erro: 'Use POST.' });

  const authorization = req.headers.get('Authorization') ?? '';
  const anon = createClient(URL_PROJETO, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const { data: u } = await anon.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  if (!u?.user) return json(401, { erro: 'Faça login.' });
  const corpo = await req.json().catch(() => ({}));
  if (corpo.acao === 'iniciar') return iniciar(u.user.id);
  if (corpo.acao === 'desconectar') return desconectar(u.user.id);
  return json(400, { erro: 'Ação inválida.' });
});
