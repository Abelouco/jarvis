-- Fase 4 · Etapa 0: hábitos, conhecimento (notas, capturas, diário) e marcos saem do J.A.R.V.I.S.
-- Decisão do dono (2026-11-26): apagar os dados de vez.
--
-- As TABELAS ficam (vazias) até a fase final: o .apk instalado e a v0.1.25 do PC ainda sincronizam
-- `project_milestones`, `habits`, `habit_logs` e `notes`, e o sync para na primeira tabela que falha.
-- O `drop` delas (e de `tasks.milestone_id`, `buscar_notas`, `juntar_etiquetas`) vai numa migração
-- da fase final, junto com o novo `eas build` do celular.

-- 1. Dados
delete from public.habit_logs;
delete from public.habits;
delete from public.notes;
update public.tasks set milestone_id = null where milestone_id is not null;
delete from public.project_milestones;

-- 2. Rastros: recibos, eventos, memórias e avisos desses tipos
delete from public.undo_receipts where entity_type in ('habits', 'habit_logs', 'notes', 'project_milestones');
delete from public.events where entity_type in ('habits', 'habit_logs', 'notes', 'project_milestones');
delete from public.memories where kind in ('nota', 'captura', 'diario');
delete from public.notices where kind in ('habito_sequencia', 'diario_vazio');
delete from public.notice_rules where kind in ('habito_sequencia', 'diario_vazio');

-- 3. Tipos que deixam de existir
alter table public.notice_rules drop constraint notice_rules_kind_check;
alter table public.notice_rules add constraint notice_rules_kind_check
  check (kind in ('tarefa_atrasada', 'lembrete_hora', 'prazo_projeto', 'resumo_manha', 'resumo_noite'));

alter table public.memories drop constraint memories_kind_check;
alter table public.memories add constraint memories_kind_check check (kind in ('fato', 'preferencia'));
