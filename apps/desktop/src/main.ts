import { SUPABASE_URL } from '@jarvis/core';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div style="height:100vh;display:grid;place-items:center;text-align:center">
    <div>
      <h1 style="font-weight:300;letter-spacing:.4em">J.A.R.V.I.S.</h1>
      <p style="color:#5a6b80">Fase 0 · núcleo: ${SUPABASE_URL.replace('https://', '')}</p>
    </div>
  </div>`;
