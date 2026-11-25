-- Fase 2 · Etapa 1: tarefas por conversa.
-- A IA agora age nas tarefas (ferramentas tarefas_*). A resposta dela nesses casos tem rota 'acao'.

alter table public.messages drop constraint if exists messages_route_check;
alter table public.messages
  add constraint messages_route_check check (route in ('rapido', 'inteligente', 'pesquisa', 'acao'));

-- Listas "hoje / atrasadas / próximas": só tarefas abertas, por prazo.
create index if not exists tasks_user_open_due_idx
  on public.tasks (user_id, due_date, due_time)
  where done_at is null and deleted_at is null;

-- Confirmação pendente mais recente e último recibo a desfazer.
create index if not exists pending_conf_user_open_idx
  on public.pending_confirmations (user_id, created_at desc)
  where used_at is null;
create index if not exists undo_receipts_user_open_idx
  on public.undo_receipts (user_id, entity_type, created_at desc)
  where undone_at is null;
