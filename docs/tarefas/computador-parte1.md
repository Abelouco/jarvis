# Ficha para o Cursor — Fase 4 · Etapa 7: Computador, parte 1

Leia antes: `CLAUDE.md` (regras do banco e convenções) e `docs/fase4-acoes.md` (seções "Como as ações chegam ao PC" e "Computador: modo controle").
Responda e escreva em português do Brasil. Não mexa em `apps/mobile`.

## Objetivo
Pela conversa, o J.A.R.V.I.S. passa a **abrir programas/sites/pastas, controlar mídia, achar arquivos e ver a tela** do PC.
O modo controle (mouse/teclado, faixa vermelha, pânico) é a **etapa 8**: não faça agora.

## Fluxo
1. O dono pede na conversa ("abre o Spotify", "pausa a música", "acha o PDF do contrato", "o que tem na minha tela?").
2. `ia_conversar` **não mexe no PC**: grava uma linha em `pc_commands` (status `pendente`) e responde "Feito" / o resultado.
3. O app do PC escuta `pc_commands` pelo Realtime, executa em Rust e grava `status` + `result`.
4. A ferramenta espera até ~8 s pelo resultado (consultando a linha a cada 500 ms). Se o PC estiver fechado (sem `devices` com `platform='pc'` e `seen_at` < 2 min), responde "O PC está fechado; faço assim que ele abrir" e deixa `pendente`.

## 1. Migração `supabase/migrations/0023_computador.sql`
Siga o padrão exato da `0021_financas.sql` (RLS por dono, trigger `set_updated_at`, trigger `log_entity_event`, publicação realtime, `deleted_at`).
- `pc_commands`: `id uuid`, `user_id`, `kind text check in ('abrir','midia','achar_arquivo','ver_tela')`, `args jsonb not null default '{}'`, `status text check in ('pendente','executando','feito','falhou','cancelado') default 'pendente'`, `result jsonb`, `started_at`, `finished_at`, `created_at`, `updated_at`, `deleted_at`.
- Índice `(user_id, status) where deleted_at is null`.
- (O `kind` crescerá na etapa 8 com nova migração; não inclua `controlar`/`comando` agora.)

## 2. Servidor: `supabase/functions/ia_conversar/computador.ts`
Copie a estrutura de `financas.ts` (é o exemplo mais recente): `registrar({ ferramentas, regras, detector, executores })` de `./tarefas.ts`, respostas `{ ferramenta, ok, resumo, fatos, texto, ids }`.
- Ferramentas:
  - `computador_abrir {alvo: "programa, site ou pasta"}`. Site → URL; pasta conhecida ("downloads", "documentos", "área de trabalho") → caminho; senão nome do programa.
  - `computador_midia {acao: "tocar_pausar"|"proxima"|"anterior"|"volume_mais"|"volume_menos"|"mudo"}`
  - `computador_achar_arquivo {termo, tipo?: "pdf"|"imagem"|"video"|"planilha"|"documento"}` → lista até 10 caminhos com data.
  - `computador_ver_tela {pergunta?}` → descreve o que está na tela.
- `fatos: { computador: true }` em todas; a tela é **sensível**: no `index.ts`, trate como o e-mail/finanças (importar `pareceComputador`, somar ao `sobreEmail`, e `r.fatos?.computador === true` deixa a mensagem `sensitive`). Assim só o Groq vê.
- Detector: `abr(e|ir|a)|pausa|despausa|musica|volume|proxima musica|acha|encontra|arquivo|minha tela|na tela|print`.
- Importe em `index.ts` ao lado de `import { pareceFinancas } from './financas.ts'`.
- Recibo: grave com `recibo(ctx.sb, acao, null, linha, 'pc_commands')`, mas **não** inclua `pc_commands` em `TIPOS_DESFAZER` (ação no PC é irreversível; nas regras do planejador diga que "desfaz" não desfaz ação no PC).
- Testes em `supabase/functions/ia_conversar/regras.test.ts`: detector (`pareceComputador`) e a função pura que transforma `alvo` em URL/caminho/programa (deixe-a exportada e sem rede).

## 3. Ver a tela: Edge Function nova `supabase/functions/ia_tela/index.ts`
- Recebe `{ imagem: base64 jpeg, pergunta? }` com o JWT do dono (valide como em `ia_conversar`: `sb.auth.getUser()`).
- Chama o Groq visão (`meta-llama/llama-4-scout-17b-16e-instruct`, chave `GROQ_API_KEY` já existe nos secrets) pedindo uma descrição curta em português. **Nunca Gemini** (tela é sensível). Não guarda a imagem em lugar nenhum.
- Devolve `{ texto }`. O PC grava esse texto em `pc_commands.result`.
- Publicar: `npx.cmd -y supabase@latest functions deploy ia_tela --project-ref pmqxeikcnuywvcxkeoep --use-api --yes`

## 4. PC (Rust): `apps/desktop/src-tauri/src/controle.rs`
Comandos Tauri (registre em `lib.rs`/`main.rs` como os de `voz.rs`):
- `pc_abrir(alvo)`: URL ou caminho → `opener`/`ShellExecute` (`cmd /c start "" "<alvo>"` está ok, **com o alvo como argumento separado**, nunca concatenado em string de shell); programa → procurar no Menu Iniciar (`%APPDATA%\Microsoft\Windows\Start Menu\Programs` e `%PROGRAMDATA%\...`) pelo `.lnk` mais parecido e abrir.
- `pc_midia(acao)`: teclas de mídia do Windows (`VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, `VK_MEDIA_PREV_TRACK`, `VK_VOLUME_UP/DOWN/MUTE`) via `windows` crate (`SendInput`).
- `pc_achar_arquivo(termo, tipo)`: busca em Documentos, Downloads, Área de trabalho, Imagens, Vídeos (profundidade ≤ 5, máx. 10 resultados, ignorar `node_modules`, `.git`, `AppData`), ordenado por data de modificação.
- `pc_print()`: captura a tela principal (crate `xcap` ou `screenshots`), reduz para no máximo 1280 px de largura, JPEG qualidade ~70, devolve base64. Nada fica salvo em disco.
- Sem dependência pesada nova além do necessário (C: está quase cheio; o projeto fica em D:).

## 5. PC (TypeScript): `apps/desktop/src/computador.ts`
- No core, adicione `jarvis.computador.ouvir(f)` (Realtime em `pc_commands` com `status=pendente`, direto no Supabase, como `jarvis.avisos`) e `jarvis.computador.concluir(id, status, result)`.
- Ao chegar um pendente: marca `executando`, chama o comando Rust (`invoke`), grava `feito`/`falhou` com `result`. Para `ver_tela`: `pc_print()` → `fetch` em `ia_tela` com o JWT da sessão → grava o texto.
- Ao abrir o app, processa os `pendente` com menos de 10 min (os mais velhos viram `cancelado`, para não abrir coisas do nada).
- Ligue em `main.ts` junto com `avisos.ts` (só uma chamada `ligarComputador()`).

## 6. Pronto quando
- `pnpm.cmd test` passa (hoje são 65 testes; os novos somam).
- Typecheck limpo: em `apps/desktop` e `packages/core` rodar `..\..\node_modules\.bin\tsc --noEmit -p .`; `cargo check` em `apps/desktop/src-tauri`.
- Migração aplicada no Supabase e as funções `ia_conversar` e `ia_tela` publicadas.
- Teste manual com `pnpm desktop`: "abre o bloco de notas", "pausa a música", "acha o pdf X", "o que tem na minha tela?".
- `CLAUDE.md` (roteiro, etapa 7) e a linha 7 de `docs/fase4-acoes.md` atualizados; commit com mensagem em português.
- **Não** rode o release; o Claude revisa e solta a versão depois (dia 2/12).
