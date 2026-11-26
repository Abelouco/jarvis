# Ficha: aba Conhecimento (PC)

**Quem faz:** Cursor. **Quem revisa:** Claude (só o diff).
**Contexto:** Fase 2 · Etapa 5. O banco (migração 0013, tabela `notes`), o sync local e as ferramentas da conversa (`conhecimento_*`) já estão prontos e no ar. Falta só a tela.

## Arquivos que pode mexer
- `apps/desktop/src/conhecimento.ts` (novo)
- `apps/desktop/src/main.ts` (só: import, botão da aba, `<div class="vista">` e a chamada `ligarConhecimento`)
- `apps/desktop/src/estilo.css` (só acrescentar no fim, e trocar `repeat(6, auto)` por `repeat(7, auto)` em `.abas-painel`)

Não mexa em `packages/core`, `supabase/` nem `apps/mobile`. Se faltar algo na API, pare e anote no fim desta ficha.

## Modelo a copiar
Siga o jeito de `apps/desktop/src/habitos.ts` e `projetos.ts`:
- `export function htmlConhecimento(): string` devolve o HTML fixo da aba.
- `export function ligarConhecimento(raiz: HTMLElement, op: { pulsar?: () => void; aoMudar?: () => void } = {})` liga os eventos, desenha e redesenha quando os dados mudam (use o mesmo ouvinte de mudança local que `habitos.ts` usa).
- Chame `op.pulsar?.()` depois de criar algo.
- Escape todo texto do usuário antes de pôr no HTML (use o helper que os outros arquivos já usam).

## API pronta (`jarvis.conhecimento`, em `packages/core/src/jarvis.ts`)
- `listar({ tipo?: 'nota' | 'captura', caderno?: string | null, etiqueta?: string, termo?: string }): Promise<Note[]>`: sem o diário; fixadas primeiro.
- `cadernos(): Promise<{ nome, total }[]>` e `etiquetas(): Promise<{ nome, total }[]>`
- `ver(id)`
- `criar({ conteudo, titulo?, caderno?, etiquetas?, fixada?, tipo? }): Promise<string>`
- `editar(id, { titulo?, conteudo?, caderno?, etiquetas?, fixada?, tipo? })`: dar `caderno` a uma captura a transforma em nota.
- `apagar(id)`: exclusão suave.
- `diario(dia?)`, `diasComDiario(de, ate)`, `escreverDiario(dia, texto)`: texto vazio apaga a entrada.

`Note` = `{ id, kind: 'nota'|'captura'|'diario', title, content, notebook, tags: string[], pinned, day, updated_at, ... }`.

## A tela
Três seções no topo da aba (botões tipo pílula): **Notas · Capturas · Diário**.

1. **Notas**
   - Lateral esquerda estreita: "Todas", a lista de cadernos (com contagem) e as etiquetas (`#nome`, com contagem). Clicar filtra.
   - Campo de busca (filtra por `termo` ao digitar, com debounce de ~200 ms).
   - Botão "Nova nota": abre um editor inline com título, caderno (input com `<datalist>` dos cadernos), etiquetas (texto separado por vírgula) e conteúdo (textarea).
   - Cada cartão mostra 📌 (se fixada), título (ou o começo do texto), caderno, etiquetas e 2 linhas do conteúdo. Ações: fixar/desafixar, editar, apagar (com `confirm()`).
2. **Capturas** (caixa de entrada)
   - Campo rápido no topo: Enter cria `tipo: 'captura'`.
   - Lista as capturas; cada uma tem "Organizar" (escolhe o caderno, o que chama `editar(id, { caderno })` e a passa para Notas) e apagar.
3. **Diário**
   - Faixa com os últimos 14 dias (bolinha marcada quando `diasComDiario` traz o dia). Clicar escolhe o dia; o padrão é hoje. Dias futuros ficam desabilitados.
   - Textarea grande com o texto do dia escolhido. Salve sozinho 800 ms depois de parar de digitar e ao sair do campo (`escreverDiario`). Mostre "salvo" discreto.

Texto de dica embaixo, como nas outras abas: *Ou peça na conversa: "anota aí: ideia de app de receitas", "escreve no diário que hoje foi produtivo", "o que eu anotei sobre o carro?"*

## main.ts
- `import { htmlConhecimento, ligarConhecimento } from './conhecimento';`
- Botão `<button type="button" data-aba="conhecimento">Conhecimento</button>` logo depois de Hábitos.
- `<div class="vista" id="vista-conhecimento">${htmlConhecimento()}</div>` junto das outras vistas.
- `ligarConhecimento($<HTMLDivElement>('#vista-conhecimento'), { pulsar: () => nucleo?.pulsar(0.8, 'criado') });` logo depois de `ligarHabitos`.

## CSS
Acrescente no fim de `estilo.css`, com o prefixo `.cn-`, usando as variáveis que já existem (`--borda`, `--ciano`, `--texto-2`...). Cartões com o mesmo visual dos cartões de Hábitos.

## Pronto quando
- A aba aparece depois de Hábitos e as três seções funcionam: criar, editar, fixar, apagar, organizar captura e escrever no diário.
- Uma nota criada pela conversa aparece na aba sozinha, depois do sync.
- `npx.cmd tsc --noEmit` passa em `apps/desktop` e `node --test supabase/functions/ia_conversar/regras.test.ts` continua passando.
- Um commit pequeno: `Conhecimento: aba com notas, capturas e diário`.

## Notas do Cursor (preencher se travar)
