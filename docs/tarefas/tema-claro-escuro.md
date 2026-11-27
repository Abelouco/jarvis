# Ficha: tema claro e tema escuro (PC), passo a passo

**Quem faz:** Cursor. **Quem revisa:** Claude (só o diff do commit).
**Contexto:** Fase 4 · Etapa 1 (`docs/fase4-acoes.md`). Hoje o app do PC só tem o tema escuro. O dono quer escolher entre **Escuro**, **Claro** e **Seguir o Windows**, para enxergar melhor de dia.

**Só tela.** Nada de servidor, banco ou core. A escolha fica no `localStorage` do PC.

---

## Regras (leia antes de começar)
1. Trabalhe em `D:\JARVIS`, na branch `main`, editando os arquivos direto. Nada de worktree nem agente em segundo plano.
2. Toque **só** nestes arquivos:
   - `apps/desktop/src/tema.ts` (NOVO);
   - `apps/desktop/src/estilo.css`;
   - `apps/desktop/src/main.ts` (só o passo 3);
   - `apps/desktop/index.html` (só o passo 4).
3. **Não** mexa em `packages/` (nem no núcleo 3D em `packages/nucleo`), `supabase/`, `apps/mobile` nem em outros arquivos.
4. O tema escuro tem que ficar **idêntico** ao de hoje, pixel por pixel. Você só troca cor fixa por variável; o valor da variável no escuro é o valor que já estava lá.
5. Se algo não bater com o que está aqui, **pare** e anote em "Notas do Cursor", no fim desta ficha.

---

## Passo 1: cores viram variáveis (`estilo.css`)
Hoje o `:root` (topo do arquivo) já tem `--fundo`, `--vidro`, `--borda`, `--ciano`, `--texto` etc. Mas o resto do arquivo tem cerca de 120 cores escritas direto (`rgba(...)` e `#xxxxxx`). As mais repetidas:
- `rgba(127, 216, 255, 0.1)`, `0.12`, `0.08`, `0.16`, `0.04`, `0.035` (ciano claro em várias opacidades);
- `rgba(60, 196, 255, 0.1)`, `0.08`, `0.07` (ciano forte);
- `rgba(14, 22, 36, 0.6)`, `0.7`, `0.45` e `rgba(20, 32, 52, 0.6)` (fundos de cartão e de campo);
- `rgba(0, 0, 0, 0.25)` (sombras);
- `#031018` (texto escuro sobre botão colorido) e `#ff7a7a` (atrasada).

O que fazer:
1. Crie variáveis com nome pelo **papel**, não pela cor. Exemplos: `--superficie` (cartão), `--superficie-2` (campo), `--realce` (hover ciano fraco), `--realce-forte`, `--sombra`, `--texto-sobre-cor`, `--grade-hud`, `--brilho-fundo-1` e `--brilho-fundo-2` (os dois `radial-gradient` do `body`).
2. Troque cada cor fixa pela variável certa. Uma mesma cor com papéis diferentes pode virar duas variáveis.
3. As cores de prioridade e estado (`--alta`, `--media`, `--baixa`, `--erro`, `--ciano`) continuam variáveis. No claro elas ganham versões mais escuras, para ter contraste sobre fundo branco.
4. `color-scheme: dark` aparece em três campos (datas e horas). Troque por `color-scheme: var(--esquema)`, com `--esquema: dark` no escuro e `light` no claro.
5. Não precisa trocar as cores das animações de "chegou ao vivo" se elas já usam `--ciano`/`--baixa`.

## Passo 2: o tema claro (`estilo.css`)
Acrescente, logo depois do `:root`, um bloco `:root[data-tema="claro"] { ... }` com os mesmos nomes de variável. Ponto de partida (ajuste a gosto, mantendo o contraste do texto em pelo menos 4.5:1):
```css
:root[data-tema="claro"] {
  --esquema: light;
  --fundo: #f4f7fb;
  --fundo-2: #ffffff;
  --vidro: rgba(255, 255, 255, 0.78);
  --borda: rgba(16, 76, 110, 0.14);
  --borda-forte: rgba(16, 76, 110, 0.34);
  --ciano: #0a7fb0;
  --ciano-forte: #0369a1;
  --ciano-glow: rgba(3, 105, 161, 0.18);
  --texto: #0f1b2a;
  --texto-2: #43566c;
  --apagado: #7a8aa0;
  --alta: #d9334d;
  --media: #b7791f;
  --baixa: #16915f;
  --erro: #d92d45;
  /* + as variáveis novas do passo 1 (superfícies claras, realce em azul bem fraco, sombra suave) */
}
```
O mesmo vale para:
- **Barras de rolagem** (seção "barras de rolagem escuras"): elas também usam variáveis.
- **Núcleo 3D:** ele é desenhado com brilho somado (additive), que some sobre fundo claro. **Não mexa no código do núcleo.** Use só CSS:
  ```css
  :root[data-tema="claro"] .caixa-do-nucleo canvas { filter: invert(1) hue-rotate(180deg) saturate(1.3); }
  ```
  Troque `.caixa-do-nucleo` pela classe real dos elementos onde o `main.ts` chama `montarNucleo(caixa, ...)`; uma delas é `.lateral-nucleo`, confira as outras. O filtro inverte o brilho e devolve o matiz: o núcleo fica escuro, com as mesmas cores (teal, dourado, verde, azul). Se ficar feio, **não tente consertar no núcleo**: anote em "Notas do Cursor" e o Claude resolve no `packages/nucleo`.

## Passo 3: escolher o tema (`tema.ts` novo + `main.ts`)
`apps/desktop/src/tema.ts`:
```ts
export type Tema = 'escuro' | 'claro' | 'windows';
const CHAVE = 'jarvis.tema';
export function temaSalvo(): Tema { /* lê localStorage; padrão 'escuro' */ }
export function aplicarTema(t: Tema): void {
  // 'windows' = matchMedia('(prefers-color-scheme: light)'); põe document.documentElement.dataset.tema = 'claro' | 'escuro'
  // e salva a escolha. Com 'windows', escuta o matchMedia e troca sozinho quando o Windows mudar.
}
export function proximoTema(t: Tema): Tema { /* escuro -> claro -> windows -> escuro */ }
```
No `main.ts`:
1. Chame `aplicarTema(temaSalvo())` **logo no início**, antes de desenhar a tela, e também na tela de login.
2. No `<header class="topo">`, ao lado do botão **Sair** (`#sair`), ponha um botão `#tema`, só com ícone: ☾ no escuro, ☀ no claro e ◐ ao seguir o Windows. O `title` diz o que vem a seguir: "Tema: escuro (clique para claro)". Clicar chama `aplicarTema(proximoTema(...))` e troca o ícone.
3. Mesmo estilo dos botões do topo (copie do `.conta`), com `aria-label`.

## Passo 4: sem "piscar" ao abrir (`index.html`)
No `<head>`, antes de tudo, um `<script>` curto e síncrono. Ele lê `localStorage['jarvis.tema']` (e o `matchMedia` para `'windows'`) e põe o `data-tema` no `<html>`. Assim o app não abre escuro e depois pula para claro.

---

## Pronto quando
- [ ] Escuro idêntico ao de antes. Compare as abas Hoje, Conversa, Tarefas, Projetos, Lembretes, Avisos e Memória, mais o login.
- [ ] Claro legível em todas essas telas: texto, campos de data e hora, menus do clique direito, cartões de opção, bloco de código do Markdown e barras de rolagem.
- [ ] Núcleo 3D visível no claro (escuro, com as cores certas, pulsando).
- [ ] "Seguir o Windows" troca sozinho quando o Windows muda (Configurações → Personalização → Cores).
- [ ] A escolha continua depois de fechar e abrir o app, sem piscar.
- [ ] `pnpm.cmd typecheck` e `pnpm.cmd test` passam.
- [ ] Um commit só: `Tema claro e escuro (Fase 4, etapa 1)`.

## Notas do Cursor
(escreva aqui o que não bateu ou o que ficou para o Claude)
