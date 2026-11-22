import * as SQLite from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import * as Updates from 'expo-updates';
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
/** "Celular v0.1.0 (atualização 22-11)": a versão do .apk e a data da última atualização (EAS Update). */
function versaoApp() {
  const d = Updates.createdAt;
  const data = d ? ` (atualização ${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')})` : '';
  return `Celular v${Updates.runtimeVersion ?? '?'}${data}`;
}

export const jarvis = criarJarvis({ db, sessao: Storage, versaoApp });
