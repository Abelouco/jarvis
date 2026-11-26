# J.A.R.V.I.S. — contexto para o Claude Code

Assistente de IA pessoal do dono deste repositório, no PC (Windows) e no celular. Responda sempre em português do Brasil.

## Visão
- Mais rápido e fluido que o app Néctar (a referência estudada). Diferencial: design e um "cérebro" visível que pulsa a partir de eventos reais (cada nó é um dado real; cada pulso, um evento real).
- Local-first: cada aparelho tem banco local (SQLite) e responde na hora; o núcleo na nuvem sincroniza e transmite eventos.

## Stack decidida
- Monorepo TypeScript (pnpm workspaces): `apps/mobile` (Expo), `apps/desktop` (Tauri), `packages/core` (tipos, regras, sync, cliente Supabase compartilhados).
- Núcleo: Supabase, plano gratuito, região São Paulo, projeto ref `pmqxeikcnuywvcxkeoep`. Schema em `supabase/migrations/`.
- IA, só serviços gratuitos por enquanto: Groq (caminho rápido + transcrição Whisper) e Gemini Flash (raciocínio), com troca automática quando um bater o limite. Nada sensível vai para o Gemini grátis (pode treinar com os dados).
- Pesquisa na web: Tavily (secret `TAVILY_API_KEY`); o Groq gera as consultas e o `gpt-oss-120b` escreve a resposta só com os trechos. As chaves (Groq, Gemini, Tavily) são do dono e ficam no servidor: se houver outros usuários, todos gastam a cota dele (pensar em limite por pessoa).
- Voz falada: voz própria no perfil "confiante e distante" (o dono achou lenta demais: ritmo natural). Nunca clonar voz de pessoa real. No PC: Piper local (voz pt_BR-faber-medium, ~85 MB baixados pelo app na pasta do programa, conferidos por SHA-256; `src-tauri/src/voz.rs`), um pouco mais grave via Web Audio; reserva: voz do Windows.
- Resposta por voz: a tela mostra a resposta completa; a voz fala só um resumo curto (`fala.ts`, Groq), com palavras em inglês escritas como se pronunciam (o Piper pt-BR só lê português).
- Memória de pesquisas: pesquisa que deu resposta citada fica em `web_searches` (trechos); pergunta igual sobre algo que não muda reaproveita (0 crédito). O Groq decide no mesmo passo que gera as consultas.
- Transcrição: Groq Whisper large-v3 com dica de vocabulário + contexto da conversa, e uma revisão por LLM do Groq que só corrige nomes em inglês "aportuguesados" (`ia_transcrever`).
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

## Como rodar e publicar
- PC (dev): `pnpm desktop` (Tauri + Vite na porta 1420).
- PC (release): `pnpm.cmd release:pc X.Y.Z` numa aba do Terminal, com tudo commitado. Sobe a versão, cria a tag e envia; o GitHub Actions (`release-pc.yml`) gera o .exe assinado e o `latest.json` no GitHub Releases, e o app instalado se atualiza sozinho. Chave do updater em `C:\Users\abeld\.tauri\jarvis-updater.key` (secrets `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` no GitHub); só a pública fica no `tauri.conf.json`.
- Celular: app Android instalado (.apk do EAS, perfil `preview`). Comandos do EAS rodam **dentro de `apps\mobile`** (na raiz ele cria um `app.json` vazio e falha). Mudança só de JS/tela → `npx.cmd eas-cli@latest update --channel preview --environment preview --message "..." --non-interactive` (chega sem reinstalar). Mudança nativa (plugin, permissão, módulo novo) → novo `eas build -p android --profile preview`.
- Release do Android usa R8: módulo nativo do Expo que quebrar no .apk pode precisar de regra em `extraProguardRules` (app.json, plugin expo-build-properties).
- Comandos globais/EAS rodam numa aba do Terminal com `npm.cmd`/`pnpm.cmd`/`npx.cmd` (o shell do Claude isola o AppData).

## Ambiente do dono
- Windows. C: é HD antigo e quase cheio; o projeto fica em `D:\JARVIS` (HD externo) até chegar um SSD. Evite baixar modelos de IA locais grandes.
- Orçamento: zero por enquanto. Sempre que uma ferramenta, plugin, MCP ou skill puder economizar tokens ou melhorar o resultado, sugira.

## Roteiro
- Fase 0 (concluída em 2026-11-21): schema no Supabase, monorepo, login (e-mail e senha, conta criada pelo próprio app; RLS), banco local + sync, núcleo 3D compartilhado, .apk Android via EAS (com EAS Update) e teste ponta a ponta aprovado (tarefa criada no celular aparece no PC e o evento chega).
- Fase 1 (concluída no PC em 2026-11-25): chat de texto, roteador Groq/Gemini com filtro de sensível, memória com nós no núcleo, pesquisa na web sempre (Tavily, com memória de pesquisas), instalador com auto-update e voz (Whisper + Piper, resumo falado). Pendente para quando voltarmos ao celular: levar voz, menu de copiar e as mudanças de tela recentes para `apps/mobile` (novo `eas build`).
- Fase 2 (concluída no PC em 2026-11-26, v0.1.24): paridade com o Néctar, começando pelo PC. Etapa 1 (tarefas por conversa: `ia_conversar/tarefas.ts`, planejador Groq em JSON + execução com recibo e confirmação `cf_`) feita em 2026-11-25 (com tarefas fixas). Etapa 2 (lembretes: `ia_conversar/lembretes.ts` registrado no mesmo planejador, aba Lembretes e aviso no Windows pelo app aberto, `apps/desktop/src/lembretes.ts`) feita em 2026-11-25. Etapa 3 (projetos: migração 0011 com `project_milestones` e `tasks.milestone_id`/`board_column`; `ia_conversar/projetos.ts` com `aoCriarTarefa`/`contexto` no planejador; aba Projetos com marcos e quadro A fazer/Fazendo/Feito, `apps/desktop/src/projetos.ts`; nós dourados no núcleo) feita em 2026-11-25. Etapa 4 (hábitos: migração 0012; regras puras em `packages/core/src/habitos.ts` com cópia `ia_conversar/habitos_regras.ts` conferida por teste; registro do dia com id fixo `idRegistro(hábito, dia)`; `ia_conversar/habitos.ts`; aba Hábitos com sequência, semana, 14 dias e aviso no horário, `apps/desktop/src/habitos.ts`) feita em 2026-11-25. Etapa 5 (conhecimento: migração 0013 com `notes` nota/captura/diário, busca `buscar_notas`; `ia_conversar/conhecimento.ts`; `jarvis.conhecimento` no core; diário com id fixo `idRegistro('diario:'+dono, dia)`) servidor feito em 2026-11-25; aba feita pelo Cursor e revisada em 2026-11-26. Etapa 6 (painel do dia: aba Hoje, `apps/desktop/src/hoje.ts`, só junta o que já existe) feita pelo Cursor e revisada em 2026-11-26. Pendente para o celular: levar as abas Lembretes, Projetos, Hábitos, Conhecimento e Hoje para `apps/mobile`.
- Fase 2 (escopo): tarefas, lembretes, projetos, hábitos, conhecimento, painel do dia, e a IA agindo neles por conversa (ferramentas `dominio_verbo`).
- Fase 3 (próxima): proatividade (eventos, canais externos, silêncio e teto de avisos).
- Fase 4: ações no mundo (computador, calendário, e-mail), finanças e saúde opcionais.
