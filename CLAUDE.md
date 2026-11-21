# J.A.R.V.I.S. — contexto para o Claude Code

Assistente de IA pessoal do dono deste repositório, no PC (Windows) e no celular. Responda sempre em português do Brasil.

## Visão
- Mais rápido e fluido que o app Néctar (a referência estudada). Diferencial: design e um "cérebro" visível que pulsa a partir de eventos reais (cada nó é um dado real; cada pulso, um evento real).
- Local-first: cada aparelho tem banco local (SQLite) e responde na hora; o núcleo na nuvem sincroniza e transmite eventos.

## Stack decidida
- Monorepo TypeScript (pnpm workspaces): `apps/mobile` (Expo), `apps/desktop` (Tauri), `packages/core` (tipos, regras, sync, cliente Supabase compartilhados).
- Núcleo: Supabase, plano gratuito, região São Paulo, projeto ref `pmqxeikcnuywvcxkeoep`. Schema em `supabase/migrations/`.
- IA, só serviços gratuitos por enquanto: Groq (caminho rápido + transcrição Whisper) e Gemini Flash (raciocínio), com troca automática quando um bater o limite. Nada sensível vai para o Gemini grátis (pode treinar com os dados).
- Voz falada: voz própria no perfil "lento, confiante e distante". Nunca clonar voz de pessoa real.
- Cérebro: WebGL (Three.js) alimentado pela tabela `events` via Supabase Realtime.

## Regras do banco (não quebrar)
- Toda tabela: `user_id` com RLS por dono, `updated_at` (trigger) e `deleted_at` (exclusão suave, nunca DELETE de verdade pelo app).
- Toda mudança de entidade gera linha em `events` (trigger `log_entity_event`).
- Ações arriscadas: prévia + código `cf_…` em `pending_confirmations`. Toda escrita gera recibo em `undo_receipts` (desfazer por 24 h).
- Mudança de schema = nova migração numerada em `supabase/migrations/`, nunca editar uma já aplicada.

## Convenções herdadas do Néctar
- Ferramentas da IA nomeadas `dominio_verbo` em português (ex.: `tarefas_criar`).
- Referências aceitam "nome ou id".
- Datas `AAAA-MM-DD`, horas `HH:MM`, fuso `America/Sao_Paulo`.
- Respostas das ferramentas em camadas: resumo, fatos estruturados, texto pronto, ids.

## Ambiente do dono
- Windows. C: é HD antigo e quase cheio; o projeto fica em `D:\JARVIS` (HD externo) até chegar um SSD. Evite baixar modelos de IA locais grandes.
- Orçamento: zero por enquanto. Sempre que uma ferramenta, plugin, MCP ou skill puder economizar tokens ou melhorar o resultado, sugira.

## Roteiro
- Fase 0 (atual): núcleo e sync. Feito: schema no Supabase. Próximo: monorepo, login (e-mail e senha, conta criada pelo próprio app; dados isolados por RLS), banco local + sync, primeiro teste ponta a ponta (cria tarefa no celular → aparece no PC → evento chega).
- Fase 1: conversa por chat e voz, roteador rápido/inteligente, memória.
- Fase 2: paridade com o Néctar (tarefas, lembretes, projetos, hábitos, conhecimento, painel do dia).
- Fase 3: proatividade (eventos, canais externos, silêncio e teto de avisos).
- Fase 4: ações no mundo (computador, calendário, e-mail), finanças e saúde opcionais.
