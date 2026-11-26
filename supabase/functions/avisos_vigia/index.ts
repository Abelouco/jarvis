// J.A.R.V.I.S. · Edge Function `avisos_vigia` (Fase 3): o vigia dos avisos.
// Chamada a cada minuto pelo pg_cron (migração 0014) com a chave do Vault no cabeçalho `x-vigia-chave`.
// Para cada dono: roda os detectores, decide (silenciado / hora fixa / silêncio / enviar), junta os
// parecidos, grava tudo em `notices` (com o motivo) e entrega:
//   'pc'   -> evento `notify` na tabela `events`; o PC aberto mostra a notificação do Windows
//   'push' -> celular, pelo Expo Push (grátis, sem chave; o FCM V1 do dono fica no EAS)
// Sem IA e sem segredo novo: usa só o service role que o Supabase já injeta.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  decidir, detectarAtrasadas, detectarDiario, detectarLembretes, detectarPrazos, detectarSequencias, diaSP, escolherCanais, juntar, somarDias, textoPush,
  type AvisoPronto, type Candidato, type Preferencias, type Regra,
} from './decisao.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let chave: string | null = null;

async function conferirChave(req: Request) {
  if (!chave) {
    const { data, error } = await sb.rpc('avisos_chave_vigia');
    if (error) throw new Error(`chave do vigia: ${error.message}`);
    chave = (data as string | null) ?? null;
  }
  const veio = req.headers.get('x-vigia-chave');
  return !!chave && !!veio && veio === chave;
}

const ok = <T>(r: { data: T | null; error: { message: string } | null }, onde: string): T => {
  if (r.error) throw new Error(`${onde}: ${r.error.message}`);
  return (r.data ?? []) as T;
};

type Cfg = Preferencias & { user_id: string };
type Linha = {
  id: string; user_id: string; kind: string; entity_type: string | null; entity_id: string | null;
  title: string; body: string; reason: string; priority: AvisoPronto['priority']; status: string;
  channels: string[]; scheduled_for: string | null; sent_at: string | null; group_id: string | null; dedupe_key: string;
};

async function vigiar(cfg: Cfg, agora: Date) {
  const uid = cfg.user_id;
  const iso = agora.toISOString();
  const hoje = diaSP(agora);
  const [lembretes, tarefas, regras, aparelhos, pendentes, recentes, habitos, registros, projetos, diario] = await Promise.all([
    sb.from('reminders').select('id, title, remind_at, priority, alarm').eq('user_id', uid)
      .is('deleted_at', null).is('done_at', null)
      .lte('remind_at', iso).gt('remind_at', new Date(agora.getTime() - 30 * 60_000).toISOString()),
    sb.from('tasks').select('id, title, due_date, due_time, priority').eq('user_id', uid)
      .is('deleted_at', null).is('done_at', null).eq('archived', false)
      .gte('due_date', somarDias(hoje, -2)).lte('due_date', hoje),
    sb.from('notice_rules').select('kind, entity_id, active, fixed_time, muted_until').eq('user_id', uid).is('deleted_at', null),
    sb.from('devices').select('id, platform, seen_at, push_token').eq('user_id', uid).is('deleted_at', null),
    sb.from('notices').select('*').eq('user_id', uid).is('deleted_at', null)
      .in('status', ['agendado', 'segurado_silencio']).lte('scheduled_for', iso),
    sb.from('notices').select('kind, sent_at').eq('user_id', uid).eq('status', 'enviado')
      .gte('sent_at', new Date(agora.getTime() - 15 * 60_000).toISOString()),
    sb.from('habits').select('id, name, kind, daily_target, weekdays, times_per_week, paused').eq('user_id', uid)
      .is('deleted_at', null).eq('paused', false),
    sb.from('habit_logs').select('habit_id, day, value').eq('user_id', uid).is('deleted_at', null)
      .gte('day', somarDias(hoje, -60)),
    sb.from('projects').select('id, name, due_date, status').eq('user_id', uid).is('deleted_at', null)
      .eq('archived', false).neq('status', 'concluido').gte('due_date', somarDias(hoje, 1)).lte('due_date', somarDias(hoje, 3)),
    sb.from('notes').select('id').eq('user_id', uid).is('deleted_at', null).eq('kind', 'diario').eq('day', hoje).limit(1),
  ]);
  const listaRegras = ok(regras, 'regras') as Regra[];
  const listaAparelhos = ok(aparelhos, 'aparelhos') as { id: string; platform: string; seen_at: string; push_token: string | null }[];

  // 1. candidatos novos (os que já foram registrados, pela dedupe_key, ficam de fora)
  let candidatos: Candidato[] = [
    ...detectarLembretes(ok(lembretes, 'lembretes') as never, agora),
    ...detectarAtrasadas(ok(tarefas, 'tarefas') as never, agora),
    ...detectarSequencias(ok(habitos, 'habitos') as never, ok(registros, 'registros') as never, cfg, agora),
    ...detectarPrazos(ok(projetos, 'projetos') as never, agora),
    ...detectarDiario((ok(diario, 'diario') as unknown[]).length > 0, cfg, agora),
  ];
  if (candidatos.length) {
    const vistos = ok(await sb.from('notices').select('dedupe_key').eq('user_id', uid)
      .in('dedupe_key', candidatos.map((c) => c.dedupe_key)), 'dedupe') as { dedupe_key: string }[];
    const ja = new Set(vistos.map((v) => v.dedupe_key));
    candidatos = candidatos.filter((c) => !ja.has(c.dedupe_key));
  }

  // 2. decisão de cada novo
  const novas: Linha[] = [];
  const prontos: AvisoPronto[] = [];
  for (const c of candidatos) {
    const d = decidir(c, cfg, listaRegras, agora);
    const id = crypto.randomUUID();
    novas.push({
      id, user_id: uid, kind: c.kind, entity_type: c.entity_type, entity_id: c.entity_id,
      title: c.title, body: c.body, reason: d.nota ? `${c.reason} Não saiu na hora: ${d.nota}.` : c.reason,
      priority: c.priority, status: d.status === 'enviar' ? 'enviado' : d.status,
      channels: [], scheduled_for: d.scheduled_for, sent_at: null, group_id: null, dedupe_key: c.dedupe_key,
    });
    if (d.status === 'enviar') prontos.push({ id, kind: c.kind, title: c.title, body: c.body, priority: c.priority });
  }
  // os que estavam esperando (silêncio, hora fixa, janela) e chegou a hora
  const liberados = ok(pendentes, 'pendentes') as Linha[];
  for (const l of liberados) prontos.push({ id: l.id, kind: l.kind, title: l.title, body: l.body, priority: l.priority });

  // 3. juntar e escolher o canal
  const ultimoEnvio: Record<string, string> = {};
  for (const r of ok(recentes, 'recentes') as { kind: string; sent_at: string }[]) {
    if (!ultimoEnvio[r.kind] || r.sent_at > ultimoEnvio[r.kind]!) ultimoEnvio[r.kind] = r.sent_at;
  }
  const { entregas, adiar } = juntar(prontos, ultimoEnvio, agora, () => crypto.randomUUID());

  const porId = new Map(novas.map((n) => [n.id, n]));
  const grupos: Linha[] = [];
  const mudancas = new Map<string, Partial<Linha>>(); // para os liberados (já gravados)
  const mudar = (id: string, campos: Partial<Linha>) => {
    const n = porId.get(id);
    if (n) Object.assign(n, campos);
    else mudancas.set(id, { ...(mudancas.get(id) ?? {}), ...campos });
  };
  const notificar: { id: string; titulo: string; corpo: string; prioridade: string }[] = [];
  const pushes: { id: string; title: string; body: string; priority: string }[] = [];

  for (const a of adiar) mudar(a.id, { status: 'agendado', scheduled_for: a.ate });
  for (const e of entregas) {
    const canais = escolherCanais(e.principal, listaAparelhos, agora);
    const enviado = { status: 'enviado', channels: canais, sent_at: iso };
    if (e.grupoNovo) {
      const nomes = e.filhos.length;
      grupos.push({
        id: e.principal.id, user_id: uid, kind: e.principal.kind, entity_type: null, entity_id: null,
        title: e.principal.title, body: e.principal.body,
        reason: `Juntei ${nomes} avisos do mesmo tipo que chegaram juntos, para não mandar um por um.`,
        priority: e.principal.priority, ...enviado, scheduled_for: null, group_id: null,
        dedupe_key: `grupo:${e.principal.id}`,
      });
      for (const f of e.filhos) mudar(f.id, { status: 'juntado', group_id: e.principal.id, sent_at: iso });
    } else {
      mudar(e.principal.id, enviado);
    }
    if (canais.includes('pc')) {
      notificar.push({ id: e.principal.id, titulo: e.principal.title, corpo: e.principal.body, prioridade: e.principal.priority });
    }
    if (canais.includes('push')) pushes.push({ id: e.principal.id, title: e.principal.title, body: e.principal.body, priority: e.principal.priority });
  }

  // 4. gravar: grupos primeiro (os filhos apontam para eles); a dedupe_key única protege de duas rodadas juntas
  if (grupos.length) ok(await sb.from('notices').insert(grupos), 'grupos');
  let gravadas = new Set<string>();
  if (novas.length) {
    const r = ok(await sb.from('notices').upsert(novas, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).select('id'), 'novas') as { id: string }[];
    gravadas = new Set(r.map((x) => x.id));
  }
  for (const [id, campos] of mudancas) {
    // só muda se ainda estiver esperando (outra rodada pode ter liberado antes)
    ok(await sb.from('notices').update(campos).eq('id', id).in('status', ['agendado', 'segurado_silencio']).select('id'), 'liberar');
  }
  const entregar = notificar.filter((n) => gravadas.has(n.id) || mudancas.has(n.id) || grupos.some((g) => g.id === n.id));
  if (entregar.length) {
    ok(await sb.from('events').insert(entregar.map((n) => ({
      user_id: uid, kind: 'notify', entity_type: 'notices', entity_id: n.id,
      payload: { titulo: n.titulo, corpo: n.corpo, prioridade: n.prioridade },
    }))), 'eventos');
  }
  const valeu = (id: string) => gravadas.has(id) || mudancas.has(id) || grupos.some((g) => g.id === id);
  const enviados = await enviarPush(pushes.filter((p) => valeu(p.id)), listaAparelhos);
  return { novos: gravadas.size, liberados: mudancas.size, grupos: grupos.length, notificados: entregar.length, push: enviados };
}

/**
 * Expo Push: https://exp.host/--/api/v2/push/send (grátis, até 100 por chamada).
 * Aparelho que saiu (app desinstalado, permissão tirada) volta `DeviceNotRegistered`: o token é apagado.
 */
async function enviarPush(
  avisos: { id: string; title: string; body: string; priority: string }[],
  aparelhos: { id: string; platform: string; push_token: string | null }[],
) {
  const alvos = aparelhos.filter((d) => d.platform === 'android' && d.push_token);
  if (!avisos.length || !alvos.length) return 0;
  const msgs = avisos.flatMap((a) => alvos.map((d) => ({
    aparelho: d.id,
    msg: {
      to: d.push_token!, ...textoPush(a), sound: 'default', channelId: 'avisos',
      priority: a.priority === 'baixa' ? 'normal' : 'high', data: { notice_id: a.id },
    },
  })));
  const r = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(msgs.map((m) => m.msg)),
  });
  if (!r.ok) {
    console.error('push:', r.status, (await r.text()).slice(0, 300));
    return 0;
  }
  const { data } = await r.json() as { data?: { status: string; details?: { error?: string } }[] };
  let ok = 0;
  for (const [i, t] of (data ?? []).entries()) {
    if (t.status === 'ok') ok++;
    else if (t.details?.error === 'DeviceNotRegistered') {
      await sb.from('devices').update({ push_token: null }).eq('id', msgs[i]!.aparelho);
    } else console.error('push:', t.details?.error ?? t.status);
  }
  return ok;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('use POST', { status: 405 });
  try {
    if (!(await conferirChave(req))) return new Response('não autorizado', { status: 401 });
    const agora = new Date();
    const donos = ok(await sb.from('notice_settings').select('user_id, quiet_start, quiet_end')
      .eq('enabled', true).is('deleted_at', null), 'preferencias') as Cfg[];
    const resultado: Record<string, unknown> = {};
    for (const cfg of donos) {
      try {
        resultado[cfg.user_id.slice(0, 8)] = await vigiar(cfg, agora);
      } catch (e) {
        console.error('vigia:', cfg.user_id.slice(0, 8), e);
        resultado[cfg.user_id.slice(0, 8)] = { erro: String(e) };
      }
    }
    return Response.json({ ok: true, resultado });
  } catch (e) {
    console.error('vigia:', e);
    return Response.json({ ok: false, erro: String(e) }, { status: 500 });
  }
});
