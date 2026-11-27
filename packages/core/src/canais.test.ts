// Trava contra o erro que juntou todas as abas na v0.2.0: dois ouvintes com o mesmo nome de canal
// Realtime fazem o supabase-js lançar erro no `.on` (canal já assinado) e a tela para de montar.
// Regra: todo `.channel(...)` usa nome único (canalUnico ou crypto.randomUUID()), nunca texto fixo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'src-tauri' || n === 'dist') return [];
    return statSync(p).isDirectory() ? arquivos(p) : /\.tsx?$/.test(n) && !n.endsWith('.test.ts') ? [p] : [];
  });
}

test('canais Realtime: nenhum nome fixo (evita o erro das abas juntas)', () => {
  const raiz = join(import.meta.dirname, '..', '..', '..');
  const fixos: string[] = [];
  for (const pasta of ['packages', 'apps/desktop/src']) {
    for (const f of arquivos(join(raiz, pasta))) {
      for (const [i, linha] of readFileSync(f, 'utf8').split('\n').entries()) {
        if (/\.channel\(\s*['"]/.test(linha)) fixos.push(`${f}:${i + 1}`);
      }
    }
  }
  assert.deepEqual(fixos, [], 'use canalUnico(...) ou um nome com crypto.randomUUID()');
});
