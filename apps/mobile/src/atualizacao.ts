// EAS Update no celular.
// - Ao abrir o app e ao voltar para ele: se houver versão nova, baixa e recarrega na hora
//   (ninguém está digitando nada nesse momento).
// - Durante o uso, a cada 5 minutos: baixa em segundo plano e só avisa (faixa "Atualizar"),
//   para nunca recarregar no meio de um texto; recarrega quando o dono tocar.
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

const CINCO_MINUTOS = 5 * 60 * 1000;
let procurando = false;
let pronta = false;

async function procurar(aplicarNaHora: boolean, avisar: () => void) {
  if (__DEV__ || !Updates.isEnabled || procurando) return;
  if (pronta) {
    if (aplicarNaHora) await aplicarAtualizacao();
    return;
  }
  procurando = true;
  try {
    const r = await Updates.checkForUpdateAsync();
    if (r.isAvailable) {
      await Updates.fetchUpdateAsync();
      pronta = true;
      if (aplicarNaHora) await aplicarAtualizacao();
      else avisar();
    }
  } catch {
    // Sem internet ou servidor fora: tenta na próxima vez.
  } finally {
    procurando = false;
  }
}

/** Recarrega o app já com a versão baixada. */
export async function aplicarAtualizacao() {
  try {
    await Updates.reloadAsync();
  } catch {
    /* se falhar, entra na próxima abertura */
  }
}

/** `avisar` é chamado quando uma versão nova ficou pronta durante o uso. */
export function ligarAtualizacao(avisar: () => void) {
  void procurar(true, avisar);
  const sub = AppState.addEventListener('change', (estado) => {
    if (estado === 'active') void procurar(true, avisar);
  });
  const relogio = setInterval(() => {
    if (AppState.currentState === 'active') void procurar(false, avisar);
  }, CINCO_MINUTOS);
  return () => {
    sub.remove();
    clearInterval(relogio);
  };
}
