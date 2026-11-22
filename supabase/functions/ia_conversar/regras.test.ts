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

test('rota: assuntos do dono e textos para escrever vão pelo raciocínio, sem busca', () => {
  for (const t of [
    'Me ajuda a planejar minha semana',
    'Escreva um e-mail pedindo reunião e organize os tópicos',
    'Organize minha rotina para estudar à noite',
  ]) {
    assert.equal(escolherRota(t), 'inteligente', t);
  }
});
