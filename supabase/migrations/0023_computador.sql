-- Fase 4 · Etapa 7: computador, parte 1 (abrir, mídia, achar arquivo, ver a tela).
-- O modo controle (mouse, teclado, faixa, pânico) fica para a etapa 8: não entra `controlar` nem `comando`.
-- `ia_conversar` só grava o pedido. O app do PC escuta pelo Realtime, executa e preenche `result`.

create table if not exists public.pc_commands (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('abrir', 'midia', 'achar_arquivo', 'ver_tela')),
  args        jsonb not null default '{}',
  status      text not null default 'pendente' check (status in ('pendente', 'executando', 'feito', 'falhou', 'cancelado')),
  result      jsonb,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists pc_commands_status_idx on public.pc_commands (user_id, status) where deleted_at is null;

-- ---------- RLS, updated_at, eventos, realtime ----------
do $$
declare t text;
begin
  foreach t in array array['pc_commands'] loop
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
