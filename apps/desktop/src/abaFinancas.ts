// Aba Finanças (Fase 4 · etapa 6): resumo do mês, saldos, o que vence, lançamentos e contas fixas.
// Tudo direto no Supabase por `jarvis.financas`; a conversa faz o mesmo ("gastei 45 no mercado").
import {
  centavos, hojeSP, mesDe, reais, somarMeses,
  type ContaFin, type Fixa, type Lancamento, type PainelFinancas,
} from '@jarvis/core';
import { jarvis } from './jarvis';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** "27/11" ou "hoje"/"amanhã"/"ontem" */
function dia(d: string): string {
  const hoje = hojeSP();
  const desloca = (n: number) => {
    const x = new Date(`${hoje}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  if (d === hoje) return 'hoje';
  if (d === desloca(1)) return 'amanhã';
  if (d === desloca(-1)) return 'ontem';
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

const nomeMes = (mes: string) => {
  const s = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const ICONE: Record<ContaFin['kind'], string> = { conta: '🏦', cartao: '💳', carteira: '👛' };

export function htmlFinancas(): string {
  return `
<div class="fn">
  <header class="fn-topo">
    <div>
      <h2>Finanças</h2>
      <p class="fn-sub">Sem banco conectado: você lança (aqui ou falando) e eu somo. Na conversa: <em>"gastei 45 no mercado"</em>, <em>"paguei a luz"</em>, <em>"quanto gastei este mês?"</em>.</p>
    </div>
    <div class="fn-mes">
      <button type="button" class="fn-mes-ant" title="Mês anterior">‹</button>
      <strong class="fn-mes-nome"></strong>
      <button type="button" class="fn-mes-prox" title="Próximo mês">›</button>
    </div>
  </header>
  <p class="fn-erro" hidden></p>
  <div class="fn-cartoes">
    <div class="fn-num"><span>Receitas</span><strong class="fn-receitas">—</strong></div>
    <div class="fn-num"><span>Despesas</span><strong class="fn-despesas">—</strong></div>
    <div class="fn-num"><span>Saldo do mês</span><strong class="fn-saldo">—</strong></div>
  </div>
  <div class="fn-grade">
    <section class="fn-principal">
      <form class="fn-novo" autocomplete="off">
        <div class="fn-tipo" role="radiogroup">
          <label><input type="radio" name="kind" value="despesa" checked /> Despesa</label>
          <label><input type="radio" name="kind" value="receita" /> Receita</label>
        </div>
        <input name="valor" placeholder="Valor (ex.: 45,90)" inputmode="decimal" required />
        <input name="description" placeholder="Descrição (ex.: Mercado)" maxlength="200" required />
        <input name="category" placeholder="Categoria" maxlength="40" list="fn-categorias" />
        <datalist id="fn-categorias"></datalist>
        <select name="account_id"><option value="">Sem conta</option></select>
        <input type="date" name="occurred_on" required />
        <input name="parcelas" type="number" min="1" max="72" placeholder="Parcelas" title="Parcelas (1 = à vista)" />
        <label class="fn-apagar-check"><input type="checkbox" name="a_pagar" /> a pagar</label>
        <button class="fn-adicionar">Lançar</button>
      </form>
      <h3>Lançamentos do mês</h3>
      <ul class="fn-lista"></ul>
    </section>
    <aside class="fn-lado">
      <section class="fn-cartao">
        <h3>Saldos</h3>
        <ul class="fn-contas"></ul>
        <details class="fn-nova-conta">
          <summary>+ conta ou cartão</summary>
          <form class="fn-form-conta" autocomplete="off">
            <input name="name" placeholder="Nome (ex.: Nubank)" maxlength="80" required />
            <select name="kind"><option value="conta">Conta</option><option value="cartao">Cartão de crédito</option><option value="carteira">Carteira</option></select>
            <input name="saldo" placeholder="Saldo hoje (ex.: 1.200,00)" inputmode="decimal" />
            <div class="fn-dias" hidden>
              <input name="closing_day" type="number" min="1" max="31" placeholder="Fecha dia" />
              <input name="due_day" type="number" min="1" max="31" placeholder="Vence dia" />
            </div>
            <button class="fn-salvar">Salvar</button>
          </form>
        </details>
      </section>
      <section class="fn-cartao">
        <h3>A pagar e a receber</h3>
        <ul class="fn-vencer"></ul>
      </section>
      <section class="fn-cartao">
        <h3>Onde foi o dinheiro</h3>
        <ul class="fn-categorias"></ul>
      </section>
      <section class="fn-cartao">
        <h3>Contas fixas</h3>
        <ul class="fn-fixas"></ul>
        <details class="fn-nova-fixa">
          <summary>+ conta fixa</summary>
          <form class="fn-form-fixa" autocomplete="off">
            <input name="description" placeholder="Ex.: Aluguel" maxlength="200" required />
            <input name="valor" placeholder="Valor" inputmode="decimal" required />
            <input name="day_of_month" type="number" min="1" max="31" placeholder="Dia do mês" required />
            <button class="fn-salvar">Salvar</button>
          </form>
        </details>
      </section>
    </aside>
  </div>
</div>`;
}

export function ligarAbaFinancas(raiz: HTMLElement, op: { pulsar: () => void }) {
  const $ = <T extends Element>(s: string) => raiz.querySelector<T>(s)!;
  let mes = mesDe(hojeSP());
  let painel: PainelFinancas | null = null;
  let carregando = false;
  let denovo = false;

  const erro = (t: string) => {
    const p = $<HTMLParagraphElement>('.fn-erro');
    p.textContent = t;
    p.hidden = !t;
  };
  const tentar = async (f: () => Promise<unknown>) => {
    try {
      erro('');
      await f();
      op.pulsar();
      await recarregar();
    } catch (e) {
      erro(`Não consegui salvar (${e instanceof Error ? e.message : e}).`);
    }
  };

  const nomeConta = (id: string | null) => painel?.contas.find((c) => c.id === id)?.name ?? null;

  function linhaLanc(l: Lancamento): string {
    const sinal = l.kind === 'receita' ? '+' : l.kind === 'transferencia' ? '⇄' : '−';
    const onde = l.kind === 'transferencia'
      ? `${nomeConta(l.account_id) ?? '?'} → ${nomeConta(l.to_account_id) ?? '?'}`
      : nomeConta(l.account_id) ?? '';
    const parcela = l.installment_total ? ` <small>${l.installment_no}/${l.installment_total}</small>` : '';
    const aberto = !l.paid && l.kind !== 'transferencia';
    return `<li class="fn-item fn-${l.kind}${aberto ? ' fn-aberto' : ''}" data-id="${l.id}">
      <button type="button" class="fn-check" title="${aberto ? 'Marcar como pago' : 'Voltar para a pagar'}" ${l.kind === 'transferencia' ? 'disabled' : ''}>${aberto ? '' : '✓'}</button>
      <div class="fn-desc"><strong>${esc(l.description)}${parcela}</strong>
        <span>${dia(l.occurred_on)}${l.category ? ` · ${esc(l.category)}` : ''}${onde ? ` · ${esc(onde)}` : ''}${aberto && l.due_on ? ` · vence ${dia(l.due_on)}` : ''}</span></div>
      <span class="fn-valor">${sinal} ${reais(l.amount_cents)}</span>
      <button type="button" class="fn-x" title="Apagar">×</button>
    </li>`;
  }

  function desenhar() {
    const p = painel;
    $<HTMLElement>('.fn-mes-nome').textContent = nomeMes(mes);
    if (!p) return;
    $<HTMLElement>('.fn-receitas').textContent = reais(p.resumo.receitas);
    $<HTMLElement>('.fn-despesas').textContent = reais(p.resumo.despesas);
    const s = $<HTMLElement>('.fn-saldo');
    s.textContent = reais(p.resumo.saldo);
    s.classList.toggle('fn-neg', p.resumo.saldo < 0);

    const lista = p.recentes;
    $<HTMLUListElement>('.fn-lista').innerHTML = lista.length
      ? lista.map(linhaLanc).join('')
      : '<li class="fn-vazio">Nada lançado neste mês. Use o formulário acima ou fale "gastei 30 de Uber".</li>';

    $<HTMLUListElement>('.fn-contas').innerHTML = p.contas.length
      ? p.contas.map((c) => `<li data-conta="${c.id}"><span>${ICONE[c.kind]} ${esc(c.name)}${c.kind === 'cartao' && c.closing_day ? ` <small>fecha ${c.closing_day} · vence ${c.due_day ?? c.closing_day}</small>` : ''}</span>
          <strong class="${c.saldo < 0 ? 'fn-neg' : ''}">${c.kind === 'cartao' && c.saldo < 0 ? `deve ${reais(-c.saldo)}` : reais(c.saldo)}</strong>
          <button type="button" class="fn-x" title="Apagar conta">×</button></li>`).join('')
      : '<li class="fn-vazio">Nenhuma conta ainda.</li>';

    $<HTMLUListElement>('.fn-vencer').innerHTML = p.aVencer.length
      ? p.aVencer.map((v) => `<li data-tipo="${v.tipo}" data-id="${v.id}" class="${v.vence < hojeSP() ? 'fn-atrasada' : ''}">
          <span>${esc(v.descricao)} <small>${dia(v.vence)}${v.tipo === 'fixa' ? ' · fixa' : ''}</small></span>
          <strong>${v.kind === 'receita' ? '+' : '−'} ${reais(v.valor)}</strong>
          <button type="button" class="fn-pagar">${v.kind === 'receita' ? 'recebi' : 'paguei'}</button></li>`).join('')
      : '<li class="fn-vazio">Nada em aberto neste mês.</li>';

    const maior = Math.max(1, ...p.resumo.categorias.map((c) => c.total));
    $<HTMLUListElement>('.fn-categorias').innerHTML = p.resumo.categorias.length
      ? p.resumo.categorias.slice(0, 8).map((c) => `<li><span>${esc(c.categoria)}</span><strong>${reais(c.total)}</strong>
          <i style="width:${Math.round((c.total / maior) * 100)}%"></i></li>`).join('')
      : '<li class="fn-vazio">Sem despesas no mês.</li>';

    $<HTMLUListElement>('.fn-fixas').innerHTML = p.fixas.filter((f) => f.active).length
      ? p.fixas.filter((f) => f.active).map((f) => `<li data-fixa="${f.id}"><span>${esc(f.description)} <small>dia ${f.day_of_month}</small></span>
          <strong>${reais(f.amount_cents)}</strong><button type="button" class="fn-x" title="Apagar conta fixa">×</button></li>`).join('')
      : '<li class="fn-vazio">Nenhuma. Ex.: aluguel, luz, internet.</li>';

    const sel = $<HTMLSelectElement>('.fn-novo select[name="account_id"]');
    const atual = sel.value;
    sel.innerHTML = '<option value="">Sem conta</option>' + p.contas.map((c) => `<option value="${c.id}">${ICONE[c.kind]} ${esc(c.name)}</option>`).join('');
    sel.value = p.contas.some((c) => c.id === atual) ? atual : '';
    $<HTMLDataListElement>('#fn-categorias').innerHTML = [...new Set([...p.resumo.categorias.map((c) => c.categoria),
      'Mercado', 'Transporte', 'Moradia', 'Contas', 'Lazer', 'Saúde', 'Salário'])].map((c) => `<option value="${esc(c)}"></option>`).join('');
  }

  async function recarregar() {
    if (carregando) {
      denovo = true;
      return;
    }
    carregando = true;
    try {
      painel = await jarvis.financas.painel(mes);
      erro('');
      desenhar();
    } catch (e) {
      erro(`Sem conexão com o servidor agora (${e instanceof Error ? e.message : e}).`);
    } finally {
      carregando = false;
      if (denovo) {
        denovo = false;
        void recarregar();
      }
    }
  }

  // ----- mês -----
  $<HTMLButtonElement>('.fn-mes-ant').onclick = () => { mes = mesDe(somarMeses(`${mes}-01`, -1)); painel = null; desenhar(); void recarregar(); };
  $<HTMLButtonElement>('.fn-mes-prox').onclick = () => { mes = mesDe(somarMeses(`${mes}-01`, 1)); painel = null; desenhar(); void recarregar(); };

  // ----- novo lançamento -----
  const form = $<HTMLFormElement>('.fn-novo');
  const data = form.elements.namedItem('occurred_on') as HTMLInputElement;
  data.value = hojeSP();
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const valor = centavos(String(f.get('valor') ?? ''));
    if (!valor) return erro('Valor inválido. Ex.: 45,90');
    const n = {
      kind: f.get('kind') === 'receita' ? 'receita' as const : 'despesa' as const,
      amount_cents: valor,
      description: String(f.get('description') ?? '').trim(),
      category: String(f.get('category') ?? '').trim() || null,
      account_id: String(f.get('account_id') ?? '') || null,
      occurred_on: String(f.get('occurred_on') ?? hojeSP()),
      paid: f.get('a_pagar') ? false : undefined,
      parcelas: Number(f.get('parcelas')) || 1,
    };
    void tentar(async () => {
      await jarvis.financas.registrar(n);
      const conta = n.account_id;
      form.reset();
      data.value = hojeSP();
      (form.elements.namedItem('account_id') as HTMLSelectElement).value = conta ?? '';
      if (mesDe(n.occurred_on) !== mes) mes = mesDe(n.occurred_on);
    });
  };

  // ----- cliques nas listas -----
  raiz.addEventListener('click', (e) => {
    const alvo = e.target as HTMLElement;
    const item = alvo.closest<HTMLLIElement>('.fn-item');
    if (item) {
      const l = painel?.recentes.find((x) => x.id === item.dataset.id);
      if (!l) return;
      if (alvo.closest('.fn-check')) void tentar(() => jarvis.financas.marcarPago(l.id, !l.paid));
      else if (alvo.closest('.fn-x') && confirm(`Apagar "${l.description}" (${reais(l.amount_cents)})? Dá para desfazer na conversa por 24 h.`)) {
        void tentar(() => jarvis.financas.apagarLancamento(l.id));
      }
      return;
    }
    const v = alvo.closest<HTMLLIElement>('.fn-vencer li[data-id]');
    if (v && alvo.closest('.fn-pagar')) {
      if (v.dataset.tipo === 'fixa') {
        const f = painel?.fixas.find((x) => x.id === v.dataset.id);
        if (f) void tentar(() => jarvis.financas.pagarFixa(f as Fixa));
      } else void tentar(() => jarvis.financas.marcarPago(v.dataset.id!, true));
      return;
    }
    const c = alvo.closest<HTMLLIElement>('.fn-contas li[data-conta]');
    if (c && alvo.closest('.fn-x')) {
      const conta = painel?.contas.find((x) => x.id === c.dataset.conta);
      if (conta && confirm(`Apagar a conta "${conta.name}"? Os lançamentos dela continuam.`)) void tentar(() => jarvis.financas.apagarConta(conta.id));
      return;
    }
    const fx = alvo.closest<HTMLLIElement>('.fn-fixas li[data-fixa]');
    if (fx && alvo.closest('.fn-x')) {
      const f = painel?.fixas.find((x) => x.id === fx.dataset.fixa);
      if (f && confirm(`Apagar a conta fixa "${f.description}"?`)) void tentar(() => jarvis.financas.apagarFixa(f.id));
    }
  });

  // ----- nova conta / cartão -----
  const fc = $<HTMLFormElement>('.fn-form-conta');
  const tipoConta = fc.elements.namedItem('kind') as HTMLSelectElement;
  tipoConta.onchange = () => {
    $<HTMLDivElement>('.fn-dias').hidden = tipoConta.value !== 'cartao';
    (fc.elements.namedItem('saldo') as HTMLInputElement).placeholder = tipoConta.value === 'cartao' ? 'Já deve (ex.: 350,00)' : 'Saldo hoje (ex.: 1.200,00)';
  };
  fc.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(fc);
    const kind = String(f.get('kind')) as ContaFin['kind'];
    const s = centavos(String(f.get('saldo') ?? '')) ?? 0;
    void tentar(async () => {
      await jarvis.financas.salvarConta({
        name: String(f.get('name') ?? ''), kind, opening_balance_cents: kind === 'cartao' ? -s : s,
        closing_day: Number(f.get('closing_day')) || null, due_day: Number(f.get('due_day')) || null,
      });
      fc.reset();
      $<HTMLDivElement>('.fn-dias').hidden = true;
      $<HTMLDetailsElement>('.fn-nova-conta').open = false;
    });
  };

  // ----- nova conta fixa -----
  const ff = $<HTMLFormElement>('.fn-form-fixa');
  ff.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(ff);
    const valor = centavos(String(f.get('valor') ?? ''));
    const d = Number(f.get('day_of_month'));
    if (!valor) return erro('Valor inválido. Ex.: 1.500,00');
    void tentar(async () => {
      await jarvis.financas.salvarFixa({ description: String(f.get('description') ?? ''), amount_cents: valor, day_of_month: d });
      ff.reset();
      $<HTMLDetailsElement>('.fn-nova-fixa').open = false;
    });
  };

  desenhar();
  return { recarregar };
}
