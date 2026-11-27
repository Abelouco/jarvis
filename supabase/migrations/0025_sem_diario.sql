-- Ajustes pós-v0.2.1: avisos antigos de diário e de hábito saem da lista (exclusão suave).
-- A constraint de kind fica: a v0.1.25 ainda pode ler esses tipos. Isso fica para a fase final.

update public.notices set deleted_at = now() where kind in ('diario_vazio','habito_sequencia') and deleted_at is null;
update public.notice_rules set deleted_at = now() where kind in ('diario_vazio','habito_sequencia') and deleted_at is null;
