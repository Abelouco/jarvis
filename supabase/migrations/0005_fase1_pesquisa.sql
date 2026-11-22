-- J.A.R.V.I.S. · Fase 1 · respostas com pesquisa na web
-- Perguntas sobre fatos do mundo (jogos, produtos, notícias...) passam pela busca e a
-- resposta guarda as fontes usadas, que o app mostra embaixo dela.

alter table public.messages
  add column sources jsonb;

comment on column public.messages.sources is
  'Fontes da web usadas na resposta: [{"titulo": "...", "url": "https://..."}]';

alter table public.messages drop constraint if exists messages_route_check;
alter table public.messages
  add constraint messages_route_check check (route in ('rapido', 'inteligente', 'pesquisa'));
