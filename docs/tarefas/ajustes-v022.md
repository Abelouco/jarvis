# Ficha para o Cursor — ajustes depois do teste da v0.2.2 (ver a tela e agir na tela)

Leia antes: `CLAUDE.md`. Escreva tudo em português do Brasil. **Não mexa em `apps/mobile`.** Faça só o que está aqui. Se algo não fechar com o código, pare e escreva a dúvida no fim do commit.

## Causa (já investigada pelo Claude nos logs do Supabase)
- O `ia_tela` respondeu **502**, com o log `ia_tela: groq 404`. O modelo de visão `meta-llama/llama-4-scout-17b-16e-instruct` foi **desligado pelo Groq** (17/07/2026). Por isso, "o que tem na minha tela?" falha.
- O `pc_commands` `controlar` com objetivo "digitar teste" falhou com "Não entendi o que fazer na tela.". Isso é o plano vazio do `validarPlano`.
  - Quando a árvore tem menos de 5 elementos (o Bloco de notas do Windows 11 costuma ter poucos), o app manda o print, e o `ia_controlar` usa o **mesmo modelo desligado**.
  - O erro do Groq virou o "Não entendi" genérico, escondendo a causa.
- O objetivo também chegou pobre: o dono pediu "Abra meu bloco de notas e escreva 'teste'", mas o objetivo ficou "digitar teste", sem dizer onde.
- PowerShell: o `Get-Date` rodou direto e devolveu a data. **Não mexa nisso.**

## 1. Modelo de visão em um lugar só, com reserva
1. Crie `supabase/functions/ia_conversar/modelos_groq.ts`:
   ```ts
   /** Modelos de visão do Groq, em ordem de preferência. O secret GROQ_MODELO_VISAO, se existir, vai na frente. */
   export function modelosVisao(): string[] {
     const extra = (Deno.env.get('GROQ_MODELO_VISAO') ?? '').trim();
     const base = ['qwen/qwen3.8-27b', 'qwen/qwen3.6-27b'];
     return extra ? [extra, ...base.filter((m) => m !== extra)] : base;
   }
   export const MODELO_TEXTO_CONTROLE = 'openai/gpt-oss-120b';
   ```
2. **Antes de fixar a lista:** abra https://console.groq.com/docs/models e confira quais modelos de **visão** (entrada de imagem) estão listados hoje. Ponha na lista `base` os que existirem, o melhor primeiro. Se os dois `qwen` acima não estiverem lá, use os que estiverem e anote isso no commit.
3. Crie a função auxiliar `chamarGroqVisao(corpo: Record<string, unknown>): Promise<Response>` no mesmo arquivo:
   - percorre `modelosVisao()`;
   - para cada modelo, faz `POST https://api.groq.com/openai/v1/chat/completions` com `{...corpo, model}`;
   - se a resposta for `404` ou `400` com a mensagem contendo `model`, faz `console.warn('groq visão: modelo indisponível', model, status)` e tenta o próximo;
   - com qualquer outro status, devolve a resposta;
   - se todos falharem, devolve a última resposta.

## 2. `supabase/functions/ia_tela/index.ts`
- Troque a constante `MODELO` e o `fetch` direto por `chamarGroqVisao({...})`, importado de `../ia_conversar/modelos_groq.ts`. É o mesmo padrão de `ia_controlar`, que já importa `../ia_conversar/sensivel.ts`.
- Quando o Groq falhar, o `console.error` deve mostrar o status **e os primeiros 300 caracteres do corpo da resposta**, mas nunca a imagem.
- O erro devolvido ao app vira `{ erro: 'Não consegui descrever a tela (Groq ' + status + ').' }`, para o dono ver a causa.

## 3. `supabase/functions/ia_controlar/index.ts`
- Com `print`: use `chamarGroqVisao` (o mesmo `response_format: {type:'json_object'}` só se o modelo aceitar; se o Groq devolver 400 citando `response_format`, repita **uma vez** sem esse campo).
- Sem `print`: continue com `MODELO_TEXTO_CONTROLE`.
- Se a chamada ao Groq falhar (status diferente de 200), **não** devolva o plano vazio. Responda HTTP 502 com `{ erro: 'Não consegui decidir os passos (Groq ' + status + ').' }`. O app já mostra `corpo.erro`.
- Se o JSON vier e `validarPlano` cair no `pedir_dono` padrão, faça `console.warn` com o `pensamento` (até 200 caracteres) para dar para diagnosticar depois.

## 4. App: `apps/desktop/src/computador.ts` (função `plano`)
- Mande o print **sempre que** a árvore tiver menos de **15** elementos (hoje são 5), ou quando a rodada anterior teve algum passo com `ok: false`.
- Nada mais muda no app.

## 5. Objetivo completo: `supabase/functions/ia_conversar/computador.ts`
- Na regra do planejador para `computador_fazer`, acrescente:
  > `objetivo` leva o pedido inteiro, com o programa e o texto exato (ex.: "Abra meu bloco de notas e escreva 'teste'" -> computador_abrir {alvo:"bloco de notas"} E computador_fazer {objetivo:"No Bloco de notas aberto, clicar na área de texto e digitar exatamente: teste"}).
- No executor `computador_fazer`, se o `objetivo` tiver menos de 12 caracteres, responda `Diga o que fazer e em qual programa, Senhor.` e não crie o comando.

## 6. Teste em `supabase/functions/ia_conversar/regras.test.ts`
- `modelosVisao()` sem o secret devolve a lista `base`, com o primeiro modelo igual ao que você conferiu no passo 1.2.
- Com o secret, `modelosVisao()` põe ele na frente sem repetir. Use `Deno.env` só se o teste já rodar no Deno. Os testes rodam no **Node**, então, para o teste, extraia a lógica para `export function ordenarModelos(extra: string, base: string[]): string[]` e teste essa função pura. `modelosVisao` só a chama.

## Pronto quando
- `pnpm.cmd test` passa (hoje são 77).
- Typecheck limpo em `apps/desktop` e `packages/core`.
- `ia_tela`, `ia_controlar` e `ia_conversar` publicadas, um comando por aba do Terminal:
  `npx.cmd -y supabase@latest functions deploy NOME --project-ref pmqxeikcnuywvcxkeoep --use-api --yes`
  (`ia_tela` e `ia_controlar` agora importam de `../ia_conversar/`; confira no log do deploy que `modelos_groq.ts` foi enviado.)
- Teste manual com `pnpm desktop`: "o que tem na minha tela?" descreve a tela; "abra o bloco de notas e escreva teste" escreve "teste".
- Commit em português com `Co-authored-by: Cursor <cursoragent@cursor.com>`. **Não** rode o release: a v0.2.3 é do Claude, depois da revisão.
