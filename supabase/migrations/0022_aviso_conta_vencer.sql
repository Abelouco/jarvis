-- Fase 4 · Etapa 6: novo tipo de aviso "conta a vencer" (conta fixa, boleto, parcela ou fatura, 2 dias antes e no dia).
alter table public.notice_rules drop constraint notice_rules_kind_check;
alter table public.notice_rules add constraint notice_rules_kind_check
  check (kind in ('tarefa_atrasada', 'lembrete_hora', 'prazo_projeto', 'conta_vencer', 'resumo_manha', 'resumo_noite'));
