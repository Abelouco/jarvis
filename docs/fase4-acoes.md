# Fase 4: ações no mundo, desenho aprovado em 2026-11-26

Objetivo: o J.A.R.V.I.S. sai do próprio banco e age no mundo do dono: e-mail, finanças e o próprio computador (ver a tela, controlar, criar imagens, código e vídeos). E aprende com o like/deslike do dono. PC primeiro, celular na fase final. Orçamento zero: só serviços gratuitos.

## Decisões do dono (2026-11-26)
- **Agenda fica fora:** as tarefas com lembrete já cobrem isso.
- E-mail: **Gmail** (conexão OAuth do Google).
- **Finanças entram agora**, sem ligar a banco (lançamentos digitados ou falados). **Saúde fica de fora.**
- Computador: **controle completo quando autorizado**, rápido como um assistente de verdade, acompanhando a tela em tempo real; e **criar imagens, códigos e vídeos**, sempre pedindo autorização antes. Uso pessoal: sem regras extras de direitos autorais.
- No modo controle, a lista do que ainda pede `cf_` (abaixo) foi aprovada como está.
- Pedidos que entram junto:
  - **tema claro e tema escuro** no app (hoje só existe o escuro);
  - **remover por completo as abas Hábitos e Conhecimento e o conteúdo delas, e os marcos** (tela, conversa, servidor, núcleo e dados). O dono aprovou **apagar de vez** os dados;
  - **lembrete na criação de tarefa:** opção de ser lembrado pelo J.A.R.V.I.S. ao criar uma tarefa;
  - **like e deslike nas respostas:** o like fica verde; o deslike abre um campo para o motivo, fica vermelho depois de enviado, e o J.A.R.V.I.S. aprende a não repetir aquela linha de raciocínio. As duas animações são leves.

## Limites honestos (o que o grátis permite)
- "Tempo real" na tela: mandar vídeo contínuo para uma IA não existe de graça. O PC olha a tela localmente cerca de 1 vez por segundo (sem custo) e só manda uma imagem para a IA quando algo mudou ou quando o dono pergunta. O teto é o limite do Groq grátis (por volta de 30 pedidos por minuto, a conferir no console).
- Rapidez: a maior parte das ações usa a **árvore de acessibilidade do Windows** (UI Automation: nomes de botões, campos e textos), que responde em milissegundos, sem imagem. A imagem da tela fica para o que não tem árvore (jogos, canvas, vídeo). O planejador manda **vários passos de uma vez** e o PC executa em sequência, conferindo só no fim.
- Vídeo gerado por IA: não há API gratuita confiável. Nesta fase o vídeo é **montado no PC** (imagens geradas + narração do Piper + legendas, com ffmpeg). Vídeo por IA fica para quando houver orçamento.
- Imagens: Cloudflare Workers AI (FLUX.1 schnell) dá 10.000 "neurons" por dia de graça; uma imagem 512×512 de 4 passos custa algumas dezenas de neurons, então cabem centenas por dia (a conferir na etapa).

## Tabelas e migrações

Regra de sempre: `user_id` + RLS por dono, `updated_at` (trigger), `deleted_at`, `log_entity_event`.

### `0016_limpeza_habitos_conhecimento_marcos.sql`
- Apaga de vez:
  - as tabelas `habits`, `habit_logs`, `notes` e `project_milestones`;
  - a coluna `tasks.milestone_id`;
  - as funções `buscar_notas` e `juntar_etiquetas`;
  - as linhas de `events`, `memories` e `undo_receipts` desses tipos.
- Tira as regras de aviso `habito_sequencia` e `diario_vazio` de `notice_rules` e do `check` de `kind`.
- **Cuidado com o celular:** o .apk instalado sincroniza `habits`, `habit_logs`, `notes` e `project_milestones` (estão no `TABELAS_SYNC` do core que foi no build). Antes de apagar as tabelas, confiro se a falha de uma tabela derruba o sync inteiro no celular. Se derrubar: nesta migração só esvazio as tabelas; o `drop` vai numa migração da fase final, junto com o novo `eas build`.

### `0017_lembrete_da_tarefa.sql`
- `reminders.task_id` (opcional, referência a `tasks`): o lembrete que nasceu de uma tarefa.
- Concluir a tarefa conclui o lembrete; apagar a tarefa apaga o lembrete (exclusão suave); mudar o prazo pergunta se o lembrete acompanha.
- Entra no `TABELAS_SYNC` (coluna nova no banco local).

### `0018_feedback.sql`
- `message_feedback`: `message_id`, `conversation_id`, `rating` (`like` | `dislike`), `reason` (texto do dono no deslike), `lesson_id`.
- `assistant_lessons` (o que o J.A.R.V.I.S. aprendeu):
  - `lesson` (regra curta, ex.: "Não sugerir X quando o dono pede Y; fazer Z");
  - `kind` (`evitar` | `manter`), `scope` (`geral` ou um domínio: `tarefas`, `financas`, `email`...);
  - `source_feedback_id`, `active`, `hits` (quantas vezes entrou no prompt), `sensitive`.

### `0019_integracoes.sql`
- `integrations` (uma por provedor e dono):
  - `provider` (`google`), `account_email`, `scopes` (text[]), `status` (`ativa` | `expirada` | `revogada`);
  - `vault_secret_id`: o refresh token fica **só no Vault** do Supabase, nunca em coluna comum nem no app;
  - `connected_at`, `last_error`.
- `oauth_states`: `state` aleatório, `code_verifier` (PKCE), `expires_at` (10 min), `used_at`. Liga o retorno do Google ao dono certo.

### `0020_financas.sql`
- `fin_accounts`: `name`, `kind` (`conta` | `cartao` | `carteira`), `opening_balance_cents`, `closing_day` e `due_day` (cartão), `archived`.
- `fin_transactions`:
  - `kind` (`despesa` | `receita` | `transferencia`), `amount_cents` (inteiro, sem float), `account_id`, `to_account_id` (transferência);
  - `occurred_on` (`AAAA-MM-DD`), `category`, `description`, `paid`, `due_on`;
  - `recurring_id`, `installment_group`, `installment_no`/`installment_total`.
- `fin_recurring` (contas fixas): `description`, `amount_cents`, `account_id`, `category`, `day_of_month`, `active`, `until`.
- Tudo de finanças é **sensível por padrão**.

### `0021_computador.sql`
- `pc_commands` (fila e registro das ações no PC, também vinda do celular pelo Realtime):
  - `kind` (`abrir`, `midia`, `achar_arquivo`, `ver_tela`, `controlar`, `comando`, `criar`), `args` (jsonb);
  - `status` (`pendente` | `aguardando_cf` | `executando` | `feito` | `falhou` | `cancelado`), `result` (jsonb), `confirmation_code`;
  - `session_id`, `started_at`, `finished_at`.
- `pc_sessions` (modo controle): `authorized_until`, `reason`, `ended_at`, `ended_by` (`dono` | `tempo` | `panico`).
- `creations`: `kind` (`imagem` | `codigo` | `video`), `prompt`, `status`, `storage_path` (bucket privado `criacoes`) ou `local_path` (pasta `D:\JARVIS-criacoes`), `meta` (jsonb).

## Ferramentas da IA (`dominio_verbo`, via `registrar` em `ia_conversar/tarefas.ts`)

Cada domínio é um arquivo em `ia_conversar/` com `registrar({ferramentas, regras, detector, executores, confirmar?, contexto?})`, respostas em camadas (`resumo`, `fatos`, `texto`, `ids`) e `recibo(...)` em toda escrita.

| Arquivo | Ferramentas | Confirmação `cf_` |
|---|---|---|
| `tarefas.ts` + `lembretes.ts` | `tarefas_criar` ganha o argumento `lembrar` (hora exata ou antecedência, ex.: "30 min antes"); `lembretes_criar` aceita `tarefa` (nome ou id) | — |
| `licoes.ts` | `licoes_listar`, `licoes_esquecer`, `licoes_ensinar` ("daqui pra frente, sempre..."); o like e o deslike chegam pela tela, não pela conversa | esquecer várias |
| `email.ts` | `email_listar`, `email_ler`, `email_buscar`, `email_resumir`, `email_rascunhar`, `email_enviar`, `email_arquivar`, `email_lixeira`, `email_marcar_lido` | `email_enviar` **sempre** (com o texto inteiro na prévia); lixeira de vários |
| `financas.ts` | `financas_registrar_lancamento`, `financas_registrar_fixa`, `financas_registrar_transferencia`, `financas_marcar_pago`, `financas_corrigir_lancamento`, `financas_apagar`, `financas_salvar_conta_ou_cartao`, `financas_ver_mes`, `financas_ver_saldos`, `financas_ver_fatura` | apagar; mexer em muitos; mudar conta fixa |
| `computador.ts` | `computador_ver_tela`, `computador_abrir`, `computador_midia`, `computador_achar_arquivo`, `computador_controlar`, `computador_comando`, `computador_parar` | ver a lista "o que sempre pede `cf_`" abaixo |
| `criacao.ts` | `criacao_imagem`, `criacao_codigo`, `criacao_video`, `criacao_listar` | **toda** criação (prévia do pedido: prompt, tamanho, onde salva) |

Também:
- `projetos.ts` perde as ferramentas e o `aoCriarTarefa` de marcos; `habitos.ts`, `habitos_regras.ts` e `conhecimento.ts` saem.
- `TIPOS_DESFAZER` e o mapa do `jarvis_desfazer` ganham `fin_*` e `assistant_lessons`; tiram `habits`, `habit_logs`, `notes` e `project_milestones`.
- Desfazer no mundo de fora: e-mail na lixeira → tirar da lixeira; arquivado → voltar para a caixa de entrada. **E-mail enviado, comando rodado e ação no PC são irreversíveis** (`irreversible = true` no recibo), por isso pedem `cf_` antes.

## Lembrete na criação de tarefa
- No formulário de tarefa do PC (`formTarefa.ts`): chave "Me lembrar". Ao ligar, mostra:
  - "na hora do prazo";
  - "X min / h antes";
  - "em outro dia e hora".
- Também tem a opção de alarme (o lembrete urgente que já existe).
- Pela conversa: "cria a tarefa X para sexta às 14h e me lembra 1 h antes" → tarefa + lembrete ligado (`reminders.task_id`), num recibo só.
- A entrega já existe: o aviso no PC aberto (`lembretes.ts`) e o vigia `lembrete_hora` (push quando o PC está fechado).
- Na lista de tarefas, um sininho mostra as que têm lembrete.

## Like e deslike (aprender com o dono)
- **Tela:** dois botões discretos embaixo de cada resposta do J.A.R.V.I.S.
  - Like: fica verde, com uma animação leve (pulso curto).
  - Deslike: abre um campo "o que não ficou bom?"; depois de enviado, fica vermelho, com animação leve. Dá para trocar de ideia (clicar de novo desfaz).
- **Like:** grava em `message_feedback`. Quando há vários likes num mesmo jeito de responder, o Groq tira uma lição `manter` (ex.: "respostas curtas com a lista primeiro"). Também impede que uma lição `evitar` contradiga o que o dono aprovou.
- **Deslike:** o Groq lê o motivo do dono, a pergunta e a resposta criticada, e escreve uma lição `evitar` curta e acionável (o que não fazer e o que fazer no lugar). Responde ao dono com a lição em uma linha ("Entendido, Senhor: não vou mais ...").
- **Uso:** as lições ativas entram no prompt de sistema de `ia_conversar` e do planejador: as gerais sempre, as de um domínio só quando o detector daquele domínio dispara. O teto é ~25 lições; acima disso, o Groq junta as parecidas.
- **Controle:** "o que você aprendeu?" lista as lições; "esquece essa" apaga (com recibo). Sensível: lição tirada de conversa sensível é marcada `sensitive` e nunca vai para o Gemini.
- Cada lição vira um nó no núcleo (pulsa quando é usada).

## Como as ações chegam ao PC
- `ia_conversar` não mexe no PC: grava um pedido em `pc_commands`.
- O app do PC escuta `pc_commands` pelo Realtime, executa em Rust (`apps/desktop/src-tauri/src/controle.rs`) e grava o resultado. Funciona também quando a conversa vem do celular (com o PC aberto).
- Se o pedido precisar de `cf_`, ele nasce `aguardando_cf` e só roda depois do "sim" do dono.
- Para ver e controlar a tela, o PC chama a Edge Function nova `ia_controlar` (as chaves continuam só no servidor): ela recebe a árvore de acessibilidade e, se preciso, um print reduzido, e devolve o lote de passos.

## Computador: modo controle
- **Ligar:** o dono pede ("assume o computador por 30 minutos") ou clica no botão. Cria uma `pc_sessions` com prazo (padrão 30 min, máx. 4 h).
- **Enquanto ligado:** faixa vermelha fina no topo da tela ("J.A.R.V.I.S. no controle") e o núcleo pulsando em outra cor.
- **Parar na hora:** atalho global `Ctrl+Shift+F12` (pânico), botão na faixa, ou "para". Mexer o mouse com força também pausa (o dono retomou).
- **Peças em Rust:** `uiautomation` (árvore do Windows e clicar por nome), `enigo` (mouse e teclado), `xcap` (print da tela), comparação local de quadros para o "acompanhar".
- **O que sempre pede `cf_`, mesmo com o modo ligado:** apagar arquivos ou pastas, instalar ou desinstalar programas, enviar mensagem ou e-mail, comprar ou pagar, mudar configuração do Windows ou de segurança, e qualquer `computador_comando` (PowerShell, com o comando inteiro na prévia).
- **Fora do modo controle:** só `computador_abrir`, `computador_midia`, `computador_achar_arquivo` e `computador_ver_tela` (quando o dono pede).
- **Senhas:** o J.A.R.V.I.S. não digita senha nem código de verificação; para e pede ao dono.

## Criação
- **Imagem:** Cloudflare Workers AI (FLUX.1 schnell), chamada pela Edge Function; o arquivo vai para o bucket privado `criacoes` e aparece na aba Criações. Quando a cota do dia acabar: avisar e oferecer para o dia seguinte.
- **Código:** o Groq (`gpt-oss-120b`) escreve o projeto em `D:\JARVIS-criacoes\<nome>`; rodar o código é um `computador_comando` (com `cf_`).
- **Vídeo:** roteiro pelo Groq → imagens (FLUX) → narração (Piper, voz do J.A.R.V.I.S.) → montagem com ffmpeg no PC. O ffmpeg é baixado pelo app na pasta do programa e conferido por SHA-256, como o Piper.

## Segurança e privacidade
- **Gemini grátis nunca recebe:** e-mail, finanças, tela do PC, nem lições sensíveis. Tudo isso vai **só pelo Groq** (o filtro de sensível marca esses domínios inteiros como sensíveis, sem depender de palavra-chave).
- **Conteúdo de fora é dado, não ordem:** texto de e-mail ou da tela entra no prompt dentro de um bloco delimitado ("conteúdo externo"). O planejador é instruído a nunca executar pedidos que venham dali; qualquer ação sugerida por esse conteúdo vira pergunta ao dono.
- **OAuth e chaves só do dono, nunca no repo (o repo é público):**
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_AI_TOKEN` vão para os secrets do Supabase; o dono digita;
  - refresh token do Google só no Vault (`integrations.vault_secret_id`), lido só pelas Edge Functions;
  - escopos mínimos: `gmail.modify` (ler, rascunhar, arquivar, lixeira) e `gmail.send`;
  - fluxo com PKCE e `state` de uso único (`oauth_states`); botão "Desconectar Google" revoga o token no Google e apaga o segredo do Vault.
- **Push:** finanças, e-mail e tela saem como "conteúdo reservado".
- **Registro:** toda ação no PC fica em `pc_commands` e gera evento (o núcleo pulsa). O dono vê tudo o que foi feito e quando.

## Avisos (no vigia `avisos_vigia`)
- Novo `conta_vencer`: conta fixa ou parcela em 2 dias e no dia; urgente no dia.
- Resumo da manhã ganha as contas a vencer do dia.
- Saem: `habito_sequencia` e `diario_vazio` (e a linha de hábitos do resumo da noite).

## Etapas
| Etapa | O quê | Claude | Cursor |
|---|---|---|---|
| 0 | Limpeza: tirar Hábitos, Conhecimento e marcos (conversa, core, vigia, núcleo, Hoje, resumos) + migração 0016 | servidor, core, vigia, migração e ficha `docs/tarefas/limpeza-abas.md` | tira as abas, telas e CSS de `apps/desktop/src`; testes |
| 1 | Tema claro/escuro (Claro, Escuro, Seguir o Windows), incluindo as cores do núcleo 3D | ficha `docs/tarefas/tema-claro-escuro.md` e revisão | executa |
| 2 | Lembrete na tarefa: 0017, `tarefas_criar` com `lembrar`, concluir/apagar em cascata | servidor e core | "Me lembrar" no `formTarefa.ts` e sininho na lista, pela ficha `docs/tarefas/lembrete-na-tarefa.md` |
| 3 | Like e deslike: 0018, `licoes.ts`, lições no prompt, junção acima do teto | servidor e prompts | botões, campo do motivo e animações pela ficha `docs/tarefas/like-deslike.md`; testes |
| 4 | Conexão Google: 0019, Edge Function `google_conectar` (início + retorno), Vault, botão Conectar/Desconectar | tudo | — |
| 5 | E-mail: `email.ts` direto no Gmail (sem guardar corpo de e-mail no banco), bloco de "conteúdo externo" | tudo | — |
| 6 | Finanças: 0020, `financas.ts`, regras puras de fatura no core (com cópia e teste), aviso `conta_vencer` | servidor, regras e core | aba Finanças pela ficha `docs/tarefas/aba-financas.md`; testes |
| 7 | Computador, parte 1: 0021, `pc_commands` pelo Realtime, `controle.rs` (abrir, mídia, achar arquivo, ver tela), `ia_controlar` | tudo | — |
| 8 | Computador, parte 2: modo controle (faixa, pânico, `uiautomation` + `enigo`, lote de passos, acompanhar), `computador_comando` com `cf_` | tudo | faixa e botão de parar pela ficha |
| 9 | Criação: imagem (Cloudflare), código, vídeo (ffmpeg + Piper), aba Criações | servidor e Rust | aba Criações (galeria) pela ficha |
| 10 | Release `pnpm.cmd release:pc` e teste ponta a ponta | revisão final | typecheck e testes |

O dono faz sozinho:
- **Google Cloud (grátis, etapa 4):**
  - criar o projeto e ligar a API do Gmail;
  - criar a tela de consentimento e o cliente OAuth;
  - **publicar o app como "Em produção"**. Em "Teste", o Google expira o acesso a cada 7 dias. Publicado sem verificação, ele só mostra o aviso de "app não verificado", que o dono aceita.
  - Eu escrevo o passo a passo na hora.
- **Cloudflare (grátis, etapa 9):** criar a conta e um token do Workers AI.
- Digitar os secrets no Supabase (comando pronto na hora).
