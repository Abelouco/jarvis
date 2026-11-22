import Database from '@tauri-apps/plugin-sql';
import { getVersion } from '@tauri-apps/api/app';
import { criarJarvis, type BancoLocal } from '@jarvis/core';

// Arquivo jarvis.db na pasta de dados do app (AppData do Windows).
const conexao = Database.load('sqlite:jarvis.db');

const db: BancoLocal = {
  async executar(sql, params = []) {
    await (await conexao).execute(sql, params);
  },
  async consultar<T>(sql: string, params: unknown[] = []) {
    return (await conexao).select<T[]>(sql, params);
  },
};

/** Instância única no PC. A sessão de login fica no localStorage da janela. */
export const jarvis = criarJarvis({
  db,
  sessao: window.localStorage,
  versaoApp: async () => `PC v${await getVersion()}`,
});
