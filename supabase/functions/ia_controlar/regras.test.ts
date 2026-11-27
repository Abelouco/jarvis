// Testes do plano do modo controle. Rodar: node --test supabase/functions/ia_controlar/regras.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinacaoProibida, validarPlano } from './regras.ts';

const TELA = { largura: 1920, altura: 1080 };

test('plano válido passa inteiro', () => {
  const plano = validarPlano({
    pensamento: 'vou clicar em salvar',
    perigo: null,
    passos: [
      { acao: 'clicar', alvo_id: 'e3' },
      { acao: 'digitar', texto: 'teste' },
      { acao: 'tecla', combinacao: 'ctrl+s' },
      { acao: 'rolar', direcao: 'baixo', quantidade: 2 },
      { acao: 'esperar', ms: 400 },
      { acao: 'abrir', alvo: 'bloco de notas' },
      { acao: 'pronto', resumo: 'Salvei.' },
    ],
  }, TELA);
  assert.equal(plano.pensamento, 'vou clicar em salvar');
  assert.equal(plano.perigo, null);
  assert.equal(plano.passos.length, 7);
  assert.deepEqual(plano.passos[0], { acao: 'clicar', alvo_id: 'e3' });
  assert.deepEqual(plano.passos[2], { acao: 'tecla', combinacao: 'ctrl+s' });
  assert.deepEqual(plano.passos[6], { acao: 'pronto', resumo: 'Salvei.' });
});

test('nove passos viram oito', () => {
  const passos = Array.from({ length: 9 }, (_, i) => ({ acao: 'clicar', alvo_id: `e${i}` }));
  const plano = validarPlano({ passos }, TELA);
  assert.equal(plano.passos.length, 8);
  assert.deepEqual(plano.passos[7], { acao: 'clicar', alvo_id: 'e7' });
});

test('clique em y = 10 é descartado', () => {
  const plano = validarPlano({
    passos: [
      { acao: 'clicar', x: 100, y: 10 },
      { acao: 'clicar', x: 100, y: 80 },
    ],
  }, TELA);
  assert.equal(plano.passos.length, 1);
  assert.deepEqual(plano.passos[0], { acao: 'clicar', x: 100, y: 80 });
});

test('a tecla ctrl+banana é descartada', () => {
  const plano = validarPlano({
    passos: [
      { acao: 'tecla', combinacao: 'ctrl+banana' },
      { acao: 'tecla', combinacao: 'enter' },
    ],
  }, TELA);
  assert.deepEqual(plano.passos, [{ acao: 'tecla', combinacao: 'enter' }]);
});

test('combinacaoProibida de R+Win dá true', () => {
  assert.equal(combinacaoProibida('R+Win'), true);
  assert.equal(combinacaoProibida('ctrl+shift+esc'), true);
  assert.equal(combinacaoProibida('ctrl+s'), false);
});

test('lixo vira pedir_dono', () => {
  for (const bruto of [null, 'oi', {}]) {
    const plano = validarPlano(bruto, TELA);
    assert.deepEqual(plano.passos, [{ acao: 'pedir_dono', motivo: 'Não entendi o que fazer na tela.' }]);
    assert.equal(plano.perigo, null);
  }
});
