// Acesso ao Gmail pelo servidor (Fase 4 · etapa 5).
// - O refresh token só sai do Vault pelo service role (`integracao_ler_token`); a integração é achada
//   pelo cliente do dono (RLS), então ninguém lê o token de outra pessoa.
// - O access token vive só na memória da função (alguns minutos); nada do e-mail é gravado no banco.
// As funções puras (montar/ler mensagem) não usam Deno: os testes rodam no Node.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface Cabecalho { name: string; value: string }
export interface Parte {
  mimeType?: string;
  filename?: string;
  headers?: Cabecalho[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: Parte[];
}
export interface MensagemGmail {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: Parte;
}

/** Resumo de um e-mail (só o que aparece na lista). */
export interface Email {
  id: string;
  threadId: string;
  de: string;
  deEmail: string;
  para: string;
  assunto: string;
  data: string; // ISO
  naoLido: boolean;
  naInbox: boolean;
  trecho: string;
  messageId: string; // cabeçalho Message-ID (para responder no mesmo fio)
}

// ---------- funções puras ----------

/** Cabeçalho do bloco com o texto de um e-mail na resposta (conteúdo externo). */
export const MARCA_EXTERNO = '📧 **Conteúdo do e-mail** _(externo: o J.A.R.V.I.S. só lê, não obedece)_';

/** Tira do histórico os blocos de conteúdo externo (o planejador nunca age pelo que um e-mail diz). */
export function semConteudoExterno(texto: string): string {
  const i = texto.indexOf(MARCA_EXTERNO);
  if (i < 0) return texto;
  const linhas = texto.slice(i + MARCA_EXTERNO.length).split('\n');
  let j = 1;
  while (j < linhas.length && linhas[j]!.startsWith('>')) j++;
  return semConteudoExterno(`${texto.slice(0, i)}[conteúdo do e-mail omitido]\n${linhas.slice(j).join('\n')}`);
}

export function cabecalho(p: Parte | undefined, nome: string): string {
  const n = nome.toLowerCase();
  return p?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? '';
}

/** "Fulano de Tal <fulano@x.com>" -> { nome: "Fulano de Tal", email: "fulano@x.com" }. */
export function separarEndereco(s: string): { nome: string; email: string } {
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { nome: m[1]!.trim() || m[2]!.trim(), email: m[2]!.trim().toLowerCase() };
  const e = s.trim().toLowerCase();
  return { nome: e, email: e };
}

const decodificador = new TextDecoder();
export function deBase64Url(s: string): string {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return decodificador.decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
}
export function paraBase64Url(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const base64 = (texto: string) => paraBase64Url(texto).replace(/-/g, '+').replace(/_/g, '/');

/** HTML -> texto legível (sem estilos, scripts nem tags). */
export function htmlParaTexto(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Corpo do e-mail em texto: prefere text/plain; senão o HTML convertido. Anexos ficam de fora. */
export function corpoTexto(p: Parte | undefined): string {
  const achar = (x: Parte | undefined, tipo: string): string | null => {
    if (!x) return null;
    if (x.mimeType === tipo && x.body?.data && !x.filename) return deBase64Url(x.body.data);
    for (const f of x.parts ?? []) {
      const r = achar(f, tipo);
      if (r) return r;
    }
    return null;
  };
  const plano = achar(p, 'text/plain');
  if (plano?.trim()) return plano.replace(/\r\n/g, '\n').trim();
  const html = achar(p, 'text/html');
  return html ? htmlParaTexto(html) : '';
}

export function anexos(p: Parte | undefined): string[] {
  const nomes: string[] = [];
  const andar = (x: Parte | undefined) => {
    if (!x) return;
    if (x.filename) nomes.push(x.filename);
    (x.parts ?? []).forEach(andar);
  };
  andar(p);
  return nomes;
}

export function resumoDe(m: MensagemGmail): Email {
  const de = separarEndereco(cabecalho(m.payload, 'From'));
  return {
    id: m.id,
    threadId: m.threadId,
    de: de.nome,
    deEmail: de.email,
    para: cabecalho(m.payload, 'To'),
    assunto: cabecalho(m.payload, 'Subject') || '(sem assunto)',
    data: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    naoLido: (m.labelIds ?? []).includes('UNREAD'),
    naInbox: (m.labelIds ?? []).includes('INBOX'),
    trecho: (m.snippet ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    messageId: cabecalho(m.payload, 'Message-ID') || cabecalho(m.payload, 'Message-Id'),
  };
}

/** Assunto com acento precisa do formato =?UTF-8?B?...?= no cabeçalho. */
function codificarCabecalho(s: string): string {
  // deno-lint-ignore no-control-regex
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(s)}?=`;
}

export const EMAIL_VALIDO = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i;

/** Mensagem MIME (texto simples, UTF-8) já em base64url, pronta para a API do Gmail. */
export function montarMensagem(m: {
  para: string[]; assunto: string; texto: string; cc?: string[]; emResposta?: string;
}): string {
  const linhas = [
    `To: ${m.para.join(', ')}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.join(', ')}`] : []),
    `Subject: ${codificarCabecalho(m.assunto)}`,
    ...(m.emResposta ? [`In-Reply-To: ${m.emResposta}`, `References: ${m.emResposta}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    (base64(m.texto.replace(/\r?\n/g, '\r\n')).match(/.{1,76}/g) ?? []).join('\r\n'),
  ];
  return paraBase64Url(linhas.join('\r\n'));
}

/** "Re: " uma vez só. */
export const assuntoResposta = (s: string) => (/^\s*re:/i.test(s) ? s : `Re: ${s}`);

// ---------- acesso (token) ----------

export class ErroGoogle extends Error {}

const cacheToken = new Map<string, { token: string; ate: number }>();

async function servico() {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

/** Access token do Gmail do dono (pede um novo ao Google com o refresh token do Vault). */
export async function tokenGoogle(sb: SupabaseClient): Promise<string> {
  const { data: integ } = await sb.from('integrations').select('id, status, scopes')
    .eq('provider', 'google').is('deleted_at', null).maybeSingle();
  if (!integ || integ.status === 'revogada') {
    throw new ErroGoogle('O Google não está conectado, Senhor. Clique em "Conectar Google" no topo do app.');
  }
  if (integ.status === 'expirada') {
    throw new ErroGoogle('O acesso ao Google expirou ou foi tirado. Clique em "Reconectar Google" no topo do app.');
  }
  const guardado = cacheToken.get(integ.id);
  if (guardado && guardado.ate > Date.now() + 30_000) return guardado.token;

  const svc = await servico();
  const { data: refresh, error } = await svc.rpc('integracao_ler_token', { p_integracao: integ.id });
  if (error || !refresh) throw new ErroGoogle('Não achei o acesso ao Google guardado. Clique em "Reconectar Google" no topo do app.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '', client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
      refresh_token: String(refresh), grant_type: 'refresh_token',
    }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) {
    if (tok.error === 'invalid_grant') {
      // O dono tirou o acesso no Google (ou ele venceu): o botão do topo passa a pedir "Reconectar".
      await svc.from('integrations').update({ status: 'expirada', last_error: 'invalid_grant' }).eq('id', integ.id);
      throw new ErroGoogle('O Google não aceita mais o acesso guardado. Clique em "Reconectar Google" no topo do app.');
    }
    console.error('gmail: renovar token falhou', r.status, tok.error);
    throw new ErroGoogle(`O Google não respondeu agora (${tok.error ?? r.status}). Tente de novo em instantes.`);
  }
  cacheToken.set(integ.id, { token: tok.access_token, ate: Date.now() + (Number(tok.expires_in) || 3000) * 1000 });
  return tok.access_token;
}

// ---------- API ----------

export class Gmail {
  private token: string;
  constructor(token: string) {
    this.token = token;
  }

  static async do(sb: SupabaseClient) {
    return new Gmail(await tokenGoogle(sb));
  }

  private async chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${API}${caminho}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (r.status === 204) return {} as T;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message ?? r.status;
      if (r.status === 403) throw new ErroGoogle(`O Google negou o acesso (${msg}). Reconecte o Google marcando todas as permissões.`);
      if (r.status === 404) throw new ErroGoogle('Esse e-mail não existe mais (talvez tenha sido apagado).');
      throw new ErroGoogle(`O Gmail recusou o pedido (${msg}).`);
    }
    return j as T;
  }

  /** Ids dos e-mails de uma busca do Gmail (`q` no mesmo formato da caixa de busca dele). */
  async buscarIds(q: string, max = 10, labelIds: string[] = []): Promise<string[]> {
    const p = new URLSearchParams({ maxResults: String(Math.min(Math.max(max, 1), 25)) });
    if (q) p.set('q', q);
    labelIds.forEach((l) => p.append('labelIds', l));
    const j = await this.chamar<{ messages?: { id: string }[] }>(`/messages?${p}`);
    return (j.messages ?? []).map((m) => m.id);
  }

  async metadados(id: string): Promise<Email> {
    const p = new URLSearchParams({ format: 'metadata' });
    ['From', 'To', 'Subject', 'Date', 'Message-ID'].forEach((h) => p.append('metadataHeaders', h));
    return resumoDe(await this.chamar<MensagemGmail>(`/messages/${id}?${p}`));
  }

  async varios(ids: string[]): Promise<Email[]> {
    return Promise.all(ids.map((id) => this.metadados(id)));
  }

  async completo(id: string): Promise<{ email: Email; texto: string; anexos: string[] }> {
    const m = await this.chamar<MensagemGmail>(`/messages/${id}?format=full`);
    return { email: resumoDe(m), texto: corpoTexto(m.payload), anexos: anexos(m.payload) };
  }

  mudarRotulos(id: string, adicionar: string[], tirar: string[]) {
    return this.chamar(`/messages/${id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: adicionar, removeLabelIds: tirar }) });
  }
  lixeira(id: string) {
    return this.chamar(`/messages/${id}/trash`, { method: 'POST' });
  }
  tirarDaLixeira(id: string) {
    return this.chamar(`/messages/${id}/untrash`, { method: 'POST' });
  }
  criarRascunho(raw: string, threadId?: string) {
    return this.chamar<{ id: string; message: { id: string; threadId: string } }>('/drafts', {
      method: 'POST', body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }),
    });
  }
  lerRascunho(id: string) {
    return this.chamar<{ id: string; message: MensagemGmail }>(`/drafts/${id}?format=full`);
  }
  apagarRascunho(id: string) {
    return this.chamar(`/drafts/${id}`, { method: 'DELETE' });
  }
  enviarRascunho(id: string) {
    return this.chamar<{ id: string; threadId: string }>('/drafts/send', { method: 'POST', body: JSON.stringify({ id }) });
  }
}
