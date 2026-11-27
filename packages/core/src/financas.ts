// Regras puras de finanças (Fase 4 · etapa 6), usadas pelo app. Sem banco, sem rede.
// Cópias idênticas (menos estas 2 linhas) em ia_conversar/ e avisos_vigia/, conferidas por teste.
// Dinheiro sempre em centavos inteiros; datas AAAA-MM-DD no fuso de São Paulo.

export interface ContaFin {
  id: string;
  name: string;
  kind: 'conta' | 'cartao' | 'carteira';
  opening_balance_cents: number;
  closing_day: number | null;
  due_day: number | null;
}

export interface LancamentoFin {
  id: string;
  kind: 'despesa' | 'receita' | 'transferencia';
  amount_cents: number;
  account_id: string | null;
  to_account_id: string | null;
  occurred_on: string;
  paid: boolean;
  due_on: string | null;
  category: string | null;
  description: string;
  recurring_id: string | null;
}

export interface FixaFin {
  id: string;
  description: string;
  kind: 'despesa' | 'receita';
  amount_cents: number;
  day_of_month: number;
  active: boolean;
  until: string | null;
  account_id: string | null;
  category: string | null;
}

/** "R$ 1.234,56" / "45,90" / "45.9" / "1.200" / 30 -> centavos. null = não é valor. */
export function centavos(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase().replace(/r\$|reais?|\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const virgula = s.lastIndexOf(',');
  const ponto = s.lastIndexOf('.');
  if (virgula > ponto) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else if (ponto > -1 && s.length - ponto - 1 === 3 && virgula === -1) s = s.replace(/\./g, ''); // 1.200 (milhar)
  else s = s.replace(/,/g, ''); // 1,234.56 ou 45.9
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** 123456 -> "R$ 1.234,56" (negativo com sinal). */
export function reais(c: number): string {
  const neg = c < 0;
  const abs = Math.abs(Math.round(c));
  const inteiro = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${inteiro},${String(abs % 100).padStart(2, '0')}`;
}

const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const doisDig = (n: number) => String(n).padStart(2, '0');

/** Dia do mês, sem passar do último dia ("dia 31" em fevereiro = 28/29). mes = 1..12. */
export function diaNoMes(ano: number, mes: number, dia: number): string {
  return `${ano}-${doisDig(mes)}-${doisDig(Math.min(dia, ultimoDia(ano, mes)))}`;
}

/** Soma meses a uma data, mantendo o dia (ou o último dia do mês). */
export function somarMeses(data: string, n: number, dia?: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) + n;
  return diaNoMes(Math.floor(total / 12), (total % 12) + 1, dia ?? d);
}

export const mesDe = (data: string) => data.slice(0, 7);

/** Vencimento da conta fixa num mês ("AAAA-MM"), ou null se ela não vale nesse mês. */
export function vencimentoFixa(f: Pick<FixaFin, 'day_of_month' | 'active' | 'until'>, mes: string, criadaEm?: string): string | null {
  if (!f.active) return null;
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const d = diaNoMes(a, m, f.day_of_month);
  if (f.until && d > f.until) return null;
  if (criadaEm && mes < mesDe(criadaEm)) return null;
  return d;
}

/**
 * Fatura do cartão onde cai uma compra. Compra no dia do fechamento ou depois vai para a próxima.
 * Devolve o fechamento, o vencimento e a "fatura de" (mês do vencimento).
 */
export function faturaDaCompra(cartao: Pick<ContaFin, 'closing_day' | 'due_day'>, data: string) {
  const fecha = cartao.closing_day ?? 1;
  const vence = cartao.due_day ?? fecha;
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  let fechamento = diaNoMes(a, m, fecha);
  if (d >= Math.min(fecha, ultimoDia(a, m))) fechamento = somarMeses(`${a}-${doisDig(m)}-01`, 1, fecha);
  // Vencimento depois do fechamento: no mesmo mês se o dia vem depois; senão, no mês seguinte.
  const vencimento = vence > fecha ? somarMeses(fechamento, 0, vence) : somarMeses(fechamento, 1, vence);
  return { fechamento, vencimento, mes: mesDe(vencimento) };
}

/** Período de compras de uma fatura (a que vence no mês "AAAA-MM"): [de, ate). */
export function periodoDaFatura(cartao: Pick<ContaFin, 'closing_day' | 'due_day'>, mesVencimento: string) {
  const fecha = cartao.closing_day ?? 1;
  const vence = cartao.due_day ?? fecha;
  const vencimento = somarMeses(`${mesVencimento}-01`, 0, vence);
  const fechamento = vence > fecha ? somarMeses(vencimento, 0, fecha) : somarMeses(vencimento, -1, fecha);
  return { de: somarMeses(fechamento, -1, fecha), ate: fechamento, vencimento };
}

/** Parcelas: o resto dos centavos vai na primeira; uma por mês a partir da data. */
export function parcelar(totalCentavos: number, n: number, primeira: string): { no: number; valor: number; data: string }[] {
  const q = Math.max(1, Math.min(Math.floor(n), 72));
  const base = Math.floor(totalCentavos / q);
  const resto = totalCentavos - base * q;
  const dia = Number(primeira.slice(8, 10));
  return Array.from({ length: q }, (_, i) => ({ no: i + 1, valor: base + (i === 0 ? resto : 0), data: somarMeses(primeira, i, dia) }));
}

/**
 * Saldo de uma conta. Na conta e na carteira só conta o que foi pago; no cartão toda compra pesa
 * (o saldo negativo é o que se deve) e o pagamento da fatura entra como transferência.
 */
export function saldo(conta: ContaFin, lancs: LancamentoFin[], ate?: string): number {
  let s = conta.opening_balance_cents;
  for (const l of lancs) {
    if (ate && l.occurred_on > ate) continue;
    const vale = l.paid || conta.kind === 'cartao';
    if (l.kind === 'transferencia') {
      if (l.account_id === conta.id && vale) s -= l.amount_cents;
      if (l.to_account_id === conta.id && vale) s += l.amount_cents;
    } else if (l.account_id === conta.id && vale) {
      s += l.kind === 'receita' ? l.amount_cents : -l.amount_cents;
    }
  }
  return s;
}

/** Resumo de um mês: receitas, despesas (sem transferências), por categoria (maior primeiro). */
export function resumoMes(lancs: LancamentoFin[], mes: string) {
  let receitas = 0;
  let despesas = 0;
  const porCategoria = new Map<string, number>();
  for (const l of lancs) {
    if (mesDe(l.occurred_on) !== mes || l.kind === 'transferencia') continue;
    if (l.kind === 'receita') receitas += l.amount_cents;
    else {
      despesas += l.amount_cents;
      const c = l.category?.trim() || 'Outros';
      porCategoria.set(c, (porCategoria.get(c) ?? 0) + l.amount_cents);
    }
  }
  return {
    receitas, despesas, saldo: receitas - despesas,
    categorias: [...porCategoria.entries()].sort((a, b) => b[1] - a[1]).map(([categoria, total]) => ({ categoria, total })),
  };
}

/**
 * O que vence num período: lançamentos não pagos com vencimento e contas fixas do mês ainda sem
 * lançamento. Ordenado pela data.
 */
export function aVencer(lancs: LancamentoFin[], fixas: FixaFin[], de: string, ate: string) {
  const itens: { tipo: 'lancamento' | 'fixa'; id: string; descricao: string; valor: number; vence: string; kind: 'despesa' | 'receita' }[] = [];
  for (const l of lancs) {
    const vence = l.due_on ?? (l.paid ? null : l.occurred_on);
    if (l.paid || !vence || vence < de || vence > ate || l.kind === 'transferencia') continue;
    itens.push({ tipo: 'lancamento', id: l.id, descricao: l.description, valor: l.amount_cents, vence, kind: l.kind });
  }
  const meses = new Set([mesDe(de), mesDe(ate)]);
  for (const f of fixas) {
    for (const mes of meses) {
      const vence = vencimentoFixa(f, mes);
      if (!vence || vence < de || vence > ate) continue;
      const lancada = lancs.some((l) => l.recurring_id === f.id && mesDe(l.occurred_on) === mes);
      if (!lancada) itens.push({ tipo: 'fixa', id: f.id, descricao: f.description, valor: f.amount_cents, vence, kind: f.kind });
    }
  }
  return itens.sort((a, b) => a.vence.localeCompare(b.vence));
}
