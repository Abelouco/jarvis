# Ficha: tirar os marcos da aba Projetos (PC), passo a passo

**Quem faz:** Cursor. **Quem revisa:** Claude (só o diff do commit).
**Objetivo:** o dono pediu para tirar os **marcos** da aba Projetos. É **só tela**:
- a tabela `project_milestones`, as funções `jarvis.projetos.*Marco` e os dados continuam existindo;
- nada é apagado no banco;
- as cores novas dos nós no núcleo já foram feitas pelo Claude (não mexa no núcleo).

---

## Regras
1. Trabalhe em `D:\JARVIS`, na branch `main`, editando os arquivos direto. Nada de worktree nem agente em segundo plano.
2. Toque **só** em:
   - `apps/desktop/src/projetos.ts`;
   - `apps/desktop/src/estilo.css` (só o passo 3).
3. Se um trecho abaixo não bater com o arquivo, **pare** e anote em "Notas do Cursor", no fim desta ficha.

---

## Passo 1: ler (só leitura)
Leia `apps/desktop/src/projetos.ts` inteiro. São cerca de 330 linhas.

## Passo 2: editar `apps/desktop/src/projetos.ts`, uma troca por vez

### 2.1 Comentário do topo (linha 1)
Troque:
```ts
// Aba Projetos (Fase 2 · Etapa 3): lista com progresso e, ao abrir um projeto, marcos + quadro
```
por:
```ts
// Aba Projetos (Fase 2 · Etapa 3): lista com progresso e, ao abrir um projeto, o quadro
```

### 2.2 Import (linha 4): tire `type Milestone, `
Deve ficar:
```ts
import { hojeSP, somarDias, type ProjetoResumo, type StatusProjeto, type Task } from '@jarvis/core';
```

### 2.3 Dica da conversa (linha ~51)
Troque `<em>"cria o projeto Lançar o app com os marcos protótipo e testes"</em>` por:
```html
<em>"cria o projeto Lançar o app"</em>
```

### 2.4 Variável do filtro
Apague as duas linhas abaixo:
- `let filtroMarco: string | null = null;` (linha ~64);
- `filtroMarco = null;`, dentro de `abrir()` (linha ~131).

### 2.5 Cartão da lista (linha ~100)
Apague a linha:
```ts
      p.marcos ? `${p.marcosFeitos}/${p.marcos} marcos` : '',
```

### 2.6 `cardTarefa`
A função fica com **um** parâmetro e sem a etiqueta do marco. A assinatura passa a ser:
```ts
  function cardTarefa(t: Task) {
```
Apague estas duas linhas:
```ts
    const marco = t.milestone_id ? marcos.get(t.milestone_id) : undefined;
```
```ts
        ${marco ? `<span class="card-marco" title="Marco">◆ ${esc(marco.title)}</span>` : ''}
```

### 2.7 Início de `desenhar()` (linhas ~162–165)
Troque estas 4 linhas:
```ts
    const [marcos, todas] = await Promise.all([jarvis.projetos.marcos(p.id), jarvis.tarefas.listar()]);
    const mapa = new Map(marcos.map((m) => [m.id, m]));
    let tarefas = todas.filter((t) => t.project_id === p.id);
    if (filtroMarco) tarefas = tarefas.filter((t) => (filtroMarco === 'sem' ? !t.milestone_id || !mapa.has(t.milestone_id) : t.milestone_id === filtroMarco));
```
por:
```ts
    const todas = await jarvis.tarefas.listar();
    const tarefas = todas.filter((t) => t.project_id === p.id);
```

### 2.8 HTML do detalhe
Apague o bloco inteiro `<section class="secao marcos"> … </section>`. Ele vai da linha ~199 até o `</section>` logo antes de `<section class="secao">` / `<h3>Quadro</h3>`.

Dentro da seção do Quadro:
- apague o bloco `${marcos.length ? `<div class="chips filtro-marco"> … </div>` : ''}` (as linhas ~217–221);
- no formulário `#nova-tarefa-proj`, apague a linha do `<select name="m" …>`, que vai de `${marcos.length ? `<select` até `</select>` : ''}`;
- na coluna, troque `cardTarefa(t, mapa)` por `cardTarefa(t)`.

### 2.9 Formulários do detalhe (linhas ~241–248)
Apague o bloco do `#novo-marco`, de `const fm = detalhe.querySelector<HTMLFormElement>('#novo-marco')!;` até o `};` dele.

No `ft.onsubmit`, apague a linha `const marco = …` e troque:
```ts
      await jarvis.tarefas.criar(t, 'media', (ft.d as HTMLInputElement).value || null, null, { projeto: p.id, marco });
```
por:
```ts
      await jarvis.tarefas.criar(t, 'media', (ft.d as HTMLInputElement).value || null, null, { projeto: p.id });
```

### 2.10 Cliques (`detalhe.onclick`, linhas ~303–311)
Apague os dois blocos abaixo, inteiros:
```ts
    if (b.dataset.filtro !== undefined) {
      filtroMarco = b.dataset.filtro || null;
      return void desenhar();
    }
    const marco = b.closest<HTMLElement>('.marco')?.dataset.id;
    if (marco) {
      if (b.classList.contains('check')) return jarvis.projetos.alternarMarco(marco);
      if (b.classList.contains('apagar')) return jarvis.projetos.apagarMarco(marco);
    }
```

### 2.11 Conferir
Procure por `marco` e por `Marco` no arquivo. Não deve sobrar **nenhuma** ocorrência.

## Passo 3: `apps/desktop/src/estilo.css` (linhas ~612–658)
**3.1 Apague por inteiro** as linhas que começam com estes seletores. São só de marco, nada mais as usa:
- `.lista-marcos {`
- todas as que começam com `.marco ` ou `.marco:` ou `.marco.`: são 12 linhas seguidas, da ~626 à ~637;
- `.filtro-marco {`
- `.card-marco {`

**3.2 Linhas que misturam marco com outra coisa:** tire **só** o pedaço do marco e deixe o resto.

| Antes (começo da linha) | Depois |
|---|---|
| `.proj-editar input, .proj-editar textarea, .novo-marco input, .nova-tarefa-proj input, .nova-tarefa-proj select {` | `.proj-editar input, .proj-editar textarea, .nova-tarefa-proj input, .nova-tarefa-proj select {` |
| `.proj-editar input:focus, .proj-editar textarea:focus, .novo-marco input:focus, .nova-tarefa-proj input:focus,` | `.proj-editar input:focus, .proj-editar textarea:focus, .nova-tarefa-proj input:focus,` |
| `.proj-editar .salvar, .novo-marco .salvar, .nova-tarefa-proj .salvar {` | `.proj-editar .salvar, .nova-tarefa-proj .salvar {` |
| `.novo-marco, .nova-tarefa-proj { display: flex; …` | `.nova-tarefa-proj { display: flex; …` |
| `.novo-marco input[name='t'], .nova-tarefa-proj input[name='t'] { …` | `.nova-tarefa-proj input[name='t'] { …` |

**3.3 Conferir:** procure `marco` no `estilo.css`. Não pode sobrar nenhuma ocorrência.

## Passo 4: verificar e gravar
```powershell
pnpm.cmd typecheck
```
```powershell
pnpm.cmd test
```
Os dois têm que passar. Depois disso, faça o commit **só** dos 2 arquivos:
```powershell
git add apps/desktop/src/projetos.ts apps/desktop/src/estilo.css
```
```powershell
git commit -m "Projetos: tira os marcos da tela (dados continuam no banco)" -m "Feito no Cursor."
```

**Pronto quando:**
- a aba Projetos abre o projeto e mostra só o cabeçalho e o quadro A fazer / Fazendo / Feito;
- criar tarefa no projeto e mover entre colunas continuam funcionando;
- o typecheck e os testes passam;
- o commit está feito.

---

## Notas do Cursor
(escreva aqui se algo não bateu)
