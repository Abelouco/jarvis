-- Fase 4 · Etapa 6: finanças sem banco (lançamentos digitados ou falados). Desenho em docs/fase4-acoes.md.
-- (O desenho chamava de 0020; a 0020 foi usada pelo botão Parar.)
-- fin_accounts      -> contas, cartões e carteira
-- fin_transactions  -> despesas, receitas e transferências (centavos inteiros, nunca float)
-- fin_recurring     -> contas fixas (todo mês no mesmo dia)
-- Tudo de finanças é sensível: só Groq, nunca Gemini; push sai como "conteúdo reservado".

create table if not exists public.fin_accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 80),
  kind                  text not null default 'conta' check (kind in ('conta', 'cartao', 'carteira')),
  opening_balance_cents bigint not null default 0,
  closing_day           smallint check (closing_day between 1 and 31),
  due_day               smallint check (due_day between 1 and 31),
  archived              boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create unique index if not exists fin_accounts_nome_idx on public.fin_accounts (user_id, lower(name)) where deleted_at is null;

create table if not exists public.fin_recurring (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  description   text not null check (char_length(description) between 1 and 200),
  kind          text not null default 'despesa' check (kind in ('despesa', 'receita')),
  amount_cents  bigint not null check (amount_cents > 0),
  account_id    uuid references public.fin_accounts (id),
  category      text,
  day_of_month  smallint not null check (day_of_month between 1 and 31),
  active        boolean not null default true,
  until         date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists public.fin_transactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind               text not null check (kind in ('despesa', 'receita', 'transferencia')),
  amount_cents       bigint not null check (amount_cents > 0),
  account_id         uuid references public.fin_accounts (id),
  to_account_id      uuid references public.fin_accounts (id),
  occurred_on        date not null,
  category           text,
  description        text not null check (char_length(description) between 1 and 200),
  paid               boolean not null default true,
  due_on             date,
  recurring_id       uuid references public.fin_recurring (id),
  installment_group  uuid,
  installment_no     smallint,
  installment_total  smallint,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint fin_transferencia_destino check (kind <> 'transferencia' or to_account_id is not null)
);
create index if not exists fin_transactions_mes_idx on public.fin_transactions (user_id, occurred_on) where deleted_at is null;
create index if not exists fin_transactions_vencer_idx on public.fin_transactions (user_id, due_on) where deleted_at is null and not paid;
create index if not exists fin_transactions_fixa_idx on public.fin_transactions (recurring_id) where deleted_at is null;

-- ---------- RLS, updated_at, eventos, realtime ----------
do $$
declare t text;
begin
  foreach t in array array['fin_accounts', 'fin_recurring', 'fin_transactions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_dono', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_dono', t);
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('drop trigger if exists %I on public.%I', t || '_event', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_entity_event()', t || '_event', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
