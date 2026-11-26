// Avisos (Fase 3): o vigia roda no servidor (`avisos_vigia`). Aqui o PC só faz duas coisas:
// 1. diz a cada minuto que está aberto (com isso o aviso vem para cá, não para o celular);
// 2. mostra a notificação do Windows quando chega um evento `notify` pelo Realtime.
import { invoke } from '@tauri-apps/api/core';
import { jarvis } from './jarvis';

const CHAVE_APARELHO = 'jarvis.aparelho';

function idDoAparelho() {
  let id = localStorage.getItem(CHAVE_APARELHO);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CHAVE_APARELHO, id);
  }
  return id;
}

export function ligarAvisos(op: { pulsar?: () => void } = {}) {
  const aparelho = idDoAparelho();
  const sinal = () => void jarvis.avisos.presenca(aparelho, 'pc', 'PC').catch(() => {});
  sinal();
  setInterval(sinal, 60_000);
  // Voltou de suspensão ou ganhou internet: avisa na hora, sem esperar o minuto.
  window.addEventListener('online', sinal);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sinal(); });

  const vistos = new Set<string>();
  jarvis.aoEvento((e) => {
    if (e.kind !== 'notify' || !e.entity_id || vistos.has(e.entity_id)) return;
    // Só avisos frescos: evento antigo (histórico ao reabrir) não vira notificação de novo.
    if (Date.now() - new Date(e.created_at).getTime() > 3 * 60_000) return;
    vistos.add(e.entity_id);
    const p = e.payload as { titulo?: string; corpo?: string };
    op.pulsar?.();
    void invoke('notificar', { titulo: p.titulo ?? 'J.A.R.V.I.S.', corpo: p.corpo ?? '' }).catch((err) =>
      console.warn('avisos: notificação falhou', err),
    );
  });
}
