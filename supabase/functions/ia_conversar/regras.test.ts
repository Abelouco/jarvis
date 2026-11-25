// Testes das regras locais (sensível e rota). Rodar: node --test supabase/functions/ia_conversar/regras.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarSensibilidade } from './sensivel.ts';
import { escolherRota } from './rota.ts';

const sens = (t: string) => avaliarSensibilidade(t);

test('sensível: documentos, cartão e credenciais', () => {
  assert.deepEqual(sens('meu CPF é 123.456.789-09').motivos, ['cpf']);
  assert.ok(sens('CNPJ 12.345.678/0001-95').motivos.includes('cnpj'));
  assert.ok(sens('cartão 4111 1111 1111 1111 vence em 10/29').motivos.includes('cartao'));
  assert.ok(sens('a senha do wifi é abc123').motivos.includes('credencial'));
  assert.ok(sens('minha chave da API é gsk_abcdefghijklmnop').motivos.includes('credencial'));
});

test('sensível: saúde e finanças (com e sem acento)', () => {
  assert.ok(sens('Tenho consulta com o psiquiatra amanhã').motivos.includes('saude'));
  assert.ok(sens('estou com ansiedade').motivos.includes('saude'));
  assert.ok(sens('qual o resultado do meu exame de sangue?').motivos.includes('saude'));
  assert.ok(sens('Meu salário caiu hoje').motivos.includes('financas'));
  assert.ok(sens('paga o boleto da luz').motivos.includes('financas'));
  assert.ok(sens('quanto tenho de SALDO?').motivos.includes('financas'));
});

test('não sensível: conversa comum', () => {
  for (const t of [
    'Quem é você?',
    'Qual a capital da França?',
    'Me lembra de comprar pão amanhã às 8h',
    'Explique como funciona um motor a combustão',
    'Pedido número 1234567890123',
    'Escreva um poema sobre o mar',
  ]) {
    assert.equal(sens(t).sensivel, false, t);
  }
});

test('rota: quase tudo vai pela pesquisa (padrão)', () => {
  for (const t of [
    'Como fazer uma vara de pesca no jogo Medieval Dynasty?',
    'Quanto custa um PlayStation 5 hoje?',
    'Qual a última versão do Node?',
    'Quem ganhou a Copa do Mundo de 2022?',
    'Pesquise para mim os horários do metrô',
    'Como craftar uma picareta no Minecraft?',
    'O que é o Stardew Valley?',
    'Qual a capital da França?',
    'Compare Python e TypeScript para um app',
    'Por que o céu é azul?',
    'Qual é a melhor forma de estudar inglês?',
    'Explique como funciona um motor a combustão',
    'Como vejo a versão do Node instalada no meu PC?',
    'O que são partículas subatômicas?',
    'Quem criou o Python?',
    'Qual o tamanho da esfera celeste?',
  ]) {
    assert.equal(escolherRota(t), 'pesquisa', t);
  }
});

test('rota: conversa trivial e perguntas sobre o J.A.R.V.I.S. vão sem busca', () => {
  for (const t of [
    'Quem é você?', 'Oi', 'Que horas são?', 'Obrigado!', 'Meu nome é Abel', 'Bom dia, tudo bem?', 'Faz sentido',
    'O que são esses nós em volta do seu núcleo?', 'O que significa cada pulso?', 'Por que a esfera ficou azul?',
    'Qual a versão do Jarvis?', 'Qual é a sua versão atual?', 'Quem te criou?',
  ]) {
    assert.equal(escolherRota(t), 'rapido', t);
  }
});

test('rota: o dono ensinando pronúncia ou corrigindo vai sem busca', () => {
  for (const t of [
    'A pronúncia correta é "Dêpê Sóquer".', 'Medieval Dynasty se pronuncia Midíval Dáinasti', 'Como se pronuncia Steam?',
    'Na verdade o nome do projeto é DP Soccer', 'O certo é Sóquer, não Socker', 'Você falou errado o nome do jogo',
  ]) {
    assert.equal(escolherRota(t), 'rapido', t);
  }
});

test('rota: assuntos do dono e textos para escrever vão pelo raciocínio, sem busca', () => {
  for (const t of [
    'Me ajuda a planejar minha semana',
    'Escreva um e-mail pedindo reunião e organize os tópicos',
    'Organize minha rotina para estudar à noite',
  ]) {
    assert.equal(escolherRota(t), 'inteligente', t);
  }
});

// ---------- tarefas (funções puras) ----------
import { acharPorNome, calendario, dataHumana, dataValida, normalizarHora, pareceTarefa, somarDias } from './tarefas.ts';

test('tarefas: datas e horas', () => {
  assert.equal(somarDias('2026-11-30', 1), '2026-12-01');
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
  assert.ok(dataValida('2026-02-28'));
  assert.ok(!dataValida('2026-02-30'));
  assert.ok(!dataValida('amanhã'));
  assert.equal(normalizarHora('9h'), '09:00');
  assert.equal(normalizarHora('9h30'), '09:30');
  assert.equal(normalizarHora('14:05'), '14:05');
  assert.equal(normalizarHora('25:00'), null);
  assert.equal(dataHumana('2026-11-26', '2026-11-25'), 'amanhã');
  assert.equal(dataHumana('2026-11-29', '2026-11-25'), 'domingo, 29/11');
  assert.match(calendario('2026-11-25', 2), /2026-11-25 quarta \(hoje\)\n2026-11-26 quinta \(amanhã\)/);
});

test('tarefas: achar por nome ou id', () => {
  const lista = [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Ir ao mercado' },
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', title: 'Pagar a conta de luz' },
    { id: 'cccccccc-0000-4000-8000-000000000003', title: 'Ligar para o mecânico' },
    { id: 'dddddddd-0000-4000-8000-000000000004', title: 'Comprar pão no mercado' },
  ];
  assert.deepEqual(acharPorNome('a do mercado', lista).map((t) => t.title), ['Ir ao mercado', 'Comprar pão no mercado']);
  assert.deepEqual(acharPorNome('ir ao mercado', lista).map((t) => t.title), ['Ir ao mercado']);
  assert.deepEqual(acharPorNome('luz', lista).map((t) => t.title), ['Pagar a conta de luz']);
  assert.deepEqual(acharPorNome('mecanico', lista).map((t) => t.title), ['Ligar para o mecânico']);
  assert.deepEqual(acharPorNome('cccccccc', lista).map((t) => t.title), ['Ligar para o mecânico']);
  assert.deepEqual(acharPorNome('academia', lista), []);
});

test('tarefas: detector local', () => {
  for (const t of ['cria uma tarefa para amanhã às 9h', 'o que tenho hoje?', 'conclui a do mercado', 'apaga a tarefa do pão', 'desfaz', 'minhas tarefas']) {
    assert.ok(pareceTarefa(t, false), t);
  }
  for (const t of ['Qual a capital da França?', 'quem é você?', 'sim']) assert.ok(!pareceTarefa(t, false), t);
  assert.ok(pareceTarefa('sim, pode', true));
});

// ---------- tarefas fixas (repetição) e datas calculadas no servidor ----------
import { readFileSync } from 'node:fs';
import { dataAposConcluir, descreverRecorrencia, normalizarRecorrencia, primeiraData, proximaData } from './recorrencia.ts';
import { resolverQuando } from './tarefas.ts';

// Quarta, 25/11/2026, 12:42 em São Paulo (15:42 UTC): o dia do erro da "Pelada Dondon".
const QUARTA = new Date('2026-11-25T15:42:00Z');

test('repetição: "toda segunda às 20h" criada numa quarta cai na segunda 30/11', () => {
  const rec = normalizarRecorrencia({ freq: 'semanal', dias_semana: ['seg'] })!;
  assert.deepEqual(rec, { freq: 'semanal', dias: [1], ate: null });
  assert.equal(primeiraData(rec, '20:00', QUARTA), '2026-11-30');
  assert.equal(descreverRecorrencia(rec), 'toda segunda');
  // Concluiu a de segunda 30/11 -> próxima segunda 07/12.
  assert.equal(dataAposConcluir(rec, '2026-11-30', new Date('2026-11-30T23:30:00Z')), '2026-12-07');
  // Esqueceu de concluir e concluiu na quarta seguinte -> próxima segunda, nunca o passado.
  assert.equal(dataAposConcluir(rec, '2026-11-30', new Date('2026-12-02T15:00:00Z')), '2026-12-07');
});

test('repetição: hoje vale só se a hora ainda não passou', () => {
  const diaria = normalizarRecorrencia({ freq: 'diaria' })!;
  assert.equal(primeiraData(diaria, '20:00', QUARTA), '2026-11-25');
  assert.equal(primeiraData(diaria, '09:00', QUARTA), '2026-11-26');
  assert.equal(primeiraData(diaria, null, QUARTA), '2026-11-25');
});

test('repetição: dias úteis, fim de semana, mensal e fim da série', () => {
  const uteis = normalizarRecorrencia({ freq: 'dias_uteis' })!;
  assert.equal(proximaData(uteis, '2026-11-27', false), '2026-11-30'); // sexta -> segunda
  const fds = normalizarRecorrencia({ frequencia: 'fim_de_semana' })!;
  assert.equal(proximaData(fds, '2026-11-25', true), '2026-11-28');
  const mensal = normalizarRecorrencia({ freq: 'mensal', dia_do_mes: 31 })!;
  assert.equal(proximaData(mensal, '2027-02-01', true), '2027-02-28'); // mês curto: último dia
  const curta = normalizarRecorrencia({ freq: 'semanal', dias_semana: ['seg', 'qua'], ate: '2026-12-01' })!;
  assert.equal(descreverRecorrencia(curta), 'seg, qua');
  assert.equal(proximaData(curta, '2026-11-30', false), null);
  assert.equal(normalizarRecorrencia({ freq: 'semanal', dias_semana: [] }), null);
  assert.equal(descreverRecorrencia(normalizarRecorrencia({ freq: 'semanal', dias: ['sab'] })), 'todo sábado');
});

test('datas: o servidor calcula, a IA só diz o dia', () => {
  const hoje = '2026-11-25'; // quarta
  assert.equal(resolverQuando({ dia_semana: 'seg' }, hoje), '2026-11-30');
  assert.equal(resolverQuando({ dia_semana: 'segunda-feira' }, hoje), '2026-11-30');
  assert.equal(resolverQuando({ dia_semana: 'qua' }, hoje), '2026-12-02'); // "quarta" dita na quarta = a próxima
  assert.equal(resolverQuando({ dia_semana: 'sex' }, hoje), '2026-11-27');
  assert.equal(resolverQuando({ dia_semana: 'sex', semana_que_vem: true }, hoje), '2026-12-04');
  assert.equal(resolverQuando({ quando: 'amanhã' }, hoje), '2026-11-26');
  assert.equal(resolverQuando({ quando: 'depois de amanhã' }, hoje), '2026-11-27');
  assert.equal(resolverQuando({ daqui_dias: 10 }, hoje), '2026-12-05');
  assert.equal(resolverQuando({ dia_mes: 5 }, hoje), '2026-12-05');
  assert.equal(resolverQuando({ dia_mes: 28 }, hoje), '2026-11-28');
  assert.equal(resolverQuando({ data: '2026-12-24' }, hoje), '2026-12-24');
  assert.equal(resolverQuando({ quando: 'sem_data' }, hoje), null);
  assert.equal(resolverQuando({}, hoje), undefined);
});

test('repetição: a cópia do servidor é igual à do app', () => {
  const corpo = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r/g, '').split('\n').slice(2).join('\n');
  assert.equal(corpo('./recorrencia.ts'), corpo('../../../packages/core/src/recorrencia.ts'));
});

// ---------- lembretes ----------
import { proximoInstante, resolverInstante } from './lembretes.ts';

test('lembretes: hora calculada no servidor', () => {
  const hoje = '2026-11-25'; // quarta, 12:42 em SP
  const r = (a: Record<string, unknown>) => {
    const x = resolverInstante(a, hoje, QUARTA);
    return typeof x === 'string' ? x : x.iso;
  };
  assert.equal(r({ em_minutos: 20 }), '2026-11-25T16:02:00.000Z');
  assert.equal(r({ hora: '15:00' }), '2026-11-25T18:00:00.000Z'); // ainda dá hoje
  assert.equal(r({ hora: '09:00' }), '2026-11-26T12:00:00.000Z'); // já passou: amanhã
  assert.equal(r({ quando: 'amanha', hora: '9h' }), '2026-11-26T12:00:00.000Z');
  assert.equal(r({ repetir: { freq: 'semanal', dias_semana: ['seg'] }, hora: '20:00' }), '2026-11-30T23:00:00.000Z');
  assert.equal(typeof resolverInstante({ quando: 'amanha' }, hoje, QUARTA), 'string'); // falta a hora
  // Lembrete fixo concluído: próxima segunda, mesma hora.
  const l = { remind_at: '2026-11-30T23:00:00.000Z', recurrence: { freq: 'semanal' as const, dias: [1] } };
  assert.equal(proximoInstante(l, new Date('2026-11-30T23:05:00Z')), '2026-12-07T23:00:00.000Z');
});

import './projetos.ts';

test('projetos: o detector local chama o planejador', () => {
  for (const t of [
    'Cria o projeto Reformar o quarto',
    'como está o projeto do app?',
    'coloca a tarefa comprar tinta no projeto reforma',
    'adiciona o marco Pintura no projeto Reforma',
  ]) {
    assert.equal(pareceTarefa(t, false), true, t);
  }
  assert.equal(pareceTarefa('Qual a capital da França?', false), false);
});
