# Ficha para o Cursor — ajustes depois do teste da v0.2.3 (agir de verdade e responder rápido)

Leia antes: `CLAUDE.md`, inclusive a regra do canal Realtime com nome único. Escreva tudo em português do Brasil. **Não mexa em `apps/mobile`.** Faça só o que está aqui. Se algo não fechar com o código, pare e escreva a dúvida no fim do commit.

## Causas (já investigadas pelo Claude no banco e nos logs)
- "Abra meu bloco de notas e escreva teste":
  1. O planejador gerou só `computador_assumir` e `computador_fazer`. **Não houve `computador_abrir`**: nenhuma linha `abrir` em `pc_commands`.
  2. A janela da frente era um jogo em tela cheia. O `pc_arvore` (UI Automation) travou nessa janela, e o pedido `controlar` terminou em `falhou` com `A tela não respondeu a tempo.` depois de 20 s (`recv_timeout(Duration::from_secs(20))` em `pilotar.rs`). O `ia_controlar` nem chegou a ser chamado.
  3. A falha não chegou ao dono e a sessão do modo controle ficou aberta por 30 minutos.
- Ver a tela: o PC levou 3,7 s (print + Groq). O resto foi o planejador e a espera de 500 ms entre consultas ao banco.

## Princípio desta ficha
Pedido simples e claro ("abra X", "escreva Y em X") **não** usa o loop de IA nem o modo controle. Ele vira uma ação direta, rápida e previsível. O loop `computador_fazer` fica só para tarefas que exigem olhar a tela. Quando o loop é usado, a sessão é curta e se fecha sozinha ao terminar.

---

## 1. Ação direta nova: `computador_digitar`
**Migração `supabase/migrations/0026_pc_digitar.sql`:**
- recrie a constraint de `kind` de `pc_commands` com o mesmo bloco `do $$` da 0024 (procura pelo `pg_get_constraintdef ilike '%kind%'`);
- a lista nova é `('abrir','midia','achar_arquivo','ver_tela','controlar','comando','digitar')`;
- aplique no Supabase (`pmqxeikcnuywvcxkeoep`).

**Servidor:** em `supabase/functions/ia_conversar/computador.ts`:
- Na lista `ferramentas:`, a linha nova é `computador_digitar {texto, programa?}`.
- Regras do planejador, **antes** da regra de `computador_fazer`:
  - `- "abra o bloco de notas e escreva X" / "escreve X no Word" / "digita X" -> computador_digitar {texto:"X", programa:"bloco de notas"} (programa só se o dono disser qual). NÃO use computador_assumir nem computador_fazer para isso.`
  - `- "abra X" sozinho -> computador_abrir. Pedido que abre E faz algo simples num programa -> a ferramenta direta (computador_digitar), que já abre o programa.`
  - `- computador_fazer só para tarefas que exigem olhar a tela e decidir (ex.: "acha o botão de exportar e salva em PDF").`
- Apague da regra de `computador_fazer` o trecho "Se o modo controle estiver desligado, use computador_assumir {minutos:10} E computador_fazer" da ficha anterior. Veja o item 3 para o comportamento novo.
- Executor `computador_digitar`:
  - o `texto` é obrigatório (1 a 2.000 caracteres); senão, responda `O que devo digitar, Senhor?`;
  - o `programa`, se vier, passa por `classificarAlvo` e vai em `args.programa = {tipo, valor}`;
  - não exige sessão de controle;
  - insere `pc_commands {kind:'digitar', args:{texto, programa?}}` e espera o resultado com `pedir(...)`;
  - texto de sucesso: `` `Digitado${programa ? ` no **${nome}**` : ''}, Senhor.` ``, em que `nome` é `result.aberto` ou o valor do programa.

**PC (Rust):** em `apps/desktop/src-tauri/src/pilotar.rs`, comando Tauri novo `pc_digitar(texto: String, programa: Option<serde_json::Value>) -> Result<String, String>` (registre em `lib.rs`):
1. Se houver `programa`:
   - guarde o `hwnd` da janela da frente;
   - chame `crate::controle::pc_abrir(valor, tipo)`;
   - espere, checando a cada 100 ms e por **até 6 s**, até `GetForegroundWindow()` mudar para outra janela e ficar igual por 2 checagens seguidas (300 ms de folga);
   - se não mudar, devolva o erro `O programa abriu, mas não veio para a frente.`
2. Aplique **as mesmas travas** de `digitar` do loop: `recusar_shell()` (S2), `recusar_senha` (S3) e `travado()` (S4).
3. Digite com `enigo.text(&texto)`. Para mais de 500 caracteres, digite em pedaços de 500, checando `travado()` entre eles.
4. Devolva o nome do programa aberto, ou "janela da frente".
5. Rode tudo na mesma thread de UI Automation/enigo que `passo` já usa (canal `Pedido`), com timeout de **10 s**.

**App:** em `apps/desktop/src/computador.ts`, o `executar(cmd)` ganha `kind === 'digitar'`: `invoke('pc_digitar', {texto: args.texto, programa: args.programa ?? null})`, com resultado `{ aberto }`.

**Testes** em `regras.test.ts`: `pareceComputador('abra o bloco de notas e escreva teste')` é `true`. Isso já deve passar: confira.

## 2. `pc_arvore` nunca mais trava
Em `pilotar.rs`, na função que monta a árvore:
- **Orçamento de tempo:** guarde o `Instant::now()` no início e pare de percorrer quando passar de **1.500 ms**. Devolva o que já tiver, com o campo novo `parcial: true` em `ArvoreTela`.
- **Janela sem UI Automation útil** (o `ClassName` da janela da frente é de jogo ou tela cheia, ou a raiz não tem filhos em 300 ms): devolva `elementos: []` na hora. O app já manda o print quando há menos de 15 elementos, então o `ia_controlar` decide pela imagem.
- Baixe o `recv_timeout` de `arvore` de 20 s para **5 s**.
- No app, se `pc_arvore` falhar, **não** encerre o comando. Siga com `elementos: []` e mande o print.

## 3. Modo controle: curto e fechado ao terminar
Em `computador.ts` (servidor), executor `computador_fazer`:
- Sem sessão ativa, **não** pergunte e **não** crie sessão de 30 minutos. Crie uma sessão de **3 minutos** com `reason: 'auto:' + id_do_comando` (insira a sessão antes do comando e depois atualize o `reason` com o id). Depois crie o `controlar` com `args.auto_sessao = true`.
- Se o `objetivo` citar um programa ("no Bloco de notas", "no Chrome"), passe também `args.programa` (o mesmo `classificarAlvo`). O planejador deve mandar `programa` quando o dono disser qual: atualize a linha `computador_fazer {objetivo, programa?}` e a regra.

No app (`apps/desktop/src/computador.ts`), função `pilotar`:
- Se `args.programa` existir, antes da primeira rodada chame `invoke('pc_abrir', ...)` e espere a janela vir para a frente, do mesmo jeito do `pc_digitar`. Exporte do Rust uma função comum `esperar_janela_nova(anterior)` e use-a nos dois lugares.
- No `finally` do `pilotar`: se `args.auto_sessao === true`, chame `jarvis.computador.soltar('dono')`, seja qual for o resultado (feito, falhou ou cancelado).
- **Toda** falha (`falhou` por erro, `pedir_dono` ou timeout) chama `notificar(...)` com a frase do erro. Hoje o erro de `pc_arvore` só ia para o banco.

## 4. Ver a tela mais rápido
Meta: cair de ~6 s para ~2,5 s. **Não** troque o modelo.
1. **PC:** em `controle.rs` (`capturar_jpeg`), troque `MAX` de 1280 para **1024**, o filtro `Triangle` por `FilterType::Nearest` e a qualidade de 70 para **60**.
2. **`ia_tela`:** `max_tokens` 400 → **220**. No prompt de sistema, acrescente: "Responda em no máximo 3 frases curtas."
3. **Servidor:** em `esperar(...)` de `computador.ts`, o intervalo de consulta cai de 500 ms para **150 ms**.
4. **Atalho sem planejador** em `supabase/functions/ia_conversar/index.ts`, logo no começo do tratamento da mensagem e **antes** de chamar o planejador:
   - quando a mensagem casar com `/\b(o que (tem|ha|aparece|esta) na (minha )?tela|ve a minha tela|olha a (minha )?tela|descreve a tela)\b/` (sobre o texto normalizado com `normalizar` de `sensivel.ts`), chame direto o executor `computador_ver_tela` com `{pergunta: texto}`;
   - responda com o resultado como uma ação comum: mesmo formato de `resultados` e mesmo caminho de salvar a mensagem que uma ação do planejador usa;
   - exporte de `computador.ts` uma função `verTelaDireto(ctx, pergunta)` que o `index.ts` chama, sem duplicar código;
   - a mensagem continua `sensitive`.
5. Teste em `regras.test.ts`: exporte o regex como `PEDE_TELA` e teste:
   - `'o que tem na minha tela?'` → `true`;
   - `'O que tem na minha tela principal?'` → `true`;
   - `'qual a capital da França?'` → `false`.

## Pronto quando
- `pnpm.cmd test` passa (hoje são 78).
- Typecheck limpo em `apps/desktop` e `packages/core`.
- `cargo check` limpo; roda ~10 min, em segundo plano.
- Migração 0026 aplicada.
- `ia_conversar` e `ia_tela` publicadas, uma aba do Terminal por comando.
- Teste manual com `pnpm desktop`, **com um jogo ou vídeo em tela cheia aberto atrás**:
  - "abra o bloco de notas e escreva teste": o Bloco de notas abre e "teste" aparece em menos de 5 s, **sem** faixa vermelha;
  - "o que tem na minha tela?": responde em cerca de 3 s.
- Commit em português com `Co-authored-by: Cursor <cursoragent@cursor.com>`. **Não** rode o release: a v0.2.4 é do Claude, depois da revisão.
