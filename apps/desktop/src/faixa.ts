// Faixa vermelha do modo controle. A sessão mora na janela principal.
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';

const texto = document.querySelector<HTMLSpanElement>('#texto')!;
const retomar = document.querySelector<HTMLButtonElement>('#retomar')!;
const parar = document.querySelector<HTMLButtonElement>('#parar')!;

await listen<{ ate: string; estado: string; pausado: boolean }>('faixa-estado', (e) => {
  const ate = e.payload.ate ? `até ${e.payload.ate}` : '';
  texto.textContent = ['J.A.R.V.I.S. no controle', ate, e.payload.estado].filter(Boolean).join(' · ');
  retomar.hidden = !e.payload.pausado;
});

retomar.onclick = () => {
  void invoke('pc_retomar');
  retomar.hidden = true;
};

parar.onclick = () => {
  void invoke('pc_parar', { pausar: false });
  void emitTo('main', 'faixa-parar', {});
};

void emitTo('main', 'faixa-pronta', {});
