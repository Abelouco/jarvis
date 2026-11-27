// Finanças no app (Fase 4 · etapa 6): lê e escreve direto no Supabase (como os avisos; nada no banco local).
// Toda escrita grava recibo em `undo_receipts`, então "desfaz" na conversa também alcança o que foi feito pela tela.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  aVencer, faturaDaCompra, mesDe, parcelar, resumoMes, saldo, somarMeses,
  type ContaFin, type FixaFin, type LancamentoFin,
} from './financas';

export type Lancamento = LancamentoFin & { installment_no: number | null; installment_total: number | null };
export type Fixa = FixaFin & { created_at: string };

const CAMPOS_L = 'id, kind, amount_cents, account_id, to_account_id, occurred_on, paid, due_on, category, description, recurring_id, installment_no, installment_total';
const CAMPOS_C = 'id, name, kind, opening_balance_cents, closing_day, due_day';
const CAMPOS_F = 'id, description, kind, amount_cents, day_of_month, active, until, account_id, category, created_at';

export interface NovoLancamento {
  kind: 'despesa' | 'receita';
  amount_cents: number;
  description: string;
  category?: string | null;
  account_id?: string | null;
  occurred_on: string;
  /** false = a pagar (boleto, conta que ainda vence). */
  paid?: boolean;
  parcelas?: number;
}

export interface PainelFinancas {
  mes: string;
  contas: (ContaFin & { saldo: number })[];
  resumo: ReturnType<typeof resumoMes>;
  aVencer: ReturnType<typeof aVencer>;
  recentes: Lancamento[];
  fixas: Fixa[];
}

export function criarFinancas(sb: SupabaseClient, hoje: () => string) {
  const falhou = (e: { message: string } | null) => {
    if (e) throw new Error(e.message);
  };
  const recibo = async (action: string, tabela: string, antes: { id: string } | null, depois: { id: string } | null) => {
    await sb.from('undo_receipts').insert({ action, entity_type: tabela, entity_id: (depois ?? antes)?.id, before: antes, after: depois });
  };
  const mudar = async (tabela: string, id: string, m: Record<string, unknown>, acao: string) => {
    const { data: antes, error: e1 } = await sb.from(tabela).select('*').eq('id', id).single();
    falhou(e1);
    const { data, error } = await sb.from(tabela).update(m).eq('id', id).select('*').single();
    falhou(error);
    await recibo(acao, tabela, antes, data);
  };

  const api = {
    async contas(): Promise<ContaFin[]> {
      const { data, error } = await sb.from('fin_accounts').select(CAMPOS_C).is('deleted_at', null).eq('archived', false).order('created_at');
      falhou(error);
      return (data ?? []) as ContaFin[];
    },

    async fixas(): Promise<Fixa[]> {
      const { data, error } = await sb.from('fin_recurring').select(CAMPOS_F).is('deleted_at', null).order('day_of_month');
      falhou(error);
      return (data ?? []) as Fixa[];
    },

    async lancamentos(de?: string, ate?: string): Promise<Lancamento[]> {
      let q = sb.from('fin_transactions').select(CAMPOS_L).is('deleted_at', null);
      if (de) q = q.gte('occurred_on', de);
      if (ate) q = q.lte('occurred_on', ate);
      const { data, error } = await q.order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(2000);
      falhou(error);
      return (data ?? []) as Lancamento[];
    },

    /** Tudo o que a aba mostra de um mês ("AAAA-MM"; padrão: o atual). Sem internet: lança erro. */
    async painel(mes = mesDe(hoje())): Promise<PainelFinancas> {
      const de = `${mes}-01`;
      const fim = somarMeses(de, 0, 31);
      const [contas, fixas, todos] = await Promise.all([api.contas(), api.fixas(), api.lancamentos()]);
      const doMes = todos.filter((l) => mesDe(l.occurred_on) === mes);
      return {
        mes,
        contas: contas.map((c) => ({ ...c, saldo: saldo(c, todos) })),
        resumo: resumoMes(doMes, mes),
        aVencer: aVencer(todos, fixas, de, fim),
        recentes: doMes.slice(0, 60),
        fixas,
      };
    },

    /** Despesa ou receita; parcelada vira uma por mês. No cartão fica em aberto até pagar a fatura. */
    async registrar(n: NovoLancamento): Promise<void> {
      const contas = n.account_id ? await api.contas() : [];
      const cartao = contas.find((c) => c.id === n.account_id && c.kind === 'cartao') ?? null;
      const q = Math.max(1, Math.min(n.parcelas ?? 1, 72));
      const grupo = q > 1 ? crypto.randomUUID() : null;
      for (const p of parcelar(n.amount_cents, q, n.occurred_on)) {
        const emAberto = !!cartao || n.paid === false || p.data > hoje();
        const { data, error } = await sb.from('fin_transactions').insert({
          kind: n.kind, amount_cents: p.valor, description: n.description.trim().slice(0, 200), category: n.category?.trim() || null,
          account_id: n.account_id ?? null, occurred_on: p.data, paid: !emAberto,
          due_on: cartao ? faturaDaCompra(cartao, p.data).vencimento : emAberto ? p.data : null,
          installment_group: grupo, installment_no: q > 1 ? p.no : null, installment_total: q > 1 ? q : null,
        }).select(CAMPOS_L).single();
        falhou(error);
        await recibo('financas_registrar_lancamento', 'fin_transactions', null, data as Lancamento);
      }
    },

    async marcarPago(id: string, pago = true) {
      await mudar('fin_transactions', id, { paid: pago }, 'financas_marcar_pago');
    },

    /** Conta fixa do mês paga: vira um lançamento pago ligado a ela. */
    async pagarFixa(f: Fixa) {
      const { data, error } = await sb.from('fin_transactions').insert({
        kind: f.kind, amount_cents: f.amount_cents, description: f.description, category: f.category,
        account_id: f.account_id, occurred_on: hoje(), paid: true, recurring_id: f.id,
      }).select(CAMPOS_L).single();
      falhou(error);
      await recibo('financas_marcar_pago', 'fin_transactions', null, data as Lancamento);
    },

    async apagarLancamento(id: string) {
      await mudar('fin_transactions', id, { deleted_at: new Date().toISOString() }, 'financas_apagar');
    },

    async salvarConta(c: { id?: string; name: string; kind: ContaFin['kind']; opening_balance_cents?: number; closing_day?: number | null; due_day?: number | null }) {
      const linha = {
        name: c.name.trim().slice(0, 80), kind: c.kind, opening_balance_cents: c.opening_balance_cents ?? 0,
        closing_day: c.kind === 'cartao' ? c.closing_day ?? null : null, due_day: c.kind === 'cartao' ? c.due_day ?? null : null,
      };
      if (c.id) return mudar('fin_accounts', c.id, linha, 'financas_salvar_conta_ou_cartao');
      const { data, error } = await sb.from('fin_accounts').insert(linha).select(CAMPOS_C).single();
      falhou(error);
      await recibo('financas_salvar_conta_ou_cartao', 'fin_accounts', null, data as ContaFin);
    },

    async apagarConta(id: string) {
      await mudar('fin_accounts', id, { deleted_at: new Date().toISOString() }, 'financas_apagar');
    },

    async salvarFixa(f: { description: string; amount_cents: number; day_of_month: number; kind?: 'despesa' | 'receita'; account_id?: string | null; category?: string | null }) {
      const { data, error } = await sb.from('fin_recurring').insert({
        description: f.description.trim().slice(0, 200), amount_cents: f.amount_cents, day_of_month: f.day_of_month,
        kind: f.kind ?? 'despesa', account_id: f.account_id ?? null, category: f.category?.trim() || 'Contas',
      }).select(CAMPOS_F).single();
      falhou(error);
      await recibo('financas_registrar_fixa', 'fin_recurring', null, data as Fixa);
    },

    async apagarFixa(id: string) {
      await mudar('fin_recurring', id, { deleted_at: new Date().toISOString(), active: false }, 'financas_apagar');
    },
  };
  return api;
}
