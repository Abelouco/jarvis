# Ficha para o Cursor — ajustes depois do teste da v0.2.1

Leia antes: `CLAUDE.md` (regras do banco e convenções, inclusive **canal do Realtime com nome único**).
Escreva tudo em português do Brasil. **Não mexa em `apps/mobile`.** Faça **só** o que está aqui, na ordem abaixo, um item por vez. Se algo não fechar com o código, **pare**, não adivinhe e escreva a dúvida no fim da mensagem do commit.

Cada item traz a causa (já investigada), o que mudar e como conferir.

---

## Item 1 — Tirar de vez o aviso de diário

**Causa:** o código do diário já saiu do vigia na migração 0016, mas sobrou no banco **um aviso antigo** `diario_vazio`. Ele apareceu às 08:00 porque o silêncio o tinha segurado. O cabeçalho mostrou "undefined" porque `NOME_TIPO` em `apps/desktop/src/abaAvisos.ts` não tem esse tipo.

**Fazer:**
1. Crie a migração nova `supabase/migrations/0025_sem_diario.sql`. Ela faz, nesta ordem:
   - `update public.notices set deleted_at = now() where kind in ('diario_vazio','habito_sequencia') and deleted_at is null;` (exclusão suave; nunca `delete`);
   - `update public.notice_rules set deleted_at = now() where kind in ('diario_vazio','habito_sequencia') and deleted_at is null;`
   - Não mexa na constraint de `kind`: a v0.1.25 antiga ainda pode ler esses tipos. Isso fica para a fase final.
2. Em `apps/desktop/src/abaAvisos.ts`, onde aparece `NOME_TIPO[a.kind]` e `NOME_TIPO[r.kind]`, troque por `NOME_TIPO[a.kind] ?? 'Aviso'` e `NOME_TIPO[r.kind] ?? 'Aviso'`. Assim, nenhum tipo desconhecido volta a mostrar "undefined".
3. Na mesma tela, esconda da lista os avisos com `deleted_at` preenchido. Confira se `jarvis.avisos.listar` em `packages/core/src/jarvis.ts` já filtra `.is('deleted_at', null)`; se não filtrar, acrescente o filtro.
4. Rode `grep -rni "diario\|diário" supabase/functions apps/desktop/src packages/core/src`. Pode sobrar só o tipo `'diario'` de `memories` em `packages/core/src/types.ts:86` e o rótulo `diario: 'Diário'` em `apps/desktop/src/main.ts:561`, que são da aba Memória. Não apague esses dois.

**Conferir:** aplicar a 0025 pelo Supabase (projeto `pmqxeikcnuywvcxkeoep`) e depois rodar `select count(*) from notices where kind='diario_vazio' and deleted_at is null;`, que deve dar `0`.

---

## Item 2 — Frases de conclusão no estilo "…, Senhor."

**Arquivo:** `supabase/functions/ia_conversar/computador.ts`. Troque **exatamente** estes textos:

| Onde | Hoje | Novo |
|---|---|---|
| `computador_abrir` (texto devolvido por `pedir`) | `` `Abri **${nome}**.` `` | `` `**${nome}** aberto, Senhor.` `` |
| `FRASE_MIDIA.tocar_pausar` | `Mandei tocar ou pausar.` | `Música pausada ou retomada, Senhor.` |
| `FRASE_MIDIA.proxima` | `Próxima faixa.` | `Próxima faixa, Senhor.` |
| `FRASE_MIDIA.anterior` | `Faixa anterior.` | `Faixa anterior, Senhor.` |
| `FRASE_MIDIA.volume_mais` | `Aumentei o volume.` | `Volume aumentado, Senhor.` |
| `FRASE_MIDIA.volume_menos` | `Diminuí o volume.` | `Volume diminuído, Senhor.` |
| `FRASE_MIDIA.mudo` | `Mudo.` | `Som no mudo, Senhor.` |
| achar arquivo, com resultado | `` `Achei ${n} arquivo(s):` `` | `` `Encontrei ${n} arquivo(s), Senhor:` `` (mantenha a regra de plural que já existe) |
| achar arquivo, sem resultado | `` `Não achei arquivo com **${termo}**.` `` | `` `Nenhum arquivo com **${termo}**, Senhor.` `` |
| `computador_assumir` | `Assumi o PC até HH:MM. ...` | `Controle assumido até HH:MM, Senhor. Para parar: Ctrl+Shift+F12, o botão na faixa ou diga 'solta o PC'.` (veja o item 4 para segundos) |
| `computador_soltar` | `Soltei o PC.` | `Controle devolvido, Senhor.` |
| confirmar `computador_comando` | `Mandei rodar no PC.` | `Comando enviado ao PC, Senhor.` |
| `computador_fazer` com sessão | `Fazendo: <objetivo>. Te aviso quando terminar.` | `Executando: <objetivo>. Aviso quando terminar, Senhor.` |
| PC fechado (`pedir`) | `O PC está fechado; faço assim que ele abrir.` | `O PC está fechado, Senhor; faço assim que ele abrir.` |

Em `apps/desktop/src/computador.ts`, a notificação `` `Pronto: ${resumo}` `` vira `` `${resumo} Concluído, Senhor.` ``.

Não mude nenhum outro texto. Atualize os testes que comparam esses textos, se houver (`grep -n "Abri\|Soltei\|Mandei" supabase/functions/ia_conversar/regras.test.ts`).

---

## Item 3 — Ver a tela: erro "Rgba8" no JPEG

**Causa:** em `apps/desktop/src-tauri/src/controle.rs`, a função `capturar_jpeg` chama `enc.encode(nossa.as_raw(), w, h, ExtendedColorType::Rgba8)`. O encoder JPEG do crate `image` **não aceita canal alfa**.

**Fazer:** logo antes de criar o `JpegEncoder`, converta para RGB, sem alfa:
```rust
let rgb: image::RgbImage = image::DynamicImage::ImageRgba8(nossa).to_rgb8();
let (w, h) = rgb.dimensions();
let mut buf = Cursor::new(Vec::new());
let mut enc = JpegEncoder::new_with_quality(&mut buf, 70);
enc.encode(rgb.as_raw(), w, h, ExtendedColorType::Rgb8).map_err(|e| format!("Não gerei o JPEG: {e}"))?;
```
- Remova a linha antiga `let (w, h) = nossa.dimensions();` que vinha antes do encoder, para não sobrar variável sem uso.
- Rode `grep -rn "Rgba8" apps/desktop/src-tauri/src`. Se `pilotar.rs` usar o mesmo padrão em algum print, aplique a mesma troca.

**Conferir:** `cargo check` em `apps/desktop/src-tauri` sem erro e sem aviso novo. Leva cerca de 10 minutos; rode em segundo plano.

---

## Item 4 — "Assuma o computador por 30 segundos" virou 5 minutos

**Causa:** `computador_assumir` só aceita `minutos` (mínimo 5), então "30 segundos" virou 5 minutos ("até 19:47").

**Fazer** em `supabase/functions/ia_conversar/computador.ts`:
1. A assinatura na lista `ferramentas:` passa a ser `computador_assumir {segundos?, minutos?, motivo?}`.
2. Troque a função `minutosDe` por uma pura e exportada:
   ```ts
   /** Duração do modo controle em segundos: padrão 30 min, mínimo 10 s, máximo 4 h. */
   export function duracaoControle(a: { segundos?: unknown; minutos?: unknown }): number
   ```
   - `segundos` numérico válido vale mais que `minutos`;
   - sem nenhum dos dois: `1800`;
   - limite entre `10` e `14400`, arredondado para inteiro.
3. Use `Date.now() + duracao * 1000` para o `authorized_until`.
4. Na frase, mostre a hora com segundos quando a duração for menor que 120 s (ex.: `até 19:42:30`). Senão, `HH:MM`. Fuso `America/Sao_Paulo`.
5. Troque a regra do planejador que diz "Padrão 30 minutos (mínimo 5, máximo 240)" por: `computador_assumir {segundos?|minutos?}: "por 30 segundos" -> {segundos:30}; "por 10 minutos" -> {minutos:10}; "por 1 hora" -> {minutos:60}. Padrão 30 minutos.`
6. Testes em `supabase/functions/ia_conversar/regras.test.ts`:
   - `duracaoControle({segundos:30}) === 30`
   - `duracaoControle({minutos:10}) === 600`
   - `duracaoControle({}) === 1800`
   - `duracaoControle({segundos:2}) === 10`
   - `duracaoControle({minutos:999}) === 14400`
   - `duracaoControle({segundos:45, minutos:5}) === 45`
7. No app (`apps/desktop/src/computador.ts`), a checagem que roda a cada 5 s e chama `soltar('tempo')` continua igual. Só confirme que ela compara com `authorized_until` em milissegundos, para que 30 s funcionem.

---

## Item 5 — "Escreva a palavra Teste no bloco de notas" não foi entendido

**Causa:** o detector `DETECTOR` de `computador.ts` não tem verbos de ação na tela ("escreva", "digita", "clica"…). Por isso o planejador nem é chamado e a conversa responde "Não consegui entender". Além disso, o planejador não sabe se o modo controle está ligado.

**Fazer** em `supabase/functions/ia_conversar/computador.ts`:
1. Acrescente ao grupo do `DETECTOR` (sem tirar nada): `escrev\w*|digit\w*|clic\w*|clique|preench\w*|bloco de notas|fecha (a|o) \w+|minimiz\w*|maximiz\w*|seleciona\w*|cola\w* (o|a|isso)|copia\w* (o|a|isso)`.
2. Exporte `export async function sessaoControleAtiva(sb: SupabaseClient): Promise<{ id: string; authorized_until: string } | null>`. Ela lê `pc_sessions` com `ended_at is null`, `deleted_at is null` e `authorized_until > now()`, a mais recente. Use essa função dentro de `computador_fazer` e `computador_assumir`, no lugar da consulta repetida.
3. Acrescente ao `registrar({...})` o gancho `contexto` (veja como `projetos.ts` faz `async contexto(sb)`). Ele devolve:
   - com sessão: `Modo controle: LIGADO até HH:MM. Pedidos para agir na tela (escrever, digitar, clicar, fechar, preencher, abrir e usar um programa) -> computador_fazer {objetivo: o pedido inteiro, com as palavras do dono}.`
   - sem sessão: `Modo controle: desligado.`
4. Nova regra do planejador, logo depois da regra de `computador_fazer`: `- "escreva X no bloco de notas" / "digita X" / "clica em Y" -> computador_fazer {objetivo}. Se o modo controle estiver desligado, use computador_assumir {minutos:10} E computador_fazer {objetivo} na mesma resposta (o dono pediu a ação; não pergunte).`
5. Para isso funcionar, `computador_fazer` precisa achar a sessão recém-criada no mesmo pedido. As ações rodam em sequência no `executar` de `tarefas.ts`, então isso já funciona; confira lendo `executar`.
6. Em `supabase/functions/ia_conversar/index.ts`, ache onde `pareceTarefa(...)` decide chamar o planejador. A condição passa a ser `pareceTarefa(...) || (await sessaoControleAtiva(sb)) !== null`: com o modo ligado, toda mensagem passa pelo planejador. Importe `sessaoControleAtiva` ao lado de `pareceComputador`.
7. Testes em `regras.test.ts`:
   - `pareceComputador('escreva a palavra Teste no bloco de notas')`
   - `pareceComputador('clica em salvar')`
   - `pareceComputador('digita meu nome')`
   - todos `true`;
   - e continua `false`: `pareceComputador('você acha que chove?')`.

---

## Item 6 — "roda o comando Get-Date" pediu confirmação (e disse "dá para desfazer")

**Causa:** todo `computador_comando` pede `cf_`. Além disso, o texto genérico de `pedirConfirmacao` em `tarefas.ts` diz "dá para desfazer em até 24 h", o que é falso para comando no PC.

**Regra nova:** comando **só de leitura** roda direto. Os demais continuam com `cf_`.

**Fazer:**
1. Crie o arquivo novo `supabase/functions/ia_conversar/comando_seguro.ts`, sem rede, com:
   ```ts
   /** true só para comando de leitura que não muda nada no PC. Na dúvida, false. */
   export function comandoSeguro(comando: string): boolean
   ```
   A função devolve `true` somente se **todas** estas condições valerem:
   - **(a)** O texto, sem espaços nas pontas, tem no máximo 300 caracteres e nenhum destes: `;` `&` `` ` `` `>` `<` `$(` `@(` `{` `}` `\n`.
   - **(b)** Separado por `|`, cada parte (sem espaços nas pontas) começa por um destes comandos, comparando sem diferenciar maiúsculas:
     - primeira parte: `Get-Date`, `Get-Process`, `Get-Service`, `Get-ComputerInfo`, `Get-Volume`, `Get-PSDrive`, `Get-NetIPAddress`, `Get-NetAdapter`, `Get-Location`, `Get-ChildItem`, `Get-Item`, `Get-Content`, `Get-Uptime`, `Get-TimeZone`, `Get-Culture`, `Get-HotFix`, `Test-Connection`, `Test-Path`, `Resolve-DnsName`, `ipconfig`, `hostname`, `whoami`, `systeminfo`, `ping`, `tasklist`, `nslookup`, `ver`;
     - partes seguintes: só `Select-Object`, `Where-Object`, `Sort-Object`, `Format-Table`, `Format-List`, `Measure-Object`, `Out-String`, `Select-String`, `Group-Object`.
   - **(c)** Nenhuma parte contém, sem diferenciar maiúsculas: `-Credential`, `Invoke-`, `Start-`, `Stop-`, `Set-`, `Remove-`, `New-`, `Add-`, `Clear-`, `Restart-`, `Out-File`, `Export-`, `iex`, `DownloadString`, `-EncodedCommand`.
2. Em `computador.ts`, no executor `computador_comando`:
   - se `comandoSeguro(comando)`: insira `pc_commands` com `status: 'pendente'` (sem `cf_`), espere o resultado com `esperar` (8 s) e responda `` `Saída do comando, Senhor:\n\n\`\`\`\n${saida}\n\`\`\`` `` (`saida` = `result.saida`, cortada em 3.000 caracteres). Se não chegar a tempo: `Comando enviado ao PC, Senhor; a saída não chegou a tempo.`;
   - senão: o fluxo de hoje, com `aguardando_cf` + `pedirConfirmacao`.
3. Em `supabase/functions/ia_conversar/tarefas.ts`, na função `pedirConfirmacao`:
   - acrescente o 5º parâmetro opcional `desfazivel = true`;
   - o fim do texto vira `` `Confirma?${desfazivel ? ' (dá para desfazer em até 24 h)' : ' (isso não dá para desfazer)'}` ``;
   - em `computador.ts`, chame com `false`.
   - Em `juntarConfirmacoes` (mesmo arquivo), a frase "Dá para desfazer em até 24 h" deve considerar também ações de PC como não desfazíveis, como já faz com o e-mail. Use o mesmo padrão do `enviaEmail`: `const noPc = esperando.some((r) => r.ferramenta.startsWith('computador_'))`.
4. **O Rust não muda**: `pc_comando` continua igual (S1 da etapa 8).
5. Testes em `regras.test.ts`. Importe de `./comando_seguro.ts`. Devem ser `true`:
   - `'Get-Date'`
   - `'get-process | sort-object CPU | select-object -first 5'`
   - `'ipconfig'`
   - `'Test-Path C:\\Windows'`

   Devem ser `false`:
   - `'Remove-Item C:\\x'`
   - `'Get-Date; Remove-Item x'`
   - `'Get-ChildItem | Remove-Item'`
   - `'Get-Content x > y'`
   - `'Invoke-WebRequest http://a'`
   - `'Get-Date $(calc)'`
   - `'Start-Process calc'`
   - `''`

---

## Pronto quando
- `pnpm.cmd test` passa, com **mais de 74** testes (hoje são 74).
- Typecheck limpo: `..\..\node_modules\.bin\tsc --noEmit -p .` dentro de `apps/desktop` e de `packages/core`.
- `cargo check` limpo em `apps/desktop/src-tauri`.
- Migração 0025 aplicada.
- `ia_conversar` publicada, um comando por aba do Terminal:
  `npx.cmd -y supabase@latest functions deploy ia_conversar --project-ref pmqxeikcnuywvcxkeoep --use-api --yes`
- Nenhum `.channel('...')` com nome fixo; o teste `canais.test.ts` barra isso.
- Commit em português, com a linha `Co-authored-by: Cursor <cursoragent@cursor.com>`. Atualize o `CLAUDE.md` com uma frase no fim do roteiro da Fase 4: "Ajustes pós-v0.2.1 (sem diário, frases 'Senhor', JPEG RGB, assumir por segundos, ações na tela com modo ligado, comando de leitura sem `cf_`) feitos pelo Cursor em <data>."
- **Não** rode o release. Quem solta a próxima versão (v0.2.2) é o Claude, depois da revisão.
