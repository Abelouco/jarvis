// Uso: pnpm release:pc 0.1.1
// Atualiza a versão do app do PC, faz o commit, cria a tag e envia.
// O GitHub Actions (release-pc.yml) gera o instalador e publica a release.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const versao = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(versao ?? '')) {
  console.error('Uso: pnpm release:pc X.Y.Z');
  process.exit(1);
}
const rodar = (cmd) => execSync(cmd, { stdio: 'inherit' });
if (execSync('git status --porcelain').toString().trim()) {
  console.error('Há mudanças não commitadas. Faça o commit antes da release.');
  process.exit(1);
}

const conf = 'apps/desktop/src-tauri/tauri.conf.json';
const json = JSON.parse(readFileSync(conf, 'utf8'));
json.version = versao;
writeFileSync(conf, JSON.stringify(json, null, 2) + '\n');

const cargo = 'apps/desktop/src-tauri/Cargo.toml';
writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = ".*"$/m, `version = "${versao}"`));

rodar(`git add ${conf} ${cargo}`);
rodar(`git commit -m "PC v${versao}"`);
rodar(`git tag v${versao}`);
rodar('git push');
rodar(`git push origin v${versao}`);
console.log(`\nTag v${versao} enviada. Acompanhe em https://github.com/Abelouco/jarvis/actions`);
