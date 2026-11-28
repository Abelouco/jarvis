# Ficha para o Cursor — imagem só quando pedida, pesquisa melhor e mais rápida

Leia antes: `CLAUDE.md`. Escreva tudo em português do Brasil. **Não mexa em `apps/mobile`.** Faça só o que está aqui. Se algo não fechar com o código, pare e escreva a dúvida no fim do commit.

## Causas (já investigadas pelo Claude)
- **Imagens em toda resposta:** `busca.ts` manda `include_images: true` ao Tavily sempre, e o servidor devolve as imagens sempre. Elas devem aparecer **só** quando o dono pede.
- **Mais lento:** pedir imagens e descrições de imagem deixa o Tavily mais lento, e isso acontece em toda pergunta.
- **Pesquisa fraca** (ex.: "Quais itens são necessários para se fazer uma sela em Medieval Dynasty?" virou "não encontrei"):
  - o Tavily roda com `search_depth: 'basic'`, que devolve só um pedaço curto de cada página;
  - receitas de jogo e listas ficam no meio da página e não entram no trecho.

## 1. Imagem só quando pedida
Em `supabase/functions/ia_conversar/busca.ts`:
- Exporte o regex `PEDE_IMAGEM`, aplicado sobre o texto normalizado (`normalizar` de `sensivel.ts`):
  `/\b(imagem|imagens|foto|fotos|figura|ilustracao|mapa|mapas|print|screenshot|desenho|wallpaper|papel de parede|logo|mostr(a|e|ar) (como|a cara|o visual)|como (e|eh) (a cara|o visual)|aparencia)\b/`
- A função de pesquisa recebe `{ imagens: boolean }`. Só quando for `true`:
  - manda `include_images: true` e `include_image_descriptions: true`;
  - devolve imagens.

  Quando for `false`, **não** manda esses campos e devolve `imagens: []`.
- No `index.ts`, `imagens = PEDE_IMAGEM.test(normalizar(texto))`, só da mensagem **atual** do dono.
- Pesquisa reaproveitada de `web_searches` também respeita isso: com `imagens: false`, descarte as imagens guardadas.
- Testes em `regras.test.ts`:
  - `true`:
    - `'me mostre o mapa das cavernas'`
    - `'foto do castelo de Neuschwanstein'`
  - `false`:
    - `'Quais itens são necessários para se fazer uma sela em Medieval Dynasty?'`
    - `'qual a capital da França?'`

## 2. Pesquisa que acha a resposta
Na mesma chamada do Tavily:
- `search_depth: 'advanced'` e `chunks_per_source: 3`. Isso devolve os trechos mais relevantes de cada página, não só o começo.
- `max_results: 5`, em vez de 6.
- Corte cada trecho em **2.000** caracteres, em vez de 1.400. Limite o total enviado ao modelo em **14.000** caracteres.
- No prompt de quem escreve a resposta, acrescente: `Se os trechos tiverem a resposta, mesmo em inglês, use-a e traduza. Só diga que não encontrou quando nenhum trecho tiver a informação.`
- No plano de consultas (Groq), a consulta em inglês deve usar o termo do jogo ou produto em inglês. Acrescente ao prompt do plano:
  `Para jogos, produtos e tecnologia, a segunda consulta é em inglês com os termos originais (ex.: "Medieval Dynasty saddle recipe").`

## 3. Mais rápido
Meça antes e depois. No `index.ts`, registre com `console.log('tempo', {plano, busca, resposta, fala, total})`, em ms, cada etapa do pedido com pesquisa. Não grave o texto do dono no log.

Mudanças:
1. **As duas consultas do plano vão ao Tavily em paralelo** (`Promise.all`). Se já forem, anote no commit.
2. **`fala.ts`** (o resumo falado) não pode atrasar a resposta na tela: rode em paralelo com o salvamento da mensagem, ou depois de responder, se a arquitetura permitir sem mudar o app. Se o app espera o campo da fala no mesmo retorno, **não mude**: anote no commit.
3. **`contagemDoNucleo`** e as lições só rodam quando forem usadas. Confira que nada pesado roda em toda mensagem.
4. Timeout do Tavily: 15 s → **10 s**. Na falha, a resposta segue sem pesquisa, com o aviso que já existe.

Anote no commit os tempos de antes e depois, com 3 perguntas iguais.

## Pronto quando
- `pnpm.cmd test` passa (hoje são 83).
- Typecheck limpo em `apps/desktop` e `packages/core`.
- `ia_conversar` publicada:
  `npx.cmd -y supabase@latest functions deploy ia_conversar --project-ref pmqxeikcnuywvcxkeoep --use-api --yes`
- Teste manual com `pnpm desktop`:
  - "Quais itens são necessários para se fazer uma sela em Medieval Dynasty?": responde a lista, **sem imagens**;
  - "me mostre o mapa das cavernas de Medieval Dynasty": mostra imagens.
- Commit em português com `Co-authored-by: Cursor <cursoragent@cursor.com>`. Só muda o servidor, então não há release.
