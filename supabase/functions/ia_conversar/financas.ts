// Ferramentas de finanças da IA (Fase 4 · etapa 6): lançamentos digitados ou falados, sem banco.
// Tudo é sensível (só Groq). Toda escrita tem recibo (desfazer por 24 h); apagar pede `cf_`.
// As regras de dinheiro (centavos, fatura, parcelas, saldo) vêm de financas_regras.ts (cópia do core).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { normalizar } from './sensivel.ts';
import {
  dataHumana, falha, pedirConfirmacao, recibo, registrar, resolverQuando, type Ctx, type ResultadoFerramenta,
} from './tarefas.ts';
import {
  aVencer, centavos, faturaDaCompra, mesDe, parcelar, periodoDaFatura, reais, resumoMes, saldo, somarMeses,
  type ContaFin, type FixaFin, type LancamentoFin,
} from './financas_regras.ts';

const DETECTOR =
  /\b(gast\w*|despesas?|receitas?|salario|paguei|pagar|pagamento|conta fixa|contas fixas|contas a pagar|fatura\w*|cartao|cartoes|saldos?|financ\w*|dinheiro|reais|transferi\w*|transferencia|pix|boleto\w*|parcel\w*|lancamento\w*|orcamento|extrato|recebi|ganhei)\b|r\$\s?\d/;
export const pareceFinancas = (texto: string) => DETECTOR.test(normalizar(texto));

const NL = '\n';
const CAMPOS_L = 'id, kind, amount_cents, account_id, to_account_id, occurred_on, paid, due_on, category, description, recurring_id, installment_no, installment_total';
type Lanc = LancamentoFin & { installment_no: number | null; installment_total: number | null };

// ---------- leitura ----------

async function contas(sb: SupabaseClient): Promise<ContaFin[]> {
  const { data } = await sb.from('fin_accounts').select('id, name, kind, opening_balance_cents, closing_day, due_day')
    .is('deleted_at', null).eq('archived', false).order('created_at');
  return (data ?? []) as ContaFin[];
}
async function fixas(sb: SupabaseClient): Promise<(FixaFin & { created_at: string })[]> {
  const { data } = await sb.from('fin_recurring').select('id, description, kind, amount_cents, day_of_month, active, until, account_id, category, created_at')
    .is('deleted_at', null).order('day_of_month');
  return (data ?? []) as (FixaFin & { created_at: string })[];
}
async function lancamentos(sb: SupabaseClient, de?: string, ate?: string): Promise<Lanc[]> {
  let q = sb.from('fin_transactions').select(CAMPOS_L).is('deleted_at', null);
  if (de) q = q.gte('occurred_on', de);
  if (ate) q = q.lte('occurred_on', ate);
  const { data } = await q.order('occurred_on', { ascending: false }).limit(2000);
  return (data ?? []) as Lanc[];
}

// ---------- referências ----------

const palavras = (s: string) => normalizar(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);

function acharConta(cs: ContaFin[], ref: unknown): ContaFin | string | null {
  if (ref === undefined || ref === null || String(ref).trim() === '') return null;
  const r = normalizar(String(ref)).trim();
  const exata = cs.filter((c) => normalizar(c.name) === r);
  if (exata.length === 1) return exata[0]!;
  const ws = palavras(r).filter((w) => !['conta', 'cartao', 'do', 'da', 'no', 'na'].includes(w));
  const parecidas = cs.filter((c) => ws.length && ws.every((w) => normalizar(c.name).includes(w)));
  if (parecidas.length === 1) return parecidas[0]!;
  if (parecidas.length > 1) return `"${ref}" bate com mais de uma conta: ${parecidas.map((c) => `**${c.name}**`).join(', ')}. Qual?`;
  return `Não achei a conta "${ref}". Contas: ${cs.length ? cs.map((c) => `**${c.name}**`).join(', ') : 'nenhuma ainda'} (diga "cria a conta X" ou "cria o cartão X").`;
}

function pontuar(ref: string, texto: string): number {
  const alvo = normalizar(texto);
  const ws = palavras(ref);
  return ws.length && ws.every((w) => alvo.includes(w)) ? ws.length : 0;
}

function acharLancamentos(ls: Lanc[], refs: unknown, soAbertos = false) {
  const lista = (Array.isArray(refs) ? refs : [refs]).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const achados: Lanc[] = [];
  const avisos: string[] = [];
  for (const ref of lista) {
    const base = soAbertos ? ls.filter((l) => !l.paid) : ls;
    const notas = base.map((l) => [l, pontuar(ref, `${l.description} ${l.category ?? ''}`)] as const).filter(([, n]) => n > 0);
    if (!notas.length) {
      avisos.push(`Não achei lançamento${soAbertos ? ' em aberto' : ''} para "${ref}".`);
      continue;
    }
    const melhor = Math.max(...notas.map(([, n]) => n));
    // Empate: o mais recente (a lista vem do mais novo para o mais velho).
    const l = notas.find(([, n]) => n === melhor)![0];
    if (!achados.some((x) => x.id === l.id)) achados.push(l);
  }
  return { achados, aviso: avisos.join(NL) };
}

// ---------- texto ----------

const nomeConta = (cs: ContaFin[], id: string | null) => cs.find((c) => c.id === id)?.name ?? null;

function linhaLanc(l: Lanc, cs: ContaFin[], hoje: string): string {
  const sinal = l.kind === 'receita' ? '+' : l.kind === 'transferencia' ? '⇄' : '−';
  const onde = l.kind === 'transferencia'
    ? ` · ${nomeConta(cs, l.account_id) ?? '?'} → ${nomeConta(cs, l.to_account_id) ?? '?'}`
    : nomeConta(cs, l.account_id) ? ` · ${nomeConta(cs, l.account_id)}` : '';
  const parcela = l.installment_total ? ` (${l.installment_no}/${l.installment_total})` : '';
  const aberto = !l.paid && l.kind !== 'transferencia' ? ` · em aberto${l.due_on ? `, vence ${dataHumana(l.due_on, hoje)}` : ''}` : '';
  return `- ${sinal} **${reais(l.amount_cents)}** ${l.description}${parcela} · ${dataHumana(l.occurred_on, hoje)}${l.category ? ` · ${l.category}` : ''}${onde}${aberto}`;
}

const ok = (ferramenta: string, resumo: string, texto: string, fatos: Record<string, unknown> = {}, ids: string[] = []): ResultadoFerramenta =>
  ({ ferramenta, ok: true, resumo, fatos: { financas: true, ...fatos }, texto, ids });
const erro = (ferramenta: string, msg: string): ResultadoFerramenta => ({ ...falha(ferramenta, msg), fatos: { financas: true } });

const categoria = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim().slice(0, 40) : '';
  return s ? s[0]!.toUpperCase() + s.slice(1) : null;
};

// ---------- escrita ----------

async function inserir(ctx: Ctx, linha: Record<string, unknown>, acao: string): Promise<Lanc | null> {
  const { data, error } = await ctx.sb.from('fin_transactions').insert(linha).select(CAMPOS_L).single();
  if (error) {
    console.warn('financas: insert falhou', error.message);
    return null;
  }
  await recibo(ctx.sb, acao, null, data as Lanc, 'fin_transactions');
  return data as Lanc;
}

async function mudar(ctx: Ctx, tabela: string, antes: { id: string }, m: Record<string, unknown>, acao: string) {
  const { data, error } = await ctx.sb.from(tabela).update(m).eq('id', antes.id).select('*').single();
  if (error) {
    console.warn('financas: update falhou', error.message);
    return null;
  }
  await recibo(ctx.sb, acao, antes, data, tabela);
  return data;
}

/** Mês pedido: "AAAA-MM", ou o mês de um QUANDO, ou o mês atual. */
function mesPedido(a: Record<string, unknown>, hoje: string): string {
  if (typeof a.mes === 'string' && /^\d{4}-\d{2}$/.test(a.mes)) return a.mes;
  if (a.mes === 'passado' || a.mes === 'anterior') return mesDe(somarMeses(hoje, -1));
  const q = resolverQuando(a, hoje);
  return mesDe(q ?? hoje);
}

registrar({
  ferramentas: `
financas_salvar_conta_ou_cartao {nome, tipo?: "conta"|"cartao"|"carteira", saldo_inicial?: VALOR, fechamento?: dia, vencimento?: dia}
financas_registrar_lancamento {tipo: "despesa"|"receita", valor: VALOR, descricao, categoria?, conta?: "nome da conta ou cartão", QUANDO?, pago?: false, parcelas?: número}
financas_registrar_transferencia {valor: VALOR, de: "conta", para: "conta", QUANDO?}
financas_registrar_fixa {descricao, valor: VALOR, dia_mes: número, tipo?: "despesa"|"receita", conta?, categoria?, ate?: "AAAA-MM-DD"}   (conta fixa: todo mês; se já existe com esse nome, muda)
financas_marcar_pago {refs?: ["descrição", ...], fatura?: "nome do cartão", conta?: "de onde saiu o dinheiro"}
financas_corrigir_lancamento {ref: "descrição", valor?: VALOR, descricao?, categoria?, conta?, QUANDO?}
financas_apagar {refs: ["descrição do lançamento ou da conta fixa", ...]}
financas_ver_mes {mes?: "AAAA-MM"|"passado"}
financas_ver_saldos {}
financas_ver_fatura {cartao?: "nome", mes?: "AAAA-MM"}
financas_ver_lancamentos {termo?, categoria?, mes?: "AAAA-MM"|"passado"}
VALOR = o valor como o dono falou, ex.: "45,90", "1.200", "mil e duzentos" -> "1200", "R$ 30" -> "30"`,
  regras: [
    '- FINANÇAS: "gastei 45 no mercado" -> financas_registrar_lancamento {tipo:"despesa", valor:"45", descricao:"Mercado", categoria:"Mercado"}. "recebi o salário de 5 mil" -> receita. Descrição curta com maiúscula; categoria de 1 palavra quando der (Mercado, Transporte, Moradia, Lazer, Saúde, Contas, Salário...). Não invente conta: só passe conta se o dono disser.',
    '- "no cartão X"/"no crédito do X" = conta:"X". "em 3x"/"parcelado em 3" = parcelas:3. "vou pagar dia 10"/"boleto pra dia 10" = pago:false com o dia em QUANDO.',
    '- "todo mês"/"conta fixa"/"mensalidade" = financas_registrar_fixa com dia_mes. "paguei a luz"/"paguei o aluguel" = financas_marcar_pago {refs:["luz"]}. "paguei a fatura do Nubank" = financas_marcar_pago {fatura:"Nubank"}.',
    '- "quanto gastei esse mês?"/"como estão minhas finanças?" -> financas_ver_mes. "quanto tenho?"/"saldo" -> financas_ver_saldos. "quanto gastei com Uber?" -> financas_ver_lancamentos {termo:"Uber"}.',
  ],
  detector: DETECTOR,
  executores: {
    async financas_salvar_conta_ou_cartao(ctx, a) {
      const nome = String(a.nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!nome) return erro('financas_salvar_conta_ou_cartao', 'Qual é o nome da conta ou do cartão?');
      const cs = await contas(ctx.sb);
      const existe = cs.find((c) => normalizar(c.name) === normalizar(nome));
      const tipo = ['conta', 'cartao', 'carteira'].includes(String(a.tipo)) ? String(a.tipo) : undefined;
      const dia = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 31 ? Number(v) : undefined);
      const m: Record<string, unknown> = {};
      if (tipo) m.kind = tipo;
      const si = a.saldo_inicial !== undefined ? centavos(a.saldo_inicial) : undefined;
      if (si !== undefined && si !== null) m.opening_balance_cents = si;
      if (dia(a.fechamento)) m.closing_day = dia(a.fechamento);
      if (dia(a.vencimento)) m.due_day = dia(a.vencimento);
      const ehCartao = (tipo ?? existe?.kind) === 'cartao';
      if (existe) {
        if (!Object.keys(m).length) return erro('financas_salvar_conta_ou_cartao', `A conta **${existe.name}** já existe. O que devo mudar nela?`);
        const nova = await mudar(ctx, 'fin_accounts', existe, m, 'financas_salvar_conta_ou_cartao');
        if (!nova) return erro('financas_salvar_conta_ou_cartao', 'Não consegui salvar a mudança.');
        return ok('financas_salvar_conta_ou_cartao', `conta "${nome}" atualizada`, `Atualizei **${existe.name}**.`, {}, [existe.id]);
      }
      const { data, error } = await ctx.sb.from('fin_accounts').insert({ name: nome, kind: tipo ?? 'conta', ...m })
        .select('id, name, kind, opening_balance_cents, closing_day, due_day').single();
      if (error) return erro('financas_salvar_conta_ou_cartao', `Não consegui criar (${error.message}).`);
      await recibo(ctx.sb, 'financas_salvar_conta_ou_cartao', null, data, 'fin_accounts');
      const c = data as ContaFin;
      const detalhe = c.kind === 'cartao'
        ? (c.closing_day ? ` · fecha dia ${c.closing_day}${c.due_day ? `, vence dia ${c.due_day}` : ''}` : ' · diga o dia de fechamento e de vencimento para eu montar as faturas')
        : ` · saldo inicial ${reais(c.opening_balance_cents)}`;
      return ok('financas_salvar_conta_ou_cartao', `${c.kind} "${c.name}" criada`,
        `${ehCartao ? 'Cartão' : c.kind === 'carteira' ? 'Carteira' : 'Conta'} **${c.name}** criado${ehCartao ? '' : 'a'}${detalhe}.`, {}, [c.id]);
    },

    async financas_registrar_lancamento(ctx, a) {
      const tipo = a.tipo === 'receita' ? 'receita' : 'despesa';
      const valor = centavos(a.valor);
      if (!valor) return erro('financas_registrar_lancamento', 'Qual foi o valor?');
      const descricao = String(a.descricao ?? '').trim().slice(0, 200) || (tipo === 'receita' ? 'Receita' : 'Despesa');
      const cs = await contas(ctx.sb);
      const conta = acharConta(cs, a.conta);
      if (typeof conta === 'string') return erro('financas_registrar_lancamento', conta);
      const data = resolverQuando(a, ctx.hoje) ?? ctx.hoje;
      const n = Math.max(1, Math.min(Number(a.parcelas) || 1, 72));
      const cartao = conta?.kind === 'cartao' ? conta : null;
      const grupo = n > 1 ? crypto.randomUUID() : null;
      const feitos: Lanc[] = [];
      for (const p of parcelar(valor, n, data)) {
        // Cartão: fica em aberto até pagar a fatura (vence com ela). Data futura ou "vou pagar": em aberto.
        const emAberto = !!cartao || a.pago === false || p.data > ctx.hoje;
        const vence = cartao ? faturaDaCompra(cartao, p.data).vencimento : emAberto ? p.data : null;
        const l = await inserir(ctx, {
          kind: tipo, amount_cents: p.valor, account_id: conta?.id ?? null, occurred_on: p.data,
          category: categoria(a.categoria), description: descricao, paid: !emAberto, due_on: vence,
          installment_group: grupo, installment_no: n > 1 ? p.no : null, installment_total: n > 1 ? n : null,
        }, 'financas_registrar_lancamento');
        if (l) feitos.push(l);
      }
      if (!feitos.length) return erro('financas_registrar_lancamento', 'Não consegui registrar.');
      const p1 = feitos[0]!;
      const quando = n > 1
        ? `${n}x de ${reais(feitos[feitos.length - 1]!.amount_cents)}${p1.amount_cents !== feitos[feitos.length - 1]!.amount_cents ? ` (a 1ª de ${reais(p1.amount_cents)})` : ''}, de ${dataHumana(p1.occurred_on, ctx.hoje)} a ${dataHumana(feitos[feitos.length - 1]!.occurred_on, ctx.hoje)}`
        : dataHumana(p1.occurred_on, ctx.hoje);
      const fatura = cartao ? ` · fatura que vence ${dataHumana(p1.due_on!, ctx.hoje)}` : !p1.paid ? ' · em aberto' : '';
      return ok('financas_registrar_lancamento', `${tipo} ${reais(valor)} "${descricao}"`,
        `${tipo === 'receita' ? 'Receita' : 'Despesa'} registrada: **${reais(valor)}** ${descricao} · ${quando}${p1.category ? ` · ${p1.category}` : ''}${conta ? ` · ${conta.name}` : ''}${fatura}.`,
        {}, feitos.map((l) => l.id));
    },

    async financas_registrar_transferencia(ctx, a) {
      const valor = centavos(a.valor);
      if (!valor) return erro('financas_registrar_transferencia', 'Qual foi o valor?');
      const cs = await contas(ctx.sb);
      const de = acharConta(cs, a.de);
      const para = acharConta(cs, a.para);
      if (typeof de === 'string') return erro('financas_registrar_transferencia', de);
      if (typeof para === 'string') return erro('financas_registrar_transferencia', para);
      if (!de || !para) return erro('financas_registrar_transferencia', 'De qual conta para qual?');
      const data = resolverQuando(a, ctx.hoje) ?? ctx.hoje;
      const l = await inserir(ctx, {
        kind: 'transferencia', amount_cents: valor, account_id: de.id, to_account_id: para.id, occurred_on: data,
        description: `Transferência ${de.name} → ${para.name}`, paid: data <= ctx.hoje, due_on: data > ctx.hoje ? data : null,
      }, 'financas_registrar_transferencia');
      if (!l) return erro('financas_registrar_transferencia', 'Não consegui registrar.');
      return ok('financas_registrar_transferencia', `transferência ${reais(valor)}`,
        `Transferência registrada: **${reais(valor)}** de ${de.name} para ${para.name} · ${dataHumana(data, ctx.hoje)}.`, {}, [l.id]);
    },

    async financas_registrar_fixa(ctx, a) {
      const descricao = String(a.descricao ?? '').trim().slice(0, 200);
      if (!descricao) return erro('financas_registrar_fixa', 'Qual é a conta fixa?');
      const fs = await fixas(ctx.sb);
      const existe = fs.find((f) => normalizar(f.description) === normalizar(descricao));
      const valor = a.valor !== undefined ? centavos(a.valor) : null;
      const dia = Number(a.dia_mes);
      const diaOk = Number.isInteger(dia) && dia >= 1 && dia <= 31;
      const cs = await contas(ctx.sb);
      const conta = acharConta(cs, a.conta);
      if (typeof conta === 'string') return erro('financas_registrar_fixa', conta);
      if (existe) {
        // Já existe: muda (com recibo para desfazer).
        const m: Record<string, unknown> = {};
        if (valor) m.amount_cents = valor;
        if (diaOk) m.day_of_month = dia;
        if (conta) m.account_id = conta.id;
        if (a.categoria) m.category = categoria(a.categoria);
        if (typeof a.ate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.ate)) m.until = a.ate;
        if (!Object.keys(m).length) return erro('financas_registrar_fixa', `A conta fixa **${existe.description}** já existe. O que devo mudar?`);
        const nova = await mudar(ctx, 'fin_recurring', existe, m, 'financas_registrar_fixa') as FixaFin | null;
        if (!nova) return erro('financas_registrar_fixa', 'Não consegui salvar a mudança.');
        return ok('financas_registrar_fixa', `fixa "${descricao}" mudada`,
          `Conta fixa **${nova.description}** agora: ${reais(nova.amount_cents)} todo dia ${nova.day_of_month}. Se mudar de ideia, diga "desfaz".`, {}, [nova.id]);
      }
      if (!valor) return erro('financas_registrar_fixa', 'Qual é o valor da conta fixa?');
      if (!diaOk) return erro('financas_registrar_fixa', 'Em que dia do mês ela vence?');
      const { data, error } = await ctx.sb.from('fin_recurring').insert({
        description: descricao, kind: a.tipo === 'receita' ? 'receita' : 'despesa', amount_cents: valor, day_of_month: dia,
        account_id: conta?.id ?? null, category: categoria(a.categoria) ?? 'Contas',
        until: typeof a.ate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.ate) ? a.ate : null,
      }).select('*').single();
      if (error) return erro('financas_registrar_fixa', `Não consegui criar (${error.message}).`);
      await recibo(ctx.sb, 'financas_registrar_fixa', null, data, 'fin_recurring');
      return ok('financas_registrar_fixa', `fixa "${descricao}"`,
        `Conta fixa criada: **${descricao}** · ${reais(valor)} todo dia ${dia}. Aviso 2 dias antes e no dia; quando pagar, diga "paguei ${descricao.toLowerCase()}".`, {}, [data.id]);
    },

    async financas_marcar_pago(ctx, a) {
      const cs = await contas(ctx.sb);
      const origem = acharConta(cs, a.conta);
      if (typeof origem === 'string') return erro('financas_marcar_pago', origem);
      // Fatura do cartão: marca as compras dela e registra o pagamento como transferência.
      if (a.fatura) {
        const cartao = acharConta(cs.filter((c) => c.kind === 'cartao'), a.fatura);
        if (typeof cartao === 'string' || !cartao) return erro('financas_marcar_pago', typeof cartao === 'string' ? cartao : 'De qual cartão?');
        const abertas = (await lancamentos(ctx.sb)).filter((l) => l.account_id === cartao.id && !l.paid && l.kind === 'despesa' && l.due_on);
        if (!abertas.length) return ok('financas_marcar_pago', '0', `A fatura do **${cartao.name}** não tem nada em aberto.`);
        const vence = abertas.map((l) => l.due_on!).sort()[0]!;
        const daFatura = abertas.filter((l) => l.due_on === vence);
        const total = daFatura.reduce((s, l) => s + l.amount_cents, 0);
        for (const l of daFatura) await mudar(ctx, 'fin_transactions', l, { paid: true }, 'financas_marcar_pago');
        const pagadora = origem ?? (cs.filter((c) => c.kind === 'conta').length === 1 ? cs.find((c) => c.kind === 'conta')! : null);
        if (pagadora) {
          await inserir(ctx, {
            kind: 'transferencia', amount_cents: total, account_id: pagadora.id, to_account_id: cartao.id, occurred_on: ctx.hoje,
            description: `Fatura ${cartao.name}`, paid: true,
          }, 'financas_marcar_pago');
        }
        return ok('financas_marcar_pago', `fatura ${cartao.name} paga`,
          `Fatura do **${cartao.name}** (vencimento ${dataHumana(vence, ctx.hoje)}) paga: **${reais(total)}**, ${daFatura.length} compra${daFatura.length > 1 ? 's' : ''}${pagadora ? `, saiu de ${pagadora.name}` : ' (diga de qual conta saiu para eu descontar o saldo)'}. Se mudar de ideia, diga "desfaz".`,
          { total }, daFatura.map((l) => l.id));
      }
      // Lançamentos em aberto, ou a conta fixa do mês (vira lançamento pago).
      const refs = (Array.isArray(a.refs) ? a.refs : [a.refs ?? a.ref]).map(String).filter((s) => s && s !== 'undefined');
      if (!refs.length) return erro('financas_marcar_pago', 'O que foi pago?');
      const ls = await lancamentos(ctx.sb, somarMeses(ctx.hoje, -3), somarMeses(ctx.hoje, 2));
      const fs = await fixas(ctx.sb);
      const feitos: string[] = [];
      const avisos: string[] = [];
      const ids: string[] = [];
      for (const ref of refs.slice(0, 20)) {
        const { achados } = acharLancamentos(ls, [ref], true);
        const l = achados[0];
        if (l) {
          await mudar(ctx, 'fin_transactions', l, { paid: true }, 'financas_marcar_pago');
          feitos.push(`**${l.description}** (${reais(l.amount_cents)})`);
          ids.push(l.id);
          continue;
        }
        const f = fs.filter((x) => x.active).map((x) => [x, pontuar(ref, `${x.description} ${x.category ?? ''}`)] as const)
          .filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1])[0]?.[0];
        if (!f) {
          avisos.push(`Não achei conta em aberto para "${ref}".`);
          continue;
        }
        const mes = mesDe(ctx.hoje);
        if (ls.some((x) => x.recurring_id === f.id && mesDe(x.occurred_on) === mes)) {
          avisos.push(`**${f.description}** deste mês já está registrada.`);
          continue;
        }
        const novo = await inserir(ctx, {
          kind: f.kind, amount_cents: f.amount_cents, account_id: origem?.id ?? f.account_id, occurred_on: ctx.hoje,
          category: f.category, description: f.description, paid: true, recurring_id: f.id,
        }, 'financas_marcar_pago');
        if (novo) {
          feitos.push(`**${f.description}** (${reais(f.amount_cents)})`);
          ids.push(novo.id);
        }
      }
      if (!feitos.length) return erro('financas_marcar_pago', avisos.join(NL) || 'Não achei o que marcar.');
      return ok('financas_marcar_pago', `${feitos.length} pagos`,
        `Pago: ${feitos.join(', ')}. Se mudar de ideia, diga "desfaz".${avisos.length ? NL + NL + avisos.join(NL) : ''}`, {}, ids);
    },

    async financas_corrigir_lancamento(ctx, a) {
      const ls = await lancamentos(ctx.sb, somarMeses(ctx.hoje, -6));
      const { achados, aviso } = acharLancamentos(ls, [a.ref], false);
      const l = achados[0];
      if (!l) return erro('financas_corrigir_lancamento', aviso || 'Qual lançamento?');
      const m: Record<string, unknown> = {};
      const v = a.valor !== undefined ? centavos(a.valor) : null;
      if (v) m.amount_cents = v;
      if (typeof a.descricao === 'string' && a.descricao.trim()) m.description = a.descricao.trim().slice(0, 200);
      if (a.categoria) m.category = categoria(a.categoria);
      if (a.conta) {
        const conta = acharConta(await contas(ctx.sb), a.conta);
        if (typeof conta === 'string') return erro('financas_corrigir_lancamento', conta);
        if (conta) m.account_id = conta.id;
      }
      const d = resolverQuando(a, ctx.hoje);
      if (d) m.occurred_on = d;
      if (!Object.keys(m).length) return erro('financas_corrigir_lancamento', `O que devo mudar em **${l.description}**?`);
      const nova = await mudar(ctx, 'fin_transactions', l, m, 'financas_corrigir_lancamento') as Lanc | null;
      if (!nova) return erro('financas_corrigir_lancamento', 'Não consegui salvar a mudança.');
      return ok('financas_corrigir_lancamento', `corrigido "${nova.description}"`,
        `Corrigido: ${linhaLanc(nova, await contas(ctx.sb), ctx.hoje).slice(2)}. Se mudar de ideia, diga "desfaz".`, {}, [nova.id]);
    },

    async financas_apagar(ctx, a) {
      const ls = await lancamentos(ctx.sb, somarMeses(ctx.hoje, -6));
      const fs = await fixas(ctx.sb);
      const refs = (Array.isArray(a.refs) ? a.refs : [a.refs ?? a.ref]).map(String).filter((s) => s && s !== 'undefined').slice(0, 20);
      const alvo: { id: string; title: string }[] = [];
      const avisos: string[] = [];
      for (const ref of refs) {
        // "a conta fixa do aluguel" -> a fixa; senão o lançamento mais recente que bate.
        const querFixa = /fix|todo mes|mensal/.test(normalizar(ref));
        const f = fs.map((x) => [x, pontuar(ref.replace(/conta fixa|fixa/gi, ''), x.description)] as const).filter(([, n]) => n > 0)
          .sort((x, y) => y[1] - x[1])[0]?.[0];
        const { achados } = acharLancamentos(ls, [ref], false);
        const l = achados[0];
        if (f && (querFixa || !l)) alvo.push({ id: f.id, title: `conta fixa ${f.description} (${reais(f.amount_cents)} todo dia ${f.day_of_month})` });
        else if (l) alvo.push({ id: l.id, title: `${l.description} · ${reais(l.amount_cents)} · ${dataHumana(l.occurred_on, ctx.hoje)}` });
        else avisos.push(`Não achei "${ref}".`);
      }
      if (!alvo.length) return erro('financas_apagar', avisos.join(NL) || 'O que devo apagar?');
      const c = await pedirConfirmacao(ctx.sb, 'financas_apagar', alvo, alvo.length === 1 ? 'apagar este lançamento' : `apagar ${alvo.length} itens das finanças`);
      return { ...c, fatos: { ...c.fatos, financas: true }, texto: c.texto + (avisos.length ? NL + NL + avisos.join(NL) : '') };
    },

    async financas_ver_mes(ctx, a) {
      const mes = mesPedido(a, ctx.hoje);
      const de = `${mes}-01`;
      const fimDoMes = somarMeses(de, 0, 31); // último dia (fevereiro = 28/29)
      const [ls, fs, cs] = await Promise.all([lancamentos(ctx.sb, somarMeses(de, -1), fimDoMes), fixas(ctx.sb), contas(ctx.sb)]);
      const r = resumoMes(ls, mes);
      // O que ainda não foi pago no mês (inclui o que já venceu e ficou para trás).
      const pendentes = aVencer(ls, fs, de, fimDoMes);
      const nomeMes = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const linhas = [
        `**Finanças de ${nomeMes}**`,
        `- Receitas: **${reais(r.receitas)}**`,
        `- Despesas: **${reais(r.despesas)}**`,
        `- Saldo do mês: **${reais(r.saldo)}**`,
      ];
      if (r.categorias.length) linhas.push('', '**Onde foi o dinheiro:**', ...r.categorias.slice(0, 8).map((c) => `- ${c.categoria}: ${reais(c.total)}`));
      if (pendentes.length) {
        linhas.push('', '**Ainda a pagar/receber no mês:**',
          ...pendentes.slice(0, 12).map((p) => `- ${p.kind === 'receita' ? '+' : '−'} ${reais(p.valor)} ${p.descricao} · ${dataHumana(p.vence, ctx.hoje)}${p.tipo === 'fixa' ? ' (fixa)' : ''}`));
      }
      if (!ls.some((l) => mesDe(l.occurred_on) === mes) && !pendentes.length) {
        linhas.push('', cs.length ? 'Nada lançado neste mês ainda.' : 'Ainda não há nada nas finanças. Comece dizendo, por exemplo, "gastei 45 no mercado" ou "cria a conta Nubank com 1.200".');
      }
      return ok('financas_ver_mes', `resumo ${mes}`, linhas.join(NL), { mes, ...r });
    },

    async financas_ver_saldos(ctx) {
      const [cs, ls] = await Promise.all([contas(ctx.sb), lancamentos(ctx.sb)]);
      if (!cs.length) return ok('financas_ver_saldos', '0 contas', 'Ainda não há contas. Diga, por exemplo, "cria a conta Nubank com 1.200" ou "cria o cartão Inter, fecha dia 5 e vence dia 12".');
      const linhas = cs.map((c) => {
        const s = saldo(c, ls);
        return c.kind === 'cartao'
          ? `- 💳 **${c.name}**: ${s < 0 ? `deve ${reais(-s)}` : reais(s)}`
          : `- ${c.kind === 'carteira' ? '👛' : '🏦'} **${c.name}**: ${reais(s)}`;
      });
      const total = cs.filter((c) => c.kind !== 'cartao').reduce((t, c) => t + saldo(c, ls), 0);
      return ok('financas_ver_saldos', `${cs.length} contas`, `**Saldos:**${NL}${linhas.join(NL)}${NL}${NL}Em contas e carteira: **${reais(total)}**.`, { total });
    },

    async financas_ver_fatura(ctx, a) {
      const cs = await contas(ctx.sb);
      const cartoes = cs.filter((c) => c.kind === 'cartao');
      if (!cartoes.length) return ok('financas_ver_fatura', '0', 'Ainda não há cartão cadastrado. Diga "cria o cartão X, fecha dia 5 e vence dia 12".');
      const c = a.cartao ? acharConta(cartoes, a.cartao) : cartoes.length === 1 ? cartoes[0]! : null;
      if (typeof c === 'string') return erro('financas_ver_fatura', c);
      if (!c) return erro('financas_ver_fatura', `De qual cartão? ${cartoes.map((x) => `**${x.name}**`).join(', ')}.`);
      const mes = typeof a.mes === 'string' && /^\d{4}-\d{2}$/.test(a.mes) ? a.mes : faturaDaCompra(c, ctx.hoje).mes;
      const p = periodoDaFatura(c, mes);
      const ls = (await lancamentos(ctx.sb, p.de, p.ate)).filter((l) => l.account_id === c.id && l.kind === 'despesa' && l.occurred_on < p.ate);
      const total = ls.reduce((s, l) => s + l.amount_cents, 0);
      const paga = ls.length > 0 && ls.every((l) => l.paid);
      return ok('financas_ver_fatura', `fatura ${c.name} ${mes}`,
        `**Fatura ${c.name}** · vence ${dataHumana(p.vencimento, ctx.hoje)} · **${reais(total)}**${paga ? ' · paga' : ''}${NL}${ls.length ? ls.slice(0, 30).map((l) => linhaLanc(l, cs, ctx.hoje)).join(NL) : '(sem compras nesta fatura)'}`,
        { total, vencimento: p.vencimento }, ls.map((l) => l.id));
    },

    async financas_ver_lancamentos(ctx, a) {
      const mes = a.mes ? mesPedido(a, ctx.hoje) : null;
      const de = mes ? `${mes}-01` : somarMeses(ctx.hoje, -3);
      const ate = mes ? somarMeses(`${mes}-01`, 1, 1) : somarMeses(ctx.hoje, 2);
      const [ls, cs] = await Promise.all([lancamentos(ctx.sb, de, ate), contas(ctx.sb)]);
      let lista = ls.filter((l) => !mes || mesDe(l.occurred_on) === mes);
      if (a.termo) lista = lista.filter((l) => pontuar(String(a.termo), `${l.description} ${l.category ?? ''}`) > 0);
      if (a.categoria) lista = lista.filter((l) => normalizar(l.category ?? '') === normalizar(String(a.categoria)));
      if (!lista.length) return ok('financas_ver_lancamentos', '0', 'Não achei lançamentos com isso.');
      const gasto = lista.filter((l) => l.kind === 'despesa').reduce((s, l) => s + l.amount_cents, 0);
      const recebido = lista.filter((l) => l.kind === 'receita').reduce((s, l) => s + l.amount_cents, 0);
      const total = [gasto ? `gasto **${reais(gasto)}**` : '', recebido ? `recebido **${reais(recebido)}**` : ''].filter(Boolean).join(', ');
      return ok('financas_ver_lancamentos', `${lista.length} lançamentos`,
        `${lista.length} lançamento${lista.length > 1 ? 's' : ''}${total ? ` · ${total}` : ''}:${NL}${lista.slice(0, 25).map((l) => linhaLanc(l, cs, ctx.hoje)).join(NL)}`,
        { gasto, recebido }, lista.map((l) => l.id));
    },
  },

  confirmar: {
    async financas_apagar(ctx, ids) {
      const agora = new Date().toISOString();
      const apagados: string[] = [];
      for (const tabela of ['fin_transactions', 'fin_recurring']) {
        const { data } = await ctx.sb.from(tabela).select('*').in('id', ids).is('deleted_at', null);
        for (const linha of data ?? []) {
          const nova = await mudar(ctx, tabela, linha, tabela === 'fin_recurring' ? { deleted_at: agora, active: false } : { deleted_at: agora }, 'financas_apagar');
          if (nova) apagados.push(linha.description);
        }
      }
      if (!apagados.length) return erro('jarvis_confirmar', 'Esses itens não existem mais.');
      return ok('jarvis_confirmar', `${apagados.length} apagados`,
        `Apagado${apagados.length > 1 ? 's' : ''}: ${apagados.map((d) => `**${d}**`).join(', ')}. Se mudar de ideia, diga "desfaz".`, { acao: 'financas_apagar' });
    },
  },
});
