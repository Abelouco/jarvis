-- Fase 4 · Etapa 4: conexão com o Google (OAuth com PKCE). Desenho em docs/fase4-acoes.md.
-- integrations -> uma por provedor e dono; o refresh token fica SÓ no Vault (vault_secret_id), nunca numa coluna.
-- oauth_states -> `state` de uso único (10 min) + code_verifier (PKCE): liga o retorno do Google ao dono certo.
-- O app só lê `integrations` (RLS). Gravar, ler o token e apagar é só pela Edge Function `google_conectar`
-- (service_role), pelas funções `integracao_*` abaixo.

create table if not exists public.integrations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider        text not null check (provider in ('google')),
  account_email   text,
  scopes          text[] not null default '{}',
  status          text not null default 'ativa' check (status in ('ativa', 'expirada', 'revogada')),
  vault_secret_id uuid,
  connected_at    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint integrations_unica unique (user_id, provider)
);

create table if not exists public.oauth_states (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  provider      text not null check (provider in ('google')),
  state         text not null unique,
  code_verifier text not null,
  expires_at    timestamptz not null default now() + interval '10 minutes',
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- integrations: o dono só LÊ (escrita só pela Edge Function com service_role).
alter table public.integrations enable row level security;
drop policy if exists integrations_dono_ler on public.integrations;
create policy integrations_dono_ler on public.integrations for select to authenticated
  using ((select auth.uid()) = user_id);
drop trigger if exists integrations_updated_at on public.integrations;
create trigger integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();
drop trigger if exists integrations_event on public.integrations;
create trigger integrations_event after insert or update or delete on public.integrations
  for each row execute function public.log_entity_event();
do $$ begin
  alter publication supabase_realtime add table public.integrations;
exception when duplicate_object then null;
end $$;

-- oauth_states: ninguém de fora lê nem escreve (RLS sem política); só service_role.
alter table public.oauth_states enable row level security;

-- ---------- token no Vault (só service_role) ----------
create or replace function public.integracao_guardar_token(p_integracao uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  atual uuid;
  novo  uuid;
begin
  select vault_secret_id into atual from public.integrations where id = p_integracao;
  if atual is not null then
    perform vault.update_secret(atual, p_token);
    return atual;
  end if;
  novo := vault.create_secret(p_token, 'integracao_' || p_integracao::text, 'refresh token (J.A.R.V.I.S.)');
  update public.integrations set vault_secret_id = novo where id = p_integracao;
  return novo;
end;
$$;

create or replace function public.integracao_ler_token(p_integracao uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select s.decrypted_secret
    from public.integrations i
    join vault.decrypted_secrets s on s.id = i.vault_secret_id
   where i.id = p_integracao and i.deleted_at is null;
$$;

create or replace function public.integracao_apagar_token(p_integracao uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  atual uuid;
begin
  select vault_secret_id into atual from public.integrations where id = p_integracao;
  if atual is not null then
    delete from vault.secrets where id = atual;
  end if;
  update public.integrations set vault_secret_id = null where id = p_integracao;
end;
$$;

revoke all on function public.integracao_guardar_token(uuid, text) from public, anon, authenticated;
revoke all on function public.integracao_ler_token(uuid) from public, anon, authenticated;
revoke all on function public.integracao_apagar_token(uuid) from public, anon, authenticated;
grant execute on function public.integracao_guardar_token(uuid, text) to service_role;
grant execute on function public.integracao_ler_token(uuid) to service_role;
grant execute on function public.integracao_apagar_token(uuid) to service_role;
