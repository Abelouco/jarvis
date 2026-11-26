// Push no celular (Fase 3 · Etapa 2): o vigia do servidor (`avisos_vigia`) manda os avisos pelo
// Expo Push quando o PC está fechado. Aqui o app só pede a permissão, pega o token do aparelho e
// grava em `devices` (jarvis.avisos.presenca). Nada de aviso local: quem decide é o servidor.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Storage from 'expo-sqlite/kv-store';
import { jarvis } from './jarvis';

const CHAVE_APARELHO = 'jarvis.aparelho';

// Com o app aberto, o aviso também aparece (sem isso o Android só mostra com o app fechado).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

async function idDoAparelho() {
  let id = await Storage.getItem(CHAVE_APARELHO);
  if (!id) {
    // uuid v4 (o Hermes nem sempre tem crypto.randomUUID); só identifica o aparelho, não é segredo
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
    await Storage.setItem(CHAVE_APARELHO, id);
  }
  return id;
}

/** Pede a permissão e registra o token. Chamar depois do login; falha calada (sem internet, tenta na próxima). */
export async function registrarPush() {
  try {
    if (Platform.OS !== 'android' || !Device.isDevice) return;
    await Notifications.setNotificationChannelAsync('avisos', {
      name: 'Avisos do J.A.R.V.I.S.',
      importance: Notifications.AndroidImportance.HIGH,
    });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const token = status === 'granted' && projectId
      ? (await Notifications.getExpoPushTokenAsync({ projectId })).data
      : null; // sem permissão: o servidor não manda push para cá
    await jarvis.avisos.presenca(await idDoAparelho(), 'android', Device.modelName ?? 'Android', token);
  } catch (e) {
    console.warn('push: registro falhou', e);
  }
}
