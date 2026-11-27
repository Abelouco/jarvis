# Arquitetura do J.A.R.V.I.S.

Mapa técnico para qualquer agente (Claude Code, Cursor/Grok) trabalhar no projeto sem precisar reler o código inteiro.
As decisões e o roteiro ficam em `CLAUDE.md`; este arquivo diz **onde fica cada coisa e como ela se encaixa**.
Responda e comente sempre em português do Brasil.

---

## 1. Visão geral

```
 PC (Tauri + Vite)            Celular (Expo)
 apps/desktop                 apps/mobile   (parado: foco no PC)
      │  usam                      │
      └──────── packages/core ─────┘   tipos, regras, banco local SQLite, sync, cliente Supabase
                packages/nucleo        núcleo 3D (Three.js) compartilhado
                      │
                      ▼  HTTPS + Realtime
 Supabase (projeto pmqxeikcnuywvcxkeoep, São Paulo, plano grátis)
   ├─ Postgres: tabelas com RLS por dono  (supabase/migrations/)
   ├─ Realtime: tabela `events` → pulsos do núcleo
   └─ Edge Functions (Deno):
        ia_conversar   chat, roteador, pesquisa, memória, ferramentas (tarefas, lembretes, projetos, hábitos)
        ia_transcrever Whisper do Groq + revisão de nomes
        avisos_vigia   vigia dos avisos (pg_cron a cada minuto): detecta, decide, grava em `notices`, entrega
                      │
                      ▼
   Groq (rápido, sensível, transcrição)  ·  Gemini Flash (raciocínio, nunca sensível)  ·  Tavily (busca)
```

**Local-first:** a tela lê e escreve no SQLite local na hora (`dirty = 1`). O sync sobe o que está sujo e baixa o que mudou (`updated_at`). O servidor nunca é esperado para mostrar algo.

---

## 2. Mapa de pastas

| Caminho | O que é |
|---|---|
| `packages/core/src/types.ts` | Tipos das entidades (Task, Reminder, Project, Milestone, Habit, HabitLog, Memory, Message...) |
| `packages/core/src/local.ts` | Esquema do SQLite local, `TABELAS_SYNC` (ordem: pais antes dos filhos), colunas JSON/booleanas |
| `packages/core/src/jarvis.ts` | API que as telas usam: `tarefas`, `lembretes`, `projetos`, `avisos`, `memorias`, conversa, sync, atividades |
| `packages/core/src/recorrencia.ts` | Repetição (diária, dias úteis, semanal, mensal). **Tem cópia** em `ia_conversar/recorrencia.ts` |
| `packages/core/src/markdown.ts` | Markdown → HTML seguro (blocos `opcoes`, `texto`, `powershell`) |
| `packages/nucleo/src/` | Núcleo 3D: esfera, anéis, nós de memória e projeto, pulsos |
| `apps/desktop/src/main.ts` | Casca do app: abas (Hoje, Conversa, Tarefas, Projetos, Lembretes, Avisos, Memória), login, sync |
| `apps/desktop/src/{tarefas via formTarefa,lembretes,projetos,hoje,abaAvisos}.ts` | Cada aba: `htmlX()` + `ligarX(raiz, {pulsar, aoMudar})` |
| `apps/desktop/src/estilo.css` | Todo o visual (variáveis `--ciano`, `--borda`, `--baixa`...) |
| `apps/desktop/src/voz.ts` + `src-tauri/src/voz.rs` | Microfone → `ia_transcrever`; fala com Piper local |
| `apps/desktop/src-tauri/` | Rust/Tauri: janela, notificação (`aviso.rs`), terminal, updater |
| `supabase/functions/ia_conversar/index.ts` | Entrada do chat: grava mensagem, escolhe rota, chama ferramentas ou IA, devolve resposta e fala |
| `.../rota.ts` | Regras locais: `rapido` / `inteligente` / `pesquisa` |
| `.../sensivel.ts` | Detector de conteúdo sensível (sensível nunca vai ao Gemini nem à busca) |
| `.../provedores.ts` | Groq e Gemini (formato OpenAI), troca de modelo e limite |
| `.../busca.ts` | Tavily + reaproveitamento de pesquisas (`web_searches`) |
| `.../memoria.ts` | Lembrar e aprender memórias do dono |
| `.../fala.ts` | Resumo falado e pronúncias ensinadas |
| `.../tarefas.ts` | **Planejador** (Groq em JSON) + executores de tarefas + `registrar()` de extensões + confirmar/cancelar/desfazer |
| `.../lembretes.ts`, `projetos.ts`, `avisos.ts` | Extensões registradas no planejador |
| `supabase/functions/avisos_vigia/` | Vigia dos avisos (Fase 3). `decisao.ts` = regras puras (detectores, silêncio, hora fixa, junção, canal), testadas em `decisao.test.ts`; `index.ts` = banco e entrega. Deploy: os 2 `.ts`, `verify_jwt` desligado (a função confere a chave do Vault no cabeçalho `x-vigia-chave`) |
| `apps/desktop/src/avisos.ts` | Sinal de "PC aberto" (`devices`, a cada minuto) e notificação do Windows quando chega o evento `notify` |
| `.../regras.test.ts` | Testes (rota, datas, recorrência, detectores, hábitos, cópias iguais) |
| `supabase/migrations/NNNN_*.sql` | Schema. Nunca editar uma já aplicada |
| `scripts/release-pc.mjs` | Sobe versão, cria tag, envia → GitHub Actions gera o instalador |

---

## 3. Fluxo de uma mensagem (`ia_conversar`)

1. Valida o login, grava conversa e mensagem (idempotente pelos ids do app) e marca se é sensível.
2. Se já existe resposta para essa pergunta, devolve a mesma.
3. `pareceTarefa(texto)`: regex local (tarefas + `detector` de cada extensão). Se bater, o **planejador** pede ao Groq um JSON `{acoes:[{ferramenta,args}]}` e executa. Cada escrita gera recibo e as ações arriscadas pedem `cf_`. A resposta vem do `texto` das ferramentas.
4. Senão, `escolherRota`:
   - `pesquisa`: Tavily, depois a síntese só com os trechos e as citações `[n]`.
   - `inteligente`: Gemini, com o Groq de reserva.
   - `rapido`: Groq.
5. Se veio por voz, `resumoFalado` em paralelo.
6. Depois de responder, `aprender` extrai memórias em segundo plano.

A IA **nunca calcula datas**: ela devolve `quando`/`dia_semana`/`daqui_dias`/`dia_mes` e quem resolve é o `resolverQuando`.

---

## 4. Receita: novo domínio (ex.: lembretes, projetos, finanças)

Siga a mesma forma de lembretes, projetos e hábitos:

1. **Migração** `supabase/migrations/00NN_nome.sql`:
   - `user_id` + RLS, `updated_at` com trigger e `deleted_at`.
   - Trigger `log_entity_event`.
   - Adicionar a tabela na publicação realtime, se precisar.
2. **Tipos** em `packages/core/src/types.ts`.
3. **Banco local** em `local.ts`: as colunas, o `create table`, e a entrada em `TABELAS_SYNC` (com `json`/`booleanas`, na ordem certa).
4. **API local** em `jarvis.ts`:
   - Criar o objeto `nome = { listar, criar, editar, apagar ... }`.
   - Exportá-lo no retorno.
   - Pôr o título em "atividades".
5. **Regras puras** que app e servidor compartilham vão num arquivo do core, com cópia no servidor e um teste que compara as duas a partir da linha 4.
6. **Servidor** `ia_conversar/nome.ts`: `registrar({ferramentas, regras, detector, executores, confirmar?, contexto?})`.
   - Nomes das ferramentas no padrão `dominio_verbo`.
   - Respostas em camadas: `{ferramenta, ok, resumo, fatos, texto, ids}`.
   - Toda escrita chama `recibo(...)`.
   - Apagar passa por `pedirConfirmacao`.
7. Importar `./nome.ts` no `index.ts`. Acrescentar a tabela em `TIPOS_DESFAZER` e os nomes no mapa do `jarvis_desfazer`, ambos em `tarefas.ts`.
8. **Tela** `apps/desktop/src/nome.ts` (`htmlNome` / `ligarNome`), mais a aba em `main.ts` e o CSS no fim de `estilo.css`.
9. **Testes** em `regras.test.ts`, depois rodar a verificação (seção 6).

---

## 5. Regras que não podem quebrar

- Nunca fazer DELETE pelo app: só `deleted_at`.
- Toda escrita da IA gera recibo em `undo_receipts`, e apagar ou mexer em muitos itens pede confirmação `cf_`.
- Conteúdo sensível só vai para o Groq: nunca para o Gemini nem para a busca.
- Mudança de schema é sempre uma migração nova.
- Datas `AAAA-MM-DD`, horas `HH:MM`, fuso `America/Sao_Paulo` (UTC-3 fixo).
- Arquivos com cópia (`recorrencia` no core e no `ia_conversar`, `sensivel` no `ia_conversar` e no vigia): mudar os dois juntos.
- Não mexer em `apps/mobile` por enquanto (foco no PC).
- Chaves e senhas nunca no código: ficam nos secrets do Supabase, e o dono digita as dele.
- Orçamento zero: nada de serviço pago nem modelo local grande (o C: está quase cheio, o projeto fica no D:).

---

## 6. Comandos

```powershell
pnpm.cmd test                                   # testes (node --test)
pnpm.cmd typecheck                              # tsc em todos os pacotes
pnpm.cmd desktop                                # app de dev (Tauri + Vite :1420)
pnpm.cmd release:pc X.Y.Z                       # publicar (só o dono, com tudo commitado)
```

Publicar o servidor:
- **Migração:** aplicar no Supabase (MCP `apply_migration` ou SQL Editor do painel) com o mesmo nome do arquivo.
- **Edge Function:** fazer o deploy de `ia_conversar` com **todos** os `.ts` da pasta, menos `regras.test.ts`. Sem o MCP, use `npx.cmd supabase functions deploy ia_conversar --project-ref pmqxeikcnuywvcxkeoep` (a CLI envia a pasta inteira).

---

## 7. Divisão de trabalho: Claude Code x Cursor

Objetivo: gastar o mínimo de tokens caros sem perder qualidade. Regra geral: **Claude desenha e integra; Cursor executa o que já tem molde.**

| Tipo de tarefa | Melhor no | Por quê |
|---|---|---|
| Desenho de um domínio novo (schema, ferramentas da IA, regras de negócio) | Claude | Pede contexto do projeto inteiro e decisões que se propagam |
| Migração + deploy no Supabase, prompts do planejador, roteamento, sensível | Claude | Tem o MCP do Supabase; erro aqui quebra dados ou privacidade |
| Bugs que cruzam app ↔ servidor ↔ sync | Claude | Precisa rastrear várias camadas |
| Tela nova seguindo uma aba existente (HTML/CSS/TS de `apps/desktop/src`) | **Cursor** | Trabalho de molde, num arquivo só, com o exemplo ao lado |
| Ajustes visuais, CSS, textos da interface, pequenos refactors | **Cursor** | Edição local rápida, com autocomplete |
| Testes novos seguindo os existentes em `regras.test.ts` | **Cursor** | Repetitivo e bem delimitado |
| Rodar typecheck e testes, corrigir erro de tipo | **Cursor** | Barato, mecânico |
| Revisão final antes de publicar | Claude | Uma passada só no diff, no fim |

**Como passar trabalho de um para o outro (sem os dois mexerem no mesmo arquivo):**
1. Quem desenha deixa a tarefa escrita em `docs/tarefas/<nome>.md`: o objetivo, os arquivos que pode tocar, o "pronto quando" e o molde a copiar. A primeira foi `docs/tarefas/aba-conhecimento.md`.
2. O outro executa, roda `pnpm.cmd typecheck` e `pnpm.cmd test`, e faz um commit pequeno.
3. Quem desenhou revisa só o `git diff` desse commit, e não o projeto inteiro.
4. Nunca os dois editando ao mesmo tempo: o git é o ponto de encontro.

**MCPs de cada lado (para gastar menos contexto):**
- Claude Code: context-mode (corta saída longa), Graphify (mapa do código), Supabase (migração, SQL e deploy).
- Cursor (`.cursor/mcp.json`): context-mode e Supabase **só leitura** (consulta o schema, nunca escreve). Na primeira vez, o Cursor pede para entrar na conta do Supabase; quem entra é o dono.
- O context-mode do Cursor aponta para a pasta da versão instalada pelo Claude Code (`.../context-mode/2.2.4/`); se o plugin atualizar, troque o número no `mcp.json`.
