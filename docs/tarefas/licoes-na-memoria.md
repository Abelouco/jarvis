# Ficha para o Cursor — lições aparecem na aba Memória

Leia antes: `CLAUDE.md`. Escreva tudo em português do Brasil. **Não mexa em `apps/mobile`.** Faça só o que está aqui. Se algo não fechar com o código, pare e escreva a dúvida no fim do commit.

## Regra do dono
Todo nó do núcleo que guarda um **conhecimento** tem de aparecer na aba Memória. Hoje são as memórias, que já aparecem, e as **lições** do like/deslike, que viram nó (`nosLicoes` em `apps/desktop/src/main.ts`) mas não aparecem na aba. Projetos, tarefas, finanças e lembretes **não** entram na aba: eles já têm abas próprias.

## 1. Core (`packages/core/src/jarvis.ts`)
- `jarvis.feedback.licoes()` já existe (linha ~1083). Acrescente `created_at` e `sensitive` ao `select` e ao tipo de retorno.
- Crie `jarvis.feedback.esquecerLicao(id: string)`:
  - faz exclusão suave, `update({ deleted_at: new Date().toISOString() }).eq('id', id)`, **nunca** DELETE;
  - se `licoes_esquecer` no servidor fizer algo a mais, como um recibo em `undo_receipts`, chame o mesmo caminho em vez de repetir a lógica.
  - **Antes:** confira em `supabase/functions/ia_conversar/licoes.ts` como o `licoes_esquecer` apaga e siga o mesmo padrão.

## 2. Aba Memória (`apps/desktop/src/main.ts`, `desenharMemorias`)
- Abaixo da lista de memórias, crie uma seção com o título `Lições (o que aprendi com seus likes e deslikes)`.
- Cada item usa o **mesmo HTML e as mesmas classes** de uma memória (`li.memoria`, `memoria-titulo`, `memoria-quando`, o botão `×` com a confirmação "Esquecer?").
- O texto do item é `lesson`. O selo mostra `evitar` ou `manter`, com uma classe nova `memoria-selo`. Lição sensível mostra o selo "sensível", que já existe.
- Use `data-esquecer-licao` para não misturar com as memórias. O clique confirmado chama `esquecerLicao` e depois `atualizarLicoes()`.
- Mantenha a mesma `assinatura` anti-redesenho. Inclua as lições na string, para a lista não piscar.
- Todo texto passa por `esc`.
- Lista vazia: não mostre a seção.

## 3. Texto de introdução da aba
Troque o texto de introdução por:
`O que o J.A.R.V.I.S. aprendeu sobre você e com as suas avaliações. Cada item aqui é um ponto ciano no núcleo. Peça no chat para lembrar ou esquecer algo, ou esqueça por aqui.`

## Pronto quando
- `pnpm.cmd test` passa (hoje são 83).
- Typecheck limpo em `apps/desktop` e `packages/core`.
- Teste com `pnpm desktop`:
  - as lições aparecem na aba Memória;
  - esquecer uma lição tira o item da lista e o nó do núcleo.
- Commit em português com `Co-authored-by: Cursor <cursoragent@cursor.com>`. **Não** rode o release: a v0.2.7 é do Claude, depois da revisão.
