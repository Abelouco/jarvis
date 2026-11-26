# Ficha: painel do dia (PC), a aba "Hoje"

**Quem faz:** Cursor. **Quem revisa:** Claude (só o diff).
**Contexto:** Fase 2 · última etapa do PC. Tudo o que o painel mostra já existe no core (`jarvis.*`). O painel só **junta e mostra**: não precisa de banco novo, servidor nem API nova.

## Arquivos que pode mexer
- `apps/desktop/src/hoje.ts` (novo)
- `apps/desktop/src/main.ts` (só: import, botão da aba, `<div class="vista">`, chamada `ligarHoje`, o tipo `Aba`/`lerAba` e o `hidden` da troca de aba)
- `apps/desktop/src/estilo.css` (acrescentar no fim, prefixo `.hj-`; trocar `repeat(7, auto)` por `repeat(8, auto)` em `.abas-painel`)

Não mexa em `packages/core`, `supabase/` nem `apps/mobile`. Se faltar algo na API, pare e anote no fim desta ficha.

## Modelo a copiar
O mesmo de `apps/desktop/src/conhecimento.ts` (que você fez): `htmlHoje()`, `ligarHoje(raiz, { pulsar?, irPara?: (aba) => void })`, redesenha em `jarvis.aoMudar` e escapa todo texto do usuário com `esc`.

## A aba
- Botão **Hoje** como **primeira** aba, antes de Conversa. Ela **não** vira a aba padrão: `lerAba` continua caindo em `'conversa'` quando não há nada salvo.
- `irPara(aba)` em `main.ts` = a mesma função que já troca de aba ao clicar nos botões. Exponha-a para o `ligarHoje`.

## O que mostrar (cartões numa grade de 2 colunas; 1 coluna abaixo de 900 px)
Use só o que já existe:

| Cartão | Fonte | Conteúdo | Ação |
|---|---|---|---|
| **Tarefas** | `jarvis.tarefas.listar()` | Atrasadas (vermelho) + de hoje, por hora; sem data com prioridade alta no fim | Caixa para concluir (`alternarConcluida`); "ver todas" → `irPara('tarefas')` |
| **Lembretes** | `jarvis.lembretes.listar()` | Os que caem hoje (`remind_at` no dia de hoje em São Paulo), com hora; os que já passaram aparecem apagados | "ver todos" → `irPara('lembretes')` |
| **Hábitos** | `jarvis.habitos.listar()` | Os de `previstoHoje && !paused`: feito/falta, sequência (`sequencia.n`) | Clique alterna (`alternar(id)`); com meta, `somar(id, 1)`; "ver todos" → `irPara('habitos')` |
| **Diário** | `jarvis.conhecimento.diario()` | Se já há texto hoje: as 3 primeiras linhas. Se não: o convite "Como foi o dia?" | Clique → `irPara('conhecimento')` (a aba já abre no Diário? se não, só vá para a aba) |
| **Projetos** | `jarvis.projetos.listar()` | Os em andamento, com barra de progresso e o próximo prazo | "ver todos" → `irPara('projetos')` |

- Cabeçalho: "Bom dia/Boa tarde/Boa noite" pela hora de São Paulo, a data por extenso e uma linha-resumo (ex.: "2 atrasadas · 4 para hoje · 3 hábitos faltando").
- Dia 100% feito (sem tarefa atrasada nem de hoje, e todos os hábitos de hoje feitos): mostre um selo discreto "Dia em dia ✓".
- Cartão vazio: uma frase curta, sem buraco (ex.: "Nenhum lembrete hoje.").
- Datas: use `hojeSP`/`somarDias` como os outros arquivos. Para a hora do lembrete, o mesmo jeito que `lembretes.ts` já usa.
- Depois de concluir ou marcar algo: `op.pulsar?.()`.

Dica embaixo: *Ou peça na conversa: "o que tenho hoje?", "meditei", "me lembra às 18h de ligar pro João".*

## Pronto quando
- A aba Hoje aparece em primeiro e os 5 cartões mostram os dados reais.
- Concluir tarefa e marcar hábito pelo painel funcionam e o painel se atualiza sozinho.
- Algo feito pela conversa (ex.: "meditei") aparece no painel sem recarregar.
- `npx.cmd tsc --noEmit` passa em `apps/desktop` e `node --test supabase/functions/ia_conversar/regras.test.ts` continua passando.
- Um commit pequeno: `Hoje: painel do dia com tarefas, lembretes, hábitos, diário e projetos`.

## Notas do Cursor (preencher se travar)
