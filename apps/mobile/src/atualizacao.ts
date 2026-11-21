// EAS Update aplicado na hora: ao abrir o app (e ao voltar para ele), procura versão nova;
// se houver, baixa e recarrega. Sem isso, a versão nova só entraria na abertura seguinte.
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

let procurando = false;

async function procurar() {
  if (__DEV__ || !Updates.isEnabled || procurando) return;
  procurando = true;
  try {
    const r = await Updates.checkForUpdateAsync();
    if (r.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // Sem internet ou servidor fora: tenta na próxima vez que o app voltar.
  } finally {
    procurando = false;
  }
}

export function ligarAtualizacao() {
  void procurar();
  const sub = AppState.addEventListener('change', (estado) => {
    if (estado === 'active') void procurar();
  });
  return () => sub.remove();
}
