-- J.A.R.V.I.S. · Fase 1 · conversa (chat de texto e, depois, voz)
-- Mesmas regras da 0001: user_id com RLS por dono, updated_at por trigger,
-- deleted_at para exclusão suave e toda mudança vira linha em `events`.

create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  -- quem respondeu (só nas mensagens do assistente)
  provider         text check (provider in ('groq', 'gemini')),
  model            text,
  latency_ms       integer,
  -- conteúdo sensível nunca vai para o Gemini grátis (etapa 2)
  sensitive        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index conversations_user_updated_idx on public.conversations (user_id, updated_at);
create index messages_user_updated_idx      on public.messages (user_id, updated_at);
create index messages_conversation_idx      on public.messages (conversation_id, created_at);

create trigger conversations_updated_at before update on public.conversations for each row execute function public.set_updated_at();
create trigger messages_updated_at      before update on public.messages      for each row execute function public.set_updated_at();

create trigger conversations_event after insert or update or delete on public.conversations for each row execute function public.log_entity_event();
create trigger messages_event      after insert or update or delete on public.messages      for each row execute function public.log_entity_event();

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
create policy conversations_owner on public.conversations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy messages_owner on public.messages for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter publication supabase_realtime add table public.conversations, public.messages;
