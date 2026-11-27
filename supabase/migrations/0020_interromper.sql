-- Fase 4 · interromper o raciocínio: o dono para a resposta no meio (botão "Parar" do chat).
-- O app grava uma resposta curta marcada como 'interrompido'; o servidor vê que a pergunta já tem
-- resposta e descarta a dele (não salva nem executa ações). A próxima mensagem continua a conversa.
alter table public.messages drop constraint if exists messages_route_check;
alter table public.messages add constraint messages_route_check
  check (route = any (array['rapido', 'inteligente', 'pesquisa', 'acao', 'interrompido']));
