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

test('rota: fatos do mundo vão pela pesquisa', () => {
  for (const t of [
    'Como fazer uma vara de pesca no jogo Medieval Dynasty?',
    'Quanto custa um PlayStation 5 hoje?',
    'Qual a última versão do Node?',
    'Quem ganhou a Copa do Mundo de 2022?',
    'Pesquise para mim os horários do metrô',
    'Como craftar uma picareta no Minecraft?',
    'O que é o Stardew Valley?',
  ]) {
    assert.equal(escolherRota(t), 'pesquisa', t);
  }
});

test('rota: perguntas curtas vão pelo caminho rápido', () => {
  for (const t of ['Quem é você?', 'Oi', 'Que horas são?', 'Qual a capital da França?', 'Obrigado!', 'Meu nome é Abel']) {
    assert.equal(escolherRota(t), 'rapido', t);
  }
});

test('rota: pedidos de raciocínio vão pelo caminho inteligente', () => {
  for (const t of [
    'Explique como funciona um motor a combustão',
    'Me ajuda a planejar minha semana',
    'Compare Python e TypeScript para um app',
    'Quais os prós e contras de morar sozinho?',
    'Escreva um e-mail pedindo reunião',
    'Por que o céu é azul?',
    'Qual é a melhor forma de estudar inglês?',
    'O que é isso? E para que serve?',
    'a'.repeat(301),
  ]) {
    assert.equal(escolherRota(t), 'inteligente', t.slice(0, 40));
  }
});
