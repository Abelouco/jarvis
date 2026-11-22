-- J.A.R.V.I.S. · Fase 1 · créditos da pesquisa na web
-- O Tavily (busca) também entra em `ai_usage`: `requests` = buscas feitas, `tokens` = créditos gastos
-- (busca básica = 1 crédito). Assim dá para acompanhar o consumo dos 1.000 créditos grátis do mês.

alter table public.ai_usage drop constraint if exists ai_usage_provider_check;
alter table public.ai_usage
  add constraint ai_usage_provider_check check (provider in ('groq', 'gemini', 'tavily'));
