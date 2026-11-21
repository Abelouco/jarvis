-- J.A.R.V.I.S. · Fase 1 · roteador rápido/inteligente
-- `ai_usage`: uso de cada provedor de IA por dia e até quando ele está bloqueado
-- (bateu o limite). A Edge Function lê isso para pular quem está sem cota.
-- Não gera linha em `events`: é contador interno, não entidade do dono (não pulsa o cérebro).

create table public.ai_usage (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day            date not null default (now() at time zone 'America/Sao_Paulo')::date,
  provider       text not null check (provider in ('groq', 'gemini')),
  requests       integer not null default 0,
  tokens         integer not null default 0,
  blocked_until  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (user_id, day, provider)
);

create index ai_usage_user_updated_idx on public.ai_usage (user_id, updated_at);
create trigger ai_usage_updated_at before update on public.ai_usage for each row execute function public.set_updated_at();

alter table public.ai_usage enable row level security;
create policy ai_usage_owner on public.ai_usage for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Qual caminho o roteador escolheu para cada resposta.
alter table public.messages
  add column route text check (route in ('rapido', 'inteligente'));
