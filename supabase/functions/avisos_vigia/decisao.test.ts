// Testes das regras do vigia de avisos. Rodar: node --test supabase/functions/avisos_vigia/decisao.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decidir, detectarAtrasadas, detectarDiario, detectarLembretes, detectarPrazos, detectarSequencias, emSilencio, escolherCanais, fimDoSilencio,
  habitosDoDia, horaDoResumo, juntar, proximaHora, resumoManha, resumoNaHora, resumoNoite, textoPush, vencimento,
  type Candidato, type Regra,
} from './decisao.ts';

const P = { quiet_start: '22:00:00', quiet_end: '07:00:00' };
const em = (iso: string) => new Date(iso);
const cand = (o: Partial<Candidato> = {}): Candidato => ({
  kind: 'tarefa_atrasada', entity_type: 'tasks', entity_id: 't1', title: 'Pagar luz', body: '', reason: 'r',
  priority: 'normal', dedupe_key: 'k', ...o,
});

test('silêncio: atravessa a meia-noite', () => {
  assert.equal(emSilencio(em('2026-11-26T01:30:00Z'), P), true); // 22:30 SP
  assert.equal(emSilencio(em('2026-11-26T09:59:00Z'), P), true); // 06:59 SP
  assert.equal(emSilencio(em('2026-11-26T10:00:00Z'), P), false); // 07:00 SP
  assert.equal(emSilencio(em('2026-11-26T15:00:00Z'), { quiet_start: '13:00', quiet_end: '14:00' }), false);
  assert.equal(emSilencio(em('2026-11-26T16:30:00Z'), { quiet_start: '13:00', quiet_end: '14:00' }), true);
});

test('próxima hora: hoje se não passou, senão amanhã', () => {
  assert.equal(proximaHora('07:00', em('2026-11-26T01:30:00Z')).toISOString(), '2026-11-26T10:00:00.000Z');
  assert.equal(proximaHora('07:00', em('2026-11-26T12:00:00Z')).toISOString(), '2026-11-27T10:00:00.000Z');
});

test('decidir: silenciado > hora fixa > silêncio > enviar; urgente fura o silêncio', () => {
  const dia = em('2026-11-26T15:00:00Z'); // 12:00 SP
  const noite = em('2026-11-26T02:00:00Z'); // 23:00 SP
  assert.equal(decidir(cand(), P, [], dia).status, 'enviar');
  assert.equal(decidir(cand(), P, [], noite).status, 'segurado_silencio');
  assert.equal(decidir(cand(), P, [], noite).scheduled_for, '2026-11-26T10:00:00.000Z');
  assert.equal(decidir(cand({ priority: 'urgente' }), P, [], noite).status, 'enviar');

  const r = (o: Partial<Regra>): Regra => ({ kind: 'tarefa_atrasada', entity_id: null, active: true, fixed_time: null, muted_until: null, ...o });
  assert.equal(decidir(cand(), P, [r({ active: false })], dia).status, 'silenciado');
  assert.equal(decidir(cand(), P, [r({ entity_id: 't1', active: false })], dia).status, 'silenciado');
  assert.equal(decidir(cand({ entity_id: 't2' }), P, [r({ entity_id: 't1', active: false })], dia).status, 'enviar');
  assert.equal(decidir(cand(), P, [r({ muted_until: '2026-11-27T00:00:00Z' })], dia).status, 'silenciado');
  assert.equal(decidir(cand(), P, [r({ muted_until: '2026-11-25T00:00:00Z' })], dia).status, 'enviar');
  assert.equal(decidir(cand({ priority: 'urgente' }), P, [r({ active: false })], noite).status, 'silenciado');
  const fixa = decidir(cand(), P, [r({ fixed_time: '09:00:00' })], dia);
  assert.equal(fixa.status, 'agendado');
  assert.equal(fixa.scheduled_for, '2026-11-27T12:00:00.000Z');
  assert.equal(decidir(cand(), P, [r({ fixed_time: '12:00' })], dia).status, 'enviar');
});

test('tarefa atrasada: vence na hora ou no fim do dia, uma vez por prazo, só nas últimas 24 h', () => {
  assert.equal(vencimento({ due_date: '2026-11-26', due_time: '18:00:00' }).toISOString(), '2026-11-26T21:00:00.000Z');
  assert.equal(vencimento({ due_date: '2026-11-26', due_time: null }).toISOString(), '2026-11-27T03:00:00.000Z');
  const agora = em('2026-11-26T22:00:00Z'); // 19:00 SP
  const xs = detectarAtrasadas([
    { id: 'a', title: 'A', due_date: '2026-11-26', due_time: '18:00:00', priority: 'alta' },
    { id: 'b', title: 'B', due_date: '2026-11-26', due_time: null, priority: 'media' },
    { id: 'c', title: 'C', due_date: '2026-11-25', due_time: null, priority: 'media' },
    { id: 'd', title: 'D', due_date: '2026-11-24', due_time: null, priority: 'media' },
  ], agora);
  assert.deepEqual(xs.map((x) => x.entity_id), ['a', 'c']);
  assert.equal(xs[0]!.priority, 'urgente');
  assert.equal(xs[1]!.priority, 'normal');
  assert.equal(xs[0]!.dedupe_key, 'tarefa_atrasada:a:2026-11-26T18:00');
});

test('lembrete: só dos últimos 30 min; alarme ou alta = urgente', () => {
  const agora = em('2026-11-26T15:00:00Z');
  const xs = detectarLembretes([
    { id: 'a', title: 'Remédio', remind_at: '2026-11-26T14:59:00Z', priority: 'media', alarm: true },
    { id: 'b', title: 'Ligar', remind_at: '2026-11-26T14:00:00Z', priority: 'media', alarm: false },
    { id: 'c', title: 'Depois', remind_at: '2026-11-26T15:10:00Z', priority: 'media', alarm: false },
  ], agora);
  assert.deepEqual(xs.map((x) => x.entity_id), ['a']);
  assert.equal(xs[0]!.priority, 'urgente');
  assert.match(xs[0]!.reason, /11:59/);
});

test('juntar: mesmo tipo vira um; lembrete e urgente saem sozinhos; janela de 15 min adia', () => {
  const agora = em('2026-11-26T15:00:00Z');
  let n = 0;
  const id = () => `g${++n}`;
  const a = (i: string, kind = 'tarefa_atrasada', priority: 'normal' | 'urgente' = 'normal') => ({ id: i, kind, title: i, body: '', priority });
  const r = juntar([a('t1'), a('t2'), a('t3'), a('l1', 'lembrete_hora'), a('u1', 'tarefa_atrasada', 'urgente')], {}, agora, id);
  assert.equal(r.entregas.length, 3);
  const grupo = r.entregas.find((e) => e.grupoNovo)!;
  assert.equal(grupo.principal.title, '3 tarefas atrasaram');
  assert.deepEqual(grupo.filhos.map((f) => f.id), ['t1', 't2', 't3']);
  const adiado = juntar([a('t4')], { tarefa_atrasada: '2026-11-26T14:50:00Z' }, agora, id);
  assert.equal(adiado.entregas.length, 0);
  assert.deepEqual(adiado.adiar, [{ id: 't4', ate: '2026-11-26T15:05:00.000Z' }]);
  assert.equal(juntar([a('t5')], { tarefa_atrasada: '2026-11-26T14:40:00Z' }, agora, id).entregas.length, 1);
});

test('cópias do vigia iguais às do ia_conversar (sensível, hábitos, repetição)', () => {
  const ler = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r/g, '');
  for (const f of ['sensivel.ts', 'habitos_regras.ts', 'recorrencia.ts']) assert.equal(ler(`./${f}`), ler(`../ia_conversar/${f}`), f);
});

test('hábito: sequência de 3+ dias não feita hoje avisa a partir de 2 h antes do silêncio', () => {
  const h = { id: 'h1', name: 'Ler', paused: false, kind: 'boolean' as const, daily_target: null, weekdays: null, times_per_week: null };
  const reg = (dia: string) => ({ habit_id: 'h1', day: dia, value: 1 });
  const tres = [reg('2026-11-23'), reg('2026-11-24'), reg('2026-11-25')];
  const noite = em('2026-11-26T23:00:00Z'); // 20:00 SP
  const xs = detectarSequencias([h], tres, P, noite);
  assert.equal(xs.length, 1);
  assert.equal(xs[0]!.title, 'Ler: 3 dias seguidos');
  assert.equal(xs[0]!.dedupe_key, 'habito_sequencia:h1:2026-11-26');
  assert.equal(detectarSequencias([h], tres, P, em('2026-11-26T22:59:00Z')).length, 0); // 19:59
  assert.equal(detectarSequencias([h], [...tres, reg('2026-11-26')], P, noite).length, 0); // já feito
  assert.equal(detectarSequencias([h], tres.slice(1), P, noite).length, 0); // só 2 dias
  assert.equal(detectarSequencias([{ ...h, paused: true }], tres, P, noite).length, 0);
  assert.equal(detectarSequencias([{ ...h, times_per_week: 3 }], tres, P, noite).length, 0);
  // silêncio às 21:00 -> avisa a partir das 19:00
  assert.equal(detectarSequencias([h], tres, { quiet_start: '21:00', quiet_end: '07:00' }, em('2026-11-26T22:00:00Z')).length, 1);
});

test('prazo de projeto: em 3 dias e em 1 dia; concluído não avisa', () => {
  const agora = em('2026-11-26T15:00:00Z');
  const p = (id: string, due: string, status = 'em_andamento') => ({ id, name: id, due_date: due, status });
  const xs = detectarPrazos([p('a', '2026-11-29'), p('b', '2026-11-27'), p('c', '2026-11-28'), p('d', '2026-11-27', 'concluido')], agora);
  assert.deepEqual(xs.map((x) => x.dedupe_key), ['prazo_projeto:a:2026-11-29:3', 'prazo_projeto:b:2026-11-27:1']);
  assert.equal(xs[1]!.title, 'b: prazo amanhã');
});

test('diário: só depois das 21:30 e se ainda não escreveu', () => {
  assert.equal(detectarDiario(false, P, em('2026-11-27T00:29:00Z')).length, 0); // 21:29
  assert.equal(detectarDiario(false, P, em('2026-11-27T00:30:00Z'))[0]!.dedupe_key, 'diario_vazio:2026-11-26');
  assert.equal(detectarDiario(true, P, em('2026-11-27T00:30:00Z')).length, 0);
  assert.equal(detectarDiario(false, { quiet_start: '21:00', quiet_end: '07:00' }, em('2026-11-26T23:30:00Z')).length, 1); // 20:30
});

test('push: sensível sai como conteúdo reservado', () => {
  assert.deepEqual(textoPush({ title: 'Consulta com o psiquiatra', body: 'Lembrete · hoje às 15:00' }), {
    title: 'J.A.R.V.I.S.', body: 'Um aviso com conteúdo reservado. Abra o app para ver.',
  });
  assert.deepEqual(textoPush({ title: 'Pagar luz', body: 'Tarefa atrasada' }), { title: 'Pagar luz', body: 'Tarefa atrasada' });
  // resumo com várias linhas: só a linha sensível some
  assert.deepEqual(textoPush({ title: 'Bom dia, Senhor. O plano de hoje', body: '2 tarefas para hoje:\n• Pagar luz\n• Consulta no psiquiatra' }), {
    title: 'Bom dia, Senhor. O plano de hoje', body: '2 tarefas para hoje:\n• Pagar luz\n• (conteúdo reservado)',
  });
});

test('resumos: hora das preferências ou a fixa; janela de 2 h; silêncio solta na hora do resumo da manhã', () => {
  const p = { ...P, morning_at: '08:00:00', evening_at: '21:00:00' };
  assert.equal(horaDoResumo('resumo_manha', p, []), '08:00:00');
  const fixa = { kind: 'resumo_noite', entity_id: null, active: true, fixed_time: '22:30', muted_until: null };
  assert.equal(horaDoResumo('resumo_noite', p, [fixa]), '22:30');
  assert.equal(resumoNaHora('08:00', em('2026-11-26T10:59:00Z')), false); // 07:59
  assert.equal(resumoNaHora('08:00', em('2026-11-26T11:00:00Z')), true); // 08:00
  assert.equal(resumoNaHora('08:00', em('2026-11-26T12:59:00Z')), true); // 09:59
  assert.equal(resumoNaHora('08:00', em('2026-11-26T13:00:00Z')), false); // 10:00
  assert.equal(fimDoSilencio(p), '08:00:00');
  assert.equal(fimDoSilencio({ ...p, morning_at: '11:00' }), P.quiet_end); // longe demais: solta às 07:00
  assert.equal(decidir(cand(), p, [], em('2026-11-26T02:00:00Z')).scheduled_for, '2026-11-26T11:00:00.000Z');
  // resumo não sofre a hora fixa de novo, nem se junta
  const r = resumoNoite({ feitas: [], pendentesHoje: [], habitos: { feitos: 0, previstos: 0 }, amanha: 0 }, em('2026-11-27T00:00:00Z'));
  assert.equal(decidir(r, p, [{ ...fixa, fixed_time: '21:30' }], em('2026-11-27T00:00:00Z')).status, 'enviar');
  const j = juntar([{ id: 'a', kind: 'resumo_noite', title: 'x', body: '', priority: 'normal' }], { resumo_noite: '2026-11-27T00:00:00Z' }, em('2026-11-27T00:05:00Z'), () => 'g');
  assert.equal(j.entregas.length, 1);
});

test('resumo da manhã: plano do dia e o que chegou de noite', () => {
  const agora = em('2026-11-26T11:00:00Z'); // 08:00 SP
  const r = resumoManha({
    tarefasHoje: [{ title: 'Pagar luz', due_time: '10:00:00' }, { title: 'Ler', due_time: null }],
    atrasadas: 1,
    lembretesHoje: [{ title: 'Ligar pro João', remind_at: '2026-11-26T18:00:00Z' }],
    habitosHoje: ['Água'],
    prazos: [{ name: 'App', due_date: '2026-11-27' }],
    segurados: ['Tarefa X atrasada'],
  }, agora);
  assert.equal(r.dedupe_key, 'resumo_manha:2026-11-26');
  assert.equal(r.body, [
    '2 tarefas para hoje:', '• 10:00 Pagar luz', '• Ler', '1 lembrete:', '• 15:00 Ligar pro João',
    'Hábitos de hoje: Água', '1 tarefa atrasada esperando.', 'Prazo: App amanhã', 'Durante a noite (1):', '• Tarefa X atrasada',
  ].join('\n'));
  const livre = resumoManha({ tarefasHoje: [], atrasadas: 0, lembretesHoje: [], habitosHoje: [], prazos: [], segurados: [] }, agora);
  assert.equal(livre.title, 'Bom dia, Senhor. Dia livre');
});

test('resumo da noite: feito, hábitos, o que ficou e amanhã', () => {
  const r = resumoNoite({ feitas: ['A', 'B', 'C', 'D'], pendentesHoje: ['E'], habitos: { feitos: 1, previstos: 2 }, amanha: 3 }, em('2026-11-27T00:00:00Z'));
  assert.equal(r.dedupe_key, 'resumo_noite:2026-11-26');
  assert.equal(r.body, ['Feito hoje (4):', '• A', '• B', '• C', '• e mais 1', 'Hábitos: 1 de 2', 'Ficou para depois (1):', '• E', 'Amanhã: 3 tarefas.'].join('\n'));
  const h = { id: 'h1', name: 'Ler', paused: false, kind: 'boolean' as const, daily_target: null, weekdays: null, times_per_week: null };
  assert.deepEqual(habitosDoDia([h, { ...h, id: 'h2', name: 'Água' }], [{ habit_id: 'h1', day: '2026-11-26', value: 1 }], '2026-11-26'),
    { nomes: ['Ler', 'Água'], feitos: 1, previstos: 2 });
});

test('canal: PC aberto, senão celular; urgente nos dois; lembrete no PC é o aviso local', () => {
  const agora = em('2026-11-26T15:00:00Z');
  const pc = { platform: 'pc', seen_at: '2026-11-26T14:59:30Z', push_token: null };
  const pcVelho = { ...pc, seen_at: '2026-11-26T14:50:00Z' };
  const cel = { platform: 'android', seen_at: '2026-11-20T00:00:00Z', push_token: 'ExponentPushToken[x]' };
  const t = { kind: 'tarefa_atrasada', priority: 'normal' as const };
  assert.deepEqual(escolherCanais(t, [pc, cel], agora), ['pc']);
  assert.deepEqual(escolherCanais(t, [pcVelho, cel], agora), ['push']);
  assert.deepEqual(escolherCanais({ ...t, priority: 'urgente' }, [pc, cel], agora), ['pc', 'push']);
  assert.deepEqual(escolherCanais({ kind: 'lembrete_hora', priority: 'normal' }, [pc], agora), ['pc_local']);
  assert.deepEqual(escolherCanais(t, [], agora), []);
});
