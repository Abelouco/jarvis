-- Fase 3 · Etapa 1: avisos (proatividade). Desenho em docs/fase3-avisos.md.
-- notice_settings -> preferências do dono (silêncio, horários dos resumos, liga/desliga)
-- notice_rules    -> regras ajustadas pela conversa: desligar um tipo, silenciar um item, "só às 9h"
-- notices         -> registro de cada aviso, com o motivo (o dono vê por que foi avisado)
-- devices         -> aparelhos do dono: sinal de "PC aberto" e, na etapa 2, o token de push do Android
-- O vigia (`avisos_vigia`, Edge Function) roda a cada minuto pelo pg_cron + pg_net, com uma chave
-- gerada aqui mesmo e guardada no Vault (ninguém precisa digitar nada).
-- Sem teto diário (decisão do dono); o volume é controlado por silêncio, junção e regras.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- preferências ----------
create table if not exists public.notice_settings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  enabled     boolean not null default true,
  quiet_start time not null default '22:00',
  quiet_end   time not null default '07:00',
  morning_at  time not null default '08:00',
  evening_at  time not null default '21:00',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- regras ----------
create table if not exists public.notice_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind         text not null check (kind in (
                 'tarefa_atrasada', 'lembrete_hora', 'habito_sequencia', 'prazo_projeto',
                 'diario_vazio', 'resumo_manha', 'resumo_noite')),
  entity_id    uuid,                -- nulo = o tipo inteiro; preenchido = só aquele item
  active       boolean not null default true,
  fixed_time   time,                -- "só às 9h"
  muted_until  timestamptz,         -- "não me avisa disso até sexta"
  note         text,                -- a frase do dono, para mostrar na tela
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index if not exists notice_rules_unica_idx on public.notice_rules
  (user_id, kind, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where deleted_at is null;

-- ---------- registro ----------
create table if not exists public.notices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind          text not null,
  entity_type   text,
  entity_id     uuid,
  title         text not null,
  body          text not null default '',
  reason        text not null,
  priority      text not null default 'normal' check (priority in ('urgente', 'normal', 'baixa')),
  status        text not null check (status in ('enviado', 'segurado_silencio', 'juntado', 'silenciado', 'agendado')),
  channels      text[] not null default '{}',
  scheduled_for timestamptz,
  sent_at       timestamptz,
  read_at       timestamptz,
  group_id      uuid references public.notices (id),
  dedupe_key    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint notices_dedupe_unica unique (user_id, dedupe_key)
);
create index if not exists notices_user_criado_idx on public.notices (user_id, created_at desc);
create index if not exists notices_pendentes_idx on public.notices (scheduled_for)
  where status in ('agendado', 'segurado_silencio') and deleted_at is null;

-- ---------- aparelhos ----------
-- Sem trigger de eventos: o sinal de "aberto" muda a cada minuto e não deve pulsar o núcleo.
create table if not exists public.devices (
  id          uuid primary key,     -- gerado no aparelho e guardado nele
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform    text not null check (platform in ('pc', 'android')),
  name        text,
  push_token  text,
  seen_at     timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- RLS, updated_at, eventos, realtime ----------
do $$
declare t text;
begin
  foreach t in array array['notice_settings', 'notice_rules', 'notices', 'devices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_dono', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_dono', t);
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['notice_settings', 'notice_rules', 'notices'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_event', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_entity_event()', t || '_event', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;

-- Preferências padrão para quem já tem conta (o app cria a linha das contas novas).
insert into public.notice_settings (user_id) select id from auth.users on conflict (user_id) do nothing;

-- ---------- chave do vigia ----------
-- Gerada uma vez; o cron manda no cabeçalho e a função confere pelo `avisos_chave_vigia()`.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'avisos_vigia_chave') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'avisos_vigia_chave', 'Chave do pg_cron para chamar avisos_vigia');
  end if;
end $$;

create or replace function public.avisos_chave_vigia()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'avisos_vigia_chave' limit 1;
$$;
revoke all on function public.avisos_chave_vigia() from public, anon, authenticated;
grant execute on function public.avisos_chave_vigia() to service_role;

-- ---------- agendamento: a cada minuto ----------
select cron.unschedule('avisos_vigia') where exists (select 1 from cron.job where jobname = 'avisos_vigia');
select cron.schedule('avisos_vigia', '* * * * *', $cron$
  select net.http_post(
    url := 'https://pmqxeikcnuywvcxkeoep.supabase.co/functions/v1/avisos_vigia',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-vigia-chave', public.avisos_chave_vigia()),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$cron$);
