-- Fase 4 · Etapa 8: modo controle (sessão com prazo, controlar e comando com cf_).
-- O app do PC executa. O servidor só grava a sessão e o pedido.

create table if not exists public.pc_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  authorized_until timestamptz not null,
  reason           text,
  ended_at         timestamptz,
  ended_by         text check (ended_by in ('dono', 'tempo', 'panico')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists pc_sessions_aberta_idx
  on public.pc_sessions (user_id)
  where ended_at is null and deleted_at is null;

-- O nome da constraint pode variar: solta a que fala de `kind` / `status` e recria com o nome padrão.
do $$
declare nome text;
begin
  select conname into nome from pg_constraint
   where conrelid = 'public.pc_commands'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%';
  if nome is not null then
    execute format('alter table public.pc_commands drop constraint %I', nome);
  end if;
  alter table public.pc_commands add constraint pc_commands_kind_check
    check (kind in ('abrir', 'midia', 'achar_arquivo', 'ver_tela', 'controlar', 'comando'));

  select conname into nome from pg_constraint
   where conrelid = 'public.pc_commands'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%';
  if nome is not null then
    execute format('alter table public.pc_commands drop constraint %I', nome);
  end if;
  alter table public.pc_commands add constraint pc_commands_status_check
    check (status in ('pendente', 'executando', 'feito', 'falhou', 'cancelado', 'aguardando_cf'));
end $$;

alter table public.pc_commands add column if not exists session_id uuid references public.pc_sessions (id);
alter table public.pc_commands add column if not exists confirmation_code text;

-- ---------- RLS, updated_at, eventos, realtime (o mesmo bloco da 0023) ----------
do $$
declare t text;
begin
  foreach t in array array['pc_sessions'] loop
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
