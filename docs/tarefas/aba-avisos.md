# Ficha: aba Avisos (PC), passo a passo

**Quem faz:** Cursor. **Quem revisa:** Claude (só o diff do commit).
**Contexto:** Fase 3 · Etapa 6. O J.A.R.V.I.S. já manda avisos sozinho, por conta própria: tarefa atrasada, lembrete, sequência de hábito, prazo de projeto, diário em branco, resumo da manhã e resumo da noite. Cada aviso fica gravado com o **motivo**. O servidor e o core já estão prontos. Falta só a tela: o histórico com o porquê de cada aviso e os ajustes.

**Só tela.** Toda a leitura e escrita já existe em `jarvis.avisos.*` (seção "API pronta", abaixo). Não crie API, tabela nem função no servidor.

---

## Regras (leia antes de começar)
1. Trabalhe em `D:\JARVIS`, na branch `main`, editando os arquivos direto. Nada de worktree nem agente em segundo plano.
2. Toque **só** nestes 3 arquivos:
   - `apps/desktop/src/abaAvisos.ts` (NOVO; atenção: **não** é o `avisos.ts`, que já existe e cuida da notificação do Windows. Não mexa nele);
   - `apps/desktop/src/main.ts` (só as mudanças do passo 3);
   - `apps/desktop/src/estilo.css` (só o passo 4, no fim do arquivo).
3. **Não** mexa em `packages/core`, `supabase/`, `apps/mobile` nem em outros arquivos.
4. Se algo não bater com o que está aqui, **pare** e anote em "Notas do Cursor", no fim desta ficha. Não invente API.
5. Todo texto que vem do banco (título, corpo, motivo, nome do item) passa por `esc(...)` antes de entrar no HTML.
6. Os avisos **não** ficam no banco local: ficam no servidor. Sem internet, a aba mostra uma mensagem e não quebra.

---

## API pronta (em `packages/core`, só use)
Os tipos vêm de `@jarvis/core`: `Notice`, `NoticeSettings`, `NoticeRule`, `TipoAviso`.

| Chamada | O que faz |
|---|---|
| `jarvis.avisos.listar(limite = 60): Promise<Notice[]>` | Últimos avisos, do mais novo ao mais velho. Inclui os que estão **dentro** de um grupo (têm `group_id`) |
| `jarvis.avisos.naoLidos(): Promise<number>` | Quantos avisos enviados ainda não foram vistos |
| `jarvis.avisos.marcarLidos(ids?: string[])` | Marca como vistos; sem `ids`, marca todos |
| `jarvis.avisos.preferencias(): Promise<NoticeSettings>` | `enabled`, `quiet_start`, `quiet_end`, `morning_at`, `evening_at` (horas `HH:MM:SS`) |
| `jarvis.avisos.salvarPreferencias(m)` | Muda as preferências (horas em `HH:MM`); devolve a linha nova |
| `jarvis.avisos.regras(): Promise<(NoticeRule & { nome: string \| null })[]>` | Só os ajustes que mudam algo: desligado, silenciado ou com hora fixa. `nome` é o item, quando a regra vale para um item só |
| `jarvis.avisos.removerRegra(id)` | Tira o ajuste (volta ao normal) |
| `jarvis.aoEvento(f)` | Cada evento do servidor. Recarregue quando `e.entity_type` for `'notices'`, `'notice_rules'` ou `'notice_settings'` |

Campos de `Notice` usados na tela:
- `kind`: o tipo do aviso;
- `title`, `body` (pode ter várias linhas, separadas por `\n`), `reason` (o motivo);
- `priority`: `'urgente' | 'normal' | 'baixa'`;
- `status`: `'enviado' | 'segurado_silencio' | 'juntado' | 'silenciado' | 'agendado'`;
- `channels`: `'pc'`, `'pc_local'` e/ou `'push'`;
- `scheduled_for`, `sent_at`, `read_at`, `group_id`, `created_at`.

---

## Passo 1: ler os moldes (só leitura)
- `apps/desktop/src/hoje.ts` inteiro: molde de `html…()` + `ligar…()`, do `esc` e da trava `desenhando`.
- `apps/desktop/src/main.ts`:
  - linhas ~11–21: os imports;
  - ~141–150: o tipo `Aba` e `lerAba`;
  - ~192–223: os botões das abas e as `<div class="vista">`;
  - ~241–249: as chamadas `ligar…`;
  - ~350–363: `mostrarAba`.
- `apps/desktop/src/estilo.css`, os blocos `.hj-` do fim do arquivo (~linha 780 em diante), para copiar cores e espaçamentos.

## Passo 2: criar `apps/desktop/src/abaAvisos.ts`

### 2.1 Começo (copie assim)
```ts
// Aba Avisos (Fase 3 · Etapa 6): o que o J.A.R.V.I.S. avisou sozinho, com o porquê, e os ajustes.
// Lê e escreve direto no Supabase por jarvis.avisos.* (avisos não ficam no banco local).
import { partesSP, hojeSP, type Notice, type NoticeSettings, type TipoAviso } from '@jarvis/core';
import { jarvis } from './jarvis';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const NOME_TIPO: Record<TipoAviso, string> = {
  tarefa_atrasada: 'Tarefa atrasada',
  lembrete_hora: 'Lembrete',
  habito_sequencia: 'Sequência de hábito',
  prazo_projeto: 'Prazo de projeto',
  diario_vazio: 'Diário em branco',
  resumo_manha: 'Resumo da manhã',
  resumo_noite: 'Resumo da noite',
};

const NOME_STATUS: Record<Notice['status'], string> = {
  enviado: '',
  segurado_silencio: 'segurado pelo silêncio',
  juntado: 'junto com outros',
  silenciado: 'silenciado por você',
  agendado: 'agendado',
};

/** "hoje 14:05", "ontem 21:00", "24/11 08:00" */
function quando(iso: string): string {
  const { data, hora } = partesSP(iso);
  const hoje = hojeSP();
  if (data === hoje) return `hoje ${hora}`;
  const ontem = new Date(`${hoje}T12:00:00Z`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  if (data === ontem.toISOString().slice(0, 10)) return `ontem ${hora}`;
  return `${data.slice(8, 10)}/${data.slice(5, 7)} ${hora}`;
}

/** "PC", "celular", "PC e celular" */
function canais(c: string[]): string {
  const pc = c.includes('pc') || c.includes('pc_local');
  const cel = c.includes('push');
  return pc && cel ? 'PC e celular' : pc ? 'PC' : cel ? 'celular' : '';
}

const hm = (t: string) => t.slice(0, 5);
```
Confira se `partesSP` e `hojeSP` saem de `@jarvis/core` (saem de `packages/core/src/recorrencia.ts`, que o `index.ts` exporta). Se não saírem, **pare** e anote.

### 2.2 `htmlAvisos()`: a estrutura fixa
Uma função `export function htmlAvisos(): string`, que devolve:
```html
<div class="av">
  <header class="av-topo">
    <div>
      <h2>Avisos</h2>
      <p class="av-sub">O que eu avisei sozinho, e por quê. Peça ajustes na conversa também: <em>"silencia o diário até amanhã"</em>, <em>"resumo da manhã às 9h"</em>.</p>
    </div>
    <button type="button" class="av-lidos" hidden>Marcar todos como vistos</button>
  </header>
  <p class="av-erro" hidden></p>
  <div class="av-grade">
    <section class="av-historico"><h3>Histórico</h3><ul class="av-lista"></ul></section>
    <aside class="av-lado">
      <section class="av-cartao">
        <h3>Ajustes</h3>
        <form class="av-prefs">
          <label class="av-ligado"><input type="checkbox" name="enabled" /> Avisos ligados</label>
          <fieldset><legend>Silêncio</legend>
            <label>das <input type="time" name="quiet_start" required /></label>
            <label>às <input type="time" name="quiet_end" required /></label>
            <small>Avisos normais esperam; urgentes furam o silêncio.</small>
          </fieldset>
          <fieldset><legend>Resumos</legend>
            <label>manhã <input type="time" name="morning_at" required /></label>
            <label>noite <input type="time" name="evening_at" required /></label>
          </fieldset>
          <button class="av-salvar">Salvar</button> <span class="av-salvo"></span>
        </form>
      </section>
      <section class="av-cartao">
        <h3>O que você pediu</h3>
        <ul class="av-regras"></ul>
      </section>
    </aside>
  </div>
</div>
```

### 2.3 `ligarAbaAvisos(raiz, op)`
Assinatura:
```ts
export function ligarAbaAvisos(raiz: HTMLElement, op: { selo?: (n: number) => void } = {}) {
  // ...
  return { recarregar: () => void desenhar() };
}
```
Dentro dela, nesta ordem:

1. **Pegar os elementos** com `raiz.querySelector`: `.av-lista`, `.av-regras`, `.av-prefs` (form), `.av-erro`, `.av-lidos`, `.av-salvo`.

2. **`desenhar()`** (async, com a trava `let desenhando = false` igual à do `hoje.ts`):
   - em paralelo (`Promise.all`): `jarvis.avisos.listar(60)`, `jarvis.avisos.regras()`, `jarvis.avisos.preferencias()` e `jarvis.avisos.naoLidos()`;
   - num `try/catch`: se der erro, mostre `.av-erro` com o texto `Sem conexão com o servidor: os avisos ficam lá. Tente de novo em instantes.` e saia. Se der certo, esconda o `.av-erro`;
   - chame `op.selo?.(naoLidos)` e mostre o botão `.av-lidos` só se `naoLidos > 0`;
   - desenhe o **histórico** (2.4), as **regras** (2.5) e preencha o **form** (2.6).

3. **Histórico (2.4).** Separe:
   - `principais` = os avisos com `group_id === null`;
   - `filhos` = um `Map` de `group_id` para a lista dos avisos daquele grupo.

   Para cada principal, um `<li class="av-item">`:
   - classes a mais: `av-nao-lido` se `status === 'enviado' && !read_at`; `av-urgente` se `priority === 'urgente'`; `av-apagado` se o status for `'silenciado'`;
   - `data-id="${id}"`;
   - linha de cima: `<span class="av-tipo">${NOME_TIPO[kind]}</span>`, `<span class="av-quando">${quando(sent_at ?? created_at)}</span>`, os canais (`canais(channels)`, se houver) e, se `NOME_STATUS[status]` não for vazio, `<span class="av-status">${NOME_STATUS[status]}</span>`. Para `agendado` e `segurado_silencio` com `scheduled_for`, escreva o status como `sai ${quando(scheduled_for)}`;
   - `<strong>${esc(title)}</strong>`;
   - o corpo: `<p class="av-corpo">${esc(body)}</p>` (o CSS usa `white-space: pre-line` para respeitar o `\n`);
   - o motivo: `<p class="av-motivo"><b>Por quê:</b> ${esc(reason)}</p>`;
   - se tiver filhos (`filhos.get(id)`): `<details class="av-filhos"><summary>ver os ${n}</summary><ul>` com um `<li>` por filho (título e motivo, os dois com `esc`) `</ul></details>`.

   Sem avisos: `<li class="av-vazio">Nenhum aviso ainda. O primeiro deve ser um resumo (manhã ou noite).</li>`.

4. **Regras (2.5).** Para cada regra, um `<li data-id="${id}">` com o texto e um botão `<button type="button" class="av-normal">voltar ao normal</button>`:
   - nome = `NOME_TIPO[kind]` e, se `nome` vier, ` · ${esc(nome)}`;
   - texto:
     - `!active` → `desligado`;
     - `muted_until` no futuro → `silenciado até ${quando(muted_until)}`;
     - senão, se tem `fixed_time` → `só às ${hm(fixed_time)}`.

   Sem regras: `<li class="av-vazio">Nenhum ajuste. Tudo no padrão.</li>`.

5. **Form (2.6).** Preencha só se o form **não** estiver com foco dentro (`!form.contains(document.activeElement)`), para não apagar o que o dono está digitando:
   - `enabled`: `checked = p.enabled`;
   - os 4 horários: `value = hm(p.quiet_start)` e assim por diante.

6. **Eventos:**
   - **Clique na lista** (`.av-lista`): clicou num `.av-item.av-nao-lido`? Chame `jarvis.avisos.marcarLidos([id])` e depois `desenhar()`. Os cliques dentro de `<details>` não marcam (`if ((e.target as HTMLElement).closest('summary, details ul')) return;`).
   - **Botão `.av-lidos`**: `await jarvis.avisos.marcarLidos()` e depois `desenhar()`.
   - **Clique em `.av-normal`** (dentro de `.av-regras`): `await jarvis.avisos.removerRegra(id)` e depois `desenhar()`.
   - **Submit do form** (`e.preventDefault()`):
     ```ts
     await jarvis.avisos.salvarPreferencias({
       enabled: form.enabled.checked,
       quiet_start: form.quiet_start.value, quiet_end: form.quiet_end.value,
       morning_at: form.morning_at.value, evening_at: form.evening_at.value,
     });
     ```
     Depois escreva `Salvo ✓` em `.av-salvo` e apague após 2 s. Se der erro, escreva a mensagem do erro ali. Para tipar, use `form.elements.namedItem('enabled') as HTMLInputElement` e assim por diante, ou `new FormData(form)`, se preferir; o importante é o typecheck passar.
   - **Tempo real:** `jarvis.aoEvento((e) => { if (e.entity_type === 'notices' || e.entity_type === 'notice_rules' || e.entity_type === 'notice_settings') agendar(); });`, em que `agendar` junta vários eventos num só redesenho (`setTimeout` de 400 ms, cancelando o anterior).
   - **Primeira carga:** chame `void desenhar()` no fim.

## Passo 3: `apps/desktop/src/main.ts` (5 mudanças)
1. **Import**, logo abaixo da linha `import { ligarAvisos } from './avisos';`:
   ```ts
   import { htmlAvisos, ligarAbaAvisos } from './abaAvisos';
   ```
2. **Tipo `Aba` e `lerAba`** (linhas ~141–146): acrescente `'avisos'` no tipo e, em `lerAba`, `|| salva === 'avisos'`.
3. **Botão da aba:** logo depois de `<button type="button" data-aba="lembretes">Lembretes</button>`, ponha:
   ```html
   <button type="button" data-aba="avisos">Avisos</button>
   ```
   **Vista:** logo depois de `<div class="vista" id="vista-lembretes">${htmlLembretes()}</div>`, ponha:
   ```html
   <div class="vista" id="vista-avisos">${htmlAvisos()}</div>
   ```
4. **Ligar:** logo depois da chamada `ligarHoje(…);` (termina na linha ~249), ponha:
   ```ts
   const abaAvisos = ligarAbaAvisos($<HTMLDivElement>('#vista-avisos'), {
     selo: (n) => {
       const b = $<HTMLElement>('#abas').querySelector<HTMLButtonElement>('button[data-aba="avisos"]');
       if (b) b.dataset.selo = n > 0 ? String(n) : '';
     },
   });
   ```
5. **`mostrarAba`** (linhas ~350–363): acrescente
   ```ts
   $<HTMLDivElement>('#vista-avisos').hidden = aba !== 'avisos';
   if (aba === 'avisos') abaAvisos.recarregar();
   ```
   antes do `if (aba === 'conversa') campoFala.focus();`.

## Passo 4: `apps/desktop/src/estilo.css` (no fim do arquivo)
Prefixo `.av-`. Use as variáveis que já existem: `--vidro`, `--borda`, `--ciano`, `--texto`, `--texto-2`, `--apagado`, `--alta`, `--mono` e `--raio`. Copie o visual dos cartões `.hj-`. O mínimo:
- `.av-grade`: `display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px;`. No `@media (max-width: 900px)`, uma coluna só.
- `.av-item`:
  - cartão com borda `var(--borda)`, `border-radius: var(--raio)`, fundo `var(--vidro)`, `padding: 12px 14px` e `cursor: default`;
  - `.av-nao-lido` com borda à esquerda de 3px em `var(--ciano)` e `cursor: pointer`;
  - `.av-urgente` com essa borda em `var(--alta)`;
  - `.av-apagado` com `opacity: .55`.
- `.av-tipo`, `.av-quando` e `.av-status`: `font-family: var(--mono); font-size: 11px; color: var(--texto-2);`. O `.av-tipo` em `var(--ciano)`.
- `.av-corpo`: `white-space: pre-line; color: var(--texto); margin: 6px 0;`.
- `.av-motivo`: `font-size: 12.5px; color: var(--texto-2); margin: 0;`.
- `.av-filhos summary`: `cursor: pointer; color: var(--texto-2); font-size: 12px;`.
- `.av-prefs`:
  - os `fieldset` sem borda grossa (`border: 1px solid var(--borda); border-radius: 10px;`);
  - os `input[type=time]` no mesmo estilo dos inputs do `.hj-`/`.cn-`, com fundo escuro, texto claro e `color-scheme: dark`.
- `.av-erro`: `color: var(--erro);`.
- **Selo da aba:**
  ```css
  .abas-painel button[data-selo]:not([data-selo=""])::after {
    content: attr(data-selo); margin-left: 6px; padding: 0 6px; border-radius: 999px;
    background: var(--ciano); color: #04060b; font-size: 11px; font-weight: 600;
  }
  ```

## Passo 5: verificar e gravar
```powershell
pnpm.cmd typecheck
```
```powershell
pnpm.cmd test
```
Os dois têm que passar. Depois disso, faça o commit **só** dos 3 arquivos:
```powershell
git add apps/desktop/src/abaAvisos.ts apps/desktop/src/main.ts apps/desktop/src/estilo.css
```
```powershell
git commit -m "Aba Avisos: histórico com o motivo, ajustes e selo de não vistos" -m "Feito no Cursor."
```

**Pronto quando:**
- existe a aba **Avisos**, entre Lembretes e Memória;
- ela mostra o histórico com tipo, hora, canal, corpo e **Por quê**; os agrupados aparecem dentro de "ver os N";
- o form salva o silêncio e os horários dos resumos, e "Salvo ✓" aparece;
- "voltar ao normal" tira um ajuste;
- o selo some depois de "Marcar todos como vistos";
- sem internet, aparece a mensagem de erro e nada quebra;
- o typecheck e os testes passam, e o commit está feito.

---

## Notas do Cursor
(escreva aqui se algo não bateu)
