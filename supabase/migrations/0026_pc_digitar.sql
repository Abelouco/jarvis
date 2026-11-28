-- Ajuste v0.2.3: digitar direto no programa, sem o loop do modo controle.
-- O nome da constraint pode variar: solta a que fala de `kind` e recria com o nome padrão.

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
    check (kind in ('abrir', 'midia', 'achar_arquivo', 'ver_tela', 'controlar', 'comando', 'digitar'));
end $$;
