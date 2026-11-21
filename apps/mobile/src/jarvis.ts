import * as SQLite from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { criarJarvis, type BancoLocal } from '@jarvis/core';

const sqlite = SQLite.openDatabaseSync('jarvis.db');

const db: BancoLocal = {
  async executar(sql, params = []) {
    await sqlite.runAsync(sql, params);
  },
  async consultar(sql, params = []) {
    return sqlite.getAllAsync(sql, params);
  },
};

/** Instância única do J.A.R.V.I.S. no celular. A sessão fica no SQLite (kv-store). */
export const jarvis = criarJarvis({ db, sessao: Storage });
