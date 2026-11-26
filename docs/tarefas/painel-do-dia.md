# Ficha: painel do dia (aba "Hoje"), versão passo a passo

**Quem faz:** Cursor. **Quem revisa:** Claude (só o diff do commit).
**Tentativa anterior:** nada chegou ao disco (sem `hoje.ts`, sem commit). Desta vez siga os passos **na ordem** e **não pule o passo 6** (gravar e commitar).

Objetivo: uma aba **Hoje** que junta o dia do dono: tarefas, lembretes, hábitos, diário e projetos. **Só tela.** Todos os dados já existem no core (`jarvis.*`). Não crie API, tabela nem função no servidor.

---

## Regras (leia antes de começar)
1. Trabalhe na pasta `D:\JARVIS`, na branch `main`. **Não** use agente em segundo plano nem worktree separado: edite os arquivos direto.
2. Toque **só** nestes 3 arquivos:
   - `apps/desktop/src/hoje.ts` (NOVO)
   - `apps/desktop/src/main.ts` (só as 6 mudanças do passo 3)
   - `apps/desktop/src/estilo.css` (só o passo 4)
3. **Não** mexa em `packages/core`, `supabase/`, `apps/mobile` nem em outros arquivos de `apps/desktop/src`.
4. Se algo não bater com o que está escrito aqui (um nome de função diferente, por exemplo), **pare** e escreva o problema em "Notas do Cursor", no fim deste arquivo. Não invente uma API nova.
5. Todo texto que vem do usuário (título de tarefa, nome de hábito, conteúdo do diário, nome de projeto) passa por `esc(...)` antes de entrar no HTML.

---

## Passo 1: ler os moldes (só leitura)
Leia por inteiro, para copiar o estilo:
- `apps/desktop/src/conhecimento.ts`: o molde principal (mesma estrutura de `html…()` + `ligar…()`, o `esc`, o `jarvis.aoMudar` e a trava `desenhando`).
- `apps/desktop/src/main.ts`, linhas ~138–150 (tipo `Aba` e `lerAba`), ~186–200 (botões das abas), ~214–222 (as `<div class="vista">`), ~236–242 (as chamadas `ligar…`) e ~340–366 (`mostrarAba` e o clique nas abas).
- `apps/desktop/src/estilo.css`: os blocos `.cn-` (por volta da linha 785) e o `@media (max-width: 900px)` (por volta da 824).

## Passo 2: criar `apps/desktop/src/hoje.ts`

### 2.1 Imports e utilitários (copie assim)
```ts
// Aba Hoje (Fase 2 · Etapa 6): o dia num lugar só. Tarefas, lembretes, hábitos, diário e projetos.
// Só lê e mostra o que já está no banco local (jarvis.*); as ações reaproveitam as funções das outras abas.
import { hojeSP, partesSP, type HabitoResumo, type Note, type ProjetoResumo, type Reminder, type Task } from '@jarvis/core';
import { jarvis } from './jarvis';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Abas para onde os links "ver todas" levam. */
export type AbaDestino = 'tarefas' | 'lembretes' | 'habitos' | 'conhecimento' | 'projetos';

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function saudacao(): string {
  const h = Number(new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).slice(0, 2));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** "quinta-feira, 26 de novembro" */
function dataExtenso(dia: string): string {
  const [, m, d] = dia.split('-').map(Number);
  return `${SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()]}, ${d} de ${MESES[m! - 1]}`;
}

/** Hora atual em São Paulo, "HH:MM". */
const agoraHM = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
```
Os tipos `HabitoResumo` e `ProjetoResumo` existem e são exportados por `@jarvis/core` (definidos em `packages/core/src/jarvis.ts`). `partesSP(iso)` devolve `{ data: 'AAAA-MM-DD', hora: 'HH:MM' }` em São Paulo.

### 2.2 `export function htmlHoje(): string`
Devolve o esqueleto fixo (sem dados):
```html
<div class="hj">
  <header class="hj-topo">
    <div>
      <h2 class="hj-saudacao"></h2>
      <p class="hj-data"></p>
    </div>
    <span class="hj-selo" hidden>Dia em dia ✓</span>
  </header>
  <p class="hj-resumo"></p>
  <div class="hj-grade">
    <section class="hj-cartao" data-cartao="tarefas"><h3>Tarefas <button type="button" class="hj-ver" data-ir="tarefas">ver todas</button></h3><div class="hj-corpo"></div></section>
    <section class="hj-cartao" data-cartao="habitos"><h3>Hábitos <button type="button" class="hj-ver" data-ir="habitos">ver todos</button></h3><div class="hj-corpo"></div></section>
    <section class="hj-cartao" data-cartao="lembretes"><h3>Lembretes <button type="button" class="hj-ver" data-ir="lembretes">ver todos</button></h3><div class="hj-corpo"></div></section>
    <section class="hj-cartao" data-cartao="diario"><h3>Diário <button type="button" class="hj-ver" data-ir="conhecimento">abrir</button></h3><div class="hj-corpo"></div></section>
    <section class="hj-cartao hj-largo" data-cartao="projetos"><h3>Projetos <button type="button" class="hj-ver" data-ir="projetos">ver todos</button></h3><div class="hj-corpo"></div></section>
  </div>
  <p class="dica-tarefas">Ou peça na conversa: <em>"o que tenho hoje?"</em>, <em>"meditei"</em>, <em>"me lembra às 18h de ligar pro João"</em>.</p>
</div>
```

### 2.3 `export function ligarHoje(raiz: HTMLElement, op: { pulsar?: () => void; irPara?: (aba: AbaDestino) => void } = {})`

Estrutura (copie o esqueleto e preencha cada `desenhar…`):
```ts
export function ligarHoje(raiz: HTMLElement, op: { pulsar?: () => void; irPara?: (aba: AbaDestino) => void } = {}) {
  const corpo = (c: string) => raiz.querySelector<HTMLDivElement>(`[data-cartao="${c}"] .hj-corpo`)!;
  let desenhando = false;

  async function desenhar() {
    if (desenhando) return;
    desenhando = true;
    try {
      const hoje = hojeSP();
      const [tarefas, lembretes, habitos, diario, projetos] = await Promise.all([
        jarvis.tarefas.listar(), jarvis.lembretes.listar(), jarvis.habitos.listar(hoje),
        jarvis.conhecimento.diario(hoje), jarvis.projetos.listar(),
      ]);
      const t = desenharTarefas(tarefas, hoje);
      const h = desenharHabitos(habitos);
      desenharLembretes(lembretes, hoje);
      desenharDiario(diario);
      desenharProjetos(projetos, hoje);
      desenharTopo(hoje, t, h);
    } finally {
      desenhando = false;
    }
  }
  // ... funções abaixo ...

  raiz.onclick = async (e) => { /* passo 2.4 */ };
  jarvis.aoMudar(() => void desenhar());
  void desenhar();
}
```

**`desenharTarefas(lista: Task[], hoje: string)`**: devolve `{ atrasadas: number; deHoje: number }`.
- Abertas = `!t.done_at`.
- Atrasadas = abertas com `t.due_date && t.due_date < hoje`.
- De hoje = abertas com `t.due_date === hoje`, ordenadas por `due_time` (as sem hora no fim).
- Extra = abertas **sem** `due_date` e com `priority === 'alta'` (no máximo 3).
- Cada item, um `<li data-tarefa="${t.id}">` com: uma caixa `<button type="button" class="hj-check" data-concluir="${t.id}" title="Concluir"></button>`, o título `esc(t.title)` e, à direita, a hora (`t.due_time?.slice(0,5)`) ou "atrasada" (classe `hj-atrasada`, em vermelho) ou "alta".
- Ordem na lista: atrasadas, de hoje, extra. Mostre no máximo 8; se houver mais, uma linha "+ N" que leva à aba Tarefas (`data-ir="tarefas"`).
- Vazio: `<p class="hj-vazio">Nada para hoje.</p>`.

**`desenharHabitos(lista: HabitoResumo[])`**: devolve `{ faltando: number; total: number }`.
- Use só `h.previstoHoje && !h.paused`.
- Cada item, um `<li>` com um botão `<button type="button" class="hj-habito${h.feitoHoje ? ' feito' : ''}" data-habito="${h.id}" data-tipo="${h.kind}">`, contendo:
  - o nome (`esc(h.name)`);
  - se `h.kind !== 'boolean'` e há `h.daily_target`: `${h.hojeValor ?? 0}/${h.daily_target}${h.unit ? ' ' + esc(h.unit) : (h.kind === 'duration' ? ' min' : '')}`;
  - se `h.sequencia.n > 1`: `🔥 ${h.sequencia.n}`.
- Ordem: os que faltam primeiro, depois os feitos.
- Vazio: `<p class="hj-vazio">Nenhum hábito para hoje.</p>`.

**`desenharLembretes(lista: Reminder[], hoje: string)`**
- Use os com `!l.done_at` e `partesSP(l.remind_at).data === hoje`, ordenados por `remind_at`.
- Cada item: a hora (`partesSP(l.remind_at).hora`) + `esc(l.title)`. Se a hora já passou (`hora < agoraHM()`), acrescente a classe `hj-passou` (opaco).
- Vazio: `<p class="hj-vazio">Nenhum lembrete hoje.</p>`.

**`desenharDiario(n: Note | undefined)`**
- Com texto (`n?.content.trim()`): as 3 primeiras linhas não vazias, cada uma com `esc`, num `<p class="hj-diario">` com `data-ir="conhecimento"`.
- Sem texto: `<button type="button" class="hj-convite" data-ir="conhecimento">Como foi o dia? Escreva no diário →</button>`.

**`desenharProjetos(lista: ProjetoResumo[], hoje: string)`**
- Use `p.status === 'em_andamento'`, no máximo 4, com os de prazo (`p.due_date`) mais próximo primeiro (os sem prazo no fim).
- Cada item:
  - `esc(p.name)`;
  - barra `<div class="hj-barra"><span style="width:${pct}%"></span></div>`, com `pct = p.total ? Math.round(p.feitas / p.total * 100) : 0`;
  - o texto `${p.feitas}/${p.total} tarefas`;
  - com `p.due_date`: "prazo DD/MM" (`hj-atrasada` se `p.due_date < hoje`).
- Vazio: `<p class="hj-vazio">Nenhum projeto em andamento.</p>`.

**`desenharTopo(hoje, t, h)`**
- `.hj-saudacao` ← `saudacao()`. `.hj-data` ← `dataExtenso(hoje)`.
- `.hj-resumo` ← as partes não vazias, juntadas com " · ": `${t.atrasadas} atrasada(s)` (se > 0), `${t.deHoje} para hoje`, `${h.faltando} hábito(s) faltando` (se > 0). Use singular/plural certo ("1 atrasada", "2 atrasadas").
- `.hj-selo` visível (`hidden = false`) só quando `t.atrasadas === 0 && t.deHoje === 0 && h.total > 0 && h.faltando === 0`.

### 2.4 Cliques (um único `raiz.onclick`)
```ts
raiz.onclick = async (e) => {
  const alvo = e.target as HTMLElement;
  const ir = alvo.closest<HTMLElement>('[data-ir]')?.dataset.ir as AbaDestino | undefined;
  if (ir) return op.irPara?.(ir);
  const concluir = alvo.closest<HTMLElement>('[data-concluir]')?.dataset.concluir;
  if (concluir) {
    await jarvis.tarefas.alternarConcluida(concluir);
    op.pulsar?.();
    return void desenhar();
  }
  const hb = alvo.closest<HTMLElement>('[data-habito]');
  if (hb) {
    const id = hb.dataset.habito!;
    if (hb.dataset.tipo === 'boolean') await jarvis.habitos.alternar(id);
    else await jarvis.habitos.somar(id, 1);
    op.pulsar?.();
    return void desenhar();
  }
};
```
(As funções `alternarConcluida(id)`, `habitos.alternar(id, dia?)` e `habitos.somar(id, delta, dia?)` já existem no core.)

## Passo 3: `apps/desktop/src/main.ts` (6 mudanças, nada além delas)

**3a.** Junto dos outros imports, logo depois de `import { htmlConhecimento, ligarConhecimento } from './conhecimento';`:
```ts
import { htmlHoje, ligarHoje } from './hoje';
```

**3b.** No tipo `Aba` (por volta da linha 139), acrescente `'hoje'`:
```ts
type Aba = 'hoje' | 'conversa' | 'tarefas' | 'projetos' | 'habitos' | 'conhecimento' | 'lembretes' | 'memoria';
```
Em `lerAba`, acrescente `salva === 'hoje' ||` no começo da condição. O padrão (`'conversa'`) **não muda**.

**3c.** Nos botões (`<nav class="abas-painel" id="abas">`), um botão novo **antes** de Conversa:
```html
<button type="button" data-aba="hoje">Hoje</button>
```

**3d.** Junto das vistas, logo antes de `<div class="vista" id="vista-conversa">`:
```html
<div class="vista" id="vista-hoje">${htmlHoje()}</div>
```

**3e.** Em `mostrarAba`, junto das outras linhas `hidden`:
```ts
$<HTMLDivElement>('#vista-hoje').hidden = aba !== 'hoje';
```

**3f.** Logo depois de `ligarConhecimento(...)`, para o painel poder trocar de aba. O clique do botão já faz tudo (salva a aba, chama `mostrarAba`); reaproveite-o assim:
```ts
ligarHoje($<HTMLDivElement>('#vista-hoje'), {
  pulsar: () => nucleo?.pulsar(0.8, 'criado'),
  irPara: (destino) => $<HTMLElement>('#abas').querySelector<HTMLButtonElement>(`button[data-aba="${destino}"]`)?.click(),
});
```

## Passo 4: `apps/desktop/src/estilo.css`
- Em `.abas-painel` (por volta da linha 321), troque `repeat(7, auto)` por `repeat(8, auto)`.
- No **fim** do arquivo, acrescente os estilos com prefixo `.hj-`. Use só as variáveis que já existem (`--borda`, `--borda-forte`, `--ciano`, `--texto-2`, `--apagado`) e o mesmo visual de `.cn-cartao`:
  - `.hj-grade`: `display: grid; grid-template-columns: 1fr 1fr; gap: 14px;`. O `.hj-largo` ocupa as duas colunas (`grid-column: 1 / -1`).
  - `.hj-cartao`: mesmo fundo, borda e raio de `.cn-cartao`, com `padding: 14px 16px`. O `h3` em linha com o `.hj-ver` à direita (botão sem borda, cor `--texto-2`, que fica `--ciano` no hover).
  - Listas sem marcador, com itens de 6 px de espaçamento.
  - `.hj-check`: quadradinho de 16 px com borda `--borda-forte`; no hover, borda `--ciano`.
  - `.hj-habito`: pílula; `.feito` com fundo ciano translúcido e um ✓ antes (`::before`).
  - `.hj-atrasada { color: #ff7a7a; }`, `.hj-passou { opacity: .5; }`, `.hj-vazio { color: var(--apagado); font-size: 13px; }`.
  - `.hj-barra`: 6 px de altura, fundo `rgba(255,255,255,.08)`; o `span` interno em `--ciano`.
  - `.hj-selo`: pequeno, borda `--ciano`, raio 999px.
  - `.hj-saudacao`: grande (22px) e `.hj-data` em `--texto-2`.
  - Dentro de `@media (max-width: 900px) { .hj-grade { grid-template-columns: 1fr; } }`.

## Passo 5: conferir (antes do commit)
Rode, no terminal do Cursor, a partir de `D:\JARVIS`:
```powershell
cd apps/desktop; npx.cmd tsc --noEmit; cd ../..
```
```powershell
node --test supabase/functions/ia_conversar/regras.test.ts
```
- O `tsc` não pode imprimir erro. O teste tem que terminar com `fail 0`.
- Se der erro de tipo, corrija **só** em `hoje.ts` ou `main.ts`.
- Se quiser ver na tela: `pnpm.cmd desktop`, abra a aba Hoje, marque um hábito e conclua uma tarefa.

## Passo 6: gravar e commitar (obrigatório)
1. Se o Cursor mostrar as mudanças com "Accept"/"Keep", aceite **todas** (sem aceitar, nada é gravado no disco).
2. Confira que os três arquivos mudaram:
   ```powershell
   git status --short
   ```
   Devem aparecer `apps/desktop/src/hoje.ts`, `apps/desktop/src/main.ts` e `apps/desktop/src/estilo.css` (e nada mais).
3. Commit:
   ```powershell
   git add apps/desktop/src/hoje.ts apps/desktop/src/main.ts apps/desktop/src/estilo.css
   ```
   ```powershell
   git commit -m "Hoje: painel do dia com tarefas, lembretes, hábitos, diário e projetos" -m "Feito no Cursor."
   ```
4. Confirme com `git log --oneline -1`: a linha deve começar com o hash e dizer "Hoje: painel do dia…".
5. Não faça `git push`, release nem deploy.

## Pronto quando
- A aba **Hoje** aparece em primeiro, com saudação, data, resumo e os 5 cartões com dados reais.
- Concluir uma tarefa e marcar um hábito pelo painel funcionam, e o painel se atualiza sozinho.
- "ver todas" e "abrir" levam à aba certa.
- O `tsc` está limpo, os testes terminam com `fail 0`, e há **um** commit novo com os 3 arquivos.

## Notas do Cursor (preencher se travar)
