# Ficha para o Cursor — o J.A.R.V.I.S. conhece o próprio núcleo e não pesquisa sobre si mesmo

Leia antes: `CLAUDE.md`. Escreva tudo em português do Brasil. **Não mexa em `apps/mobile`.** Faça só o que está aqui. Se algo não fechar com o código, pare e escreva a dúvida no fim do commit.

## Causa (já investigada pelo Claude)
O dono perguntou duas coisas:
- "Novos nós surgiram no núcleo, o que são?": o J.A.R.V.I.S. inventou que eram projetos;
- "Além dos projetos, quais são os outros nós?": o J.A.R.V.I.S. pesquisou na internet.

Motivos:
1. **O prompt do chat não descreve o núcleo.** O modelo não sabe que tipos de nó existem. Hoje o núcleo (`apps/desktop/src/main.ts`) desenha:
   - **memórias** (`definirMemorias`, um nó por memória, maior conforme a importância);
   - **lições** do like/deslike (`nosLicoes`, entram junto com as memórias e brilham conforme são usadas). São quase com certeza os "novos nós": nasceram dos deslikes recentes, aquelas linhas "Entendido, Senhor: ...";
   - **projetos** (nó dourado, `definirProjetos`) com as **tarefas** do projeto em volta:
     - verde = concluída;
     - azul = fazendo;
     - neutro = a fazer.
   - Os **pulsos** são eventos reais da tabela `events`.
2. **A pesquisa na web roda sempre** (decisão da Fase 1). Nada barra uma pergunta sobre o próprio J.A.R.V.I.S.

## 1. Autoconhecimento no prompt (servidor)
Crie `supabase/functions/ia_conversar/autoconhecimento.ts`:
- `export const SOBRE_O_NUCLEO`: texto curto, de no máximo 900 caracteres, que explica os tipos de nó acima com cor e tamanho e diz que cada pulso é um evento real. **Antes de escrever, confira as cores reais em `apps/desktop/src/nucleo3d.ts`** (a cor da lição, da memória, do projeto e das tarefas). Escreva o que o código faz, não o que esta ficha supõe. Anote no commit qualquer diferença.
- `export async function contagemDoNucleo(sb): Promise<string>` devolve uma linha como `Agora: 12 memórias, 5 lições, 3 projetos ativos com 17 tarefas.`
  - Use as mesmas tabelas que o app usa, com `deleted_at is null` e `count: 'exact', head: true`, em paralelo.
  - Lições ficam em `assistant_lessons`; conte só as ativas, com o mesmo filtro que `licoes.ts` usa ao montar o prompt.
  - Inclua também as **lições mais novas** (no máximo 3, só o título ou os primeiros 80 caracteres), para o J.A.R.V.I.S. poder dizer quais nós nasceram por último.
  - **Lição sensível não entra** quando a rota for Gemini. Siga a regra que já existe em `licoes.ts`.
- Exporte `PERGUNTA_SOBRE_SI`, um regex sobre o texto normalizado (`normalizar` de `sensivel.ts`) que casa com perguntas sobre o próprio app:
  - termos: `nucleo`, `nos do nucleo`, `esses nos`, `novos nos`, `cerebro`, `pulsos?`, `bolinhas`, `pontos (dourados|azuis|verdes)`, `jarvis` junto de `(funciona|consegue|sabe|aba|botao|tela|versao|o que voce e)`, `voce (consegue|sabe|pode)`;
  - **cuidado:** "nó" sozinho também é "nó de gravata". Exija contexto (`no(s)? (do|no) nucleo`, `novos nos`, `esses nos`, `outros nos`).

## 2. Usar isso no `index.ts`
- Quando `PERGUNTA_SOBRE_SI` casar com a mensagem, ou com a mensagem anterior do dono na mesma conversa (para pegar o "além dos projetos, quais são os outros nós?"):
  - **não pesquise na web**: pule o plano de busca e o Tavily inteiros, com 0 crédito;
  - acrescente ao sistema `SOBRE_O_NUCLEO` + `await contagemDoNucleo(sb)`;
  - acrescente ao sistema: `Pergunta sobre você mesmo: responda só com o que está acima e no histórico. Se não souber, diga que não sabe. Nunca pesquise na internet sobre você.`
  - também **não** mostre o aviso "Não consegui pesquisar na internet".
- No plano de busca (`busca.ts`, o passo do Groq que gera as consultas), acrescente ao prompt: `Se a pergunta for sobre o próprio J.A.R.V.I.S. (o app, o núcleo, os nós, as abas), não pesquise: devolva consultas vazias.` Se as consultas vierem vazias, não chame o Tavily. É a segunda trava, para frases que o regex não pegou.

## 3. Testes (`regras.test.ts`)
`PERGUNTA_SOBRE_SI` deve ser:
- `true` para:
  - `'Novos nós surgiram no núcleo, o que são?'`
  - `'Além dos projetos, quais são os outros nós?'`
  - `'o que são esses pontos dourados?'`
  - `'você consegue ver minha tela?'`
- `false` para:
  - `'como dar nó de gravata'`
  - `'qual a capital da França?'`
  - `'o que é um nó em navegação?'`

## Pronto quando
- `pnpm.cmd test` passa (hoje são 82).
- Typecheck limpo em `apps/desktop` e `packages/core`.
- `ia_conversar` publicada:
  `npx.cmd -y supabase@latest functions deploy ia_conversar --project-ref pmqxeikcnuywvcxkeoep --use-api --yes`
- Teste manual com `pnpm desktop`:
  - "Novos nós surgiram no núcleo, o que são?": explica memórias, lições e projetos com as tarefas, com as contagens reais, e diz quais lições são as mais novas, **sem fontes da web**;
  - "Além dos projetos, quais são os outros nós?": não pesquisa.
- Commit em português com `Co-authored-by: Cursor <cursoragent@cursor.com>`. **Não** rode o release: só muda o servidor, então não há versão nova do app.
