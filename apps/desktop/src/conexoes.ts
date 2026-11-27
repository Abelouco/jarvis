// Botão "Google" no topo (Fase 4 · etapa 4): conectar e desconectar a conta Google (Gmail).
// - Desconectado: clique abre a página do Google no navegador; o botão espera o retorno (o evento de
//   `integrations` chega pelo Realtime) e fica verde.
// - Conectado: o primeiro clique arma ("Desconectar?"), o segundo revoga no Google e apaga o acesso.
import { invoke } from '@tauri-apps/api/core';
import { jarvis } from './jarvis';

type Estado = 'carregando' | 'desconectado' | 'esperando' | 'conectado' | 'expirado' | 'armado' | 'erro';

export function ligarBotaoGoogle(botao: HTMLButtonElement, avisarErro: (texto: string) => void) {
  let estado: Estado = 'carregando';
  let email: string | null = null;
  let desarmar: ReturnType<typeof setTimeout> | null = null;
  let esperarAte = 0;

  const ROTULO: Record<Estado, string> = {
    carregando: 'Google', desconectado: 'Conectar Google', esperando: 'Aguardando o Google…',
    conectado: 'Google', expirado: 'Reconectar Google', armado: 'Desconectar?', erro: 'Google',
  };

  function mostrar() {
    botao.dataset.estado = estado;
    botao.innerHTML = `<i class="ponto"></i>${ROTULO[estado]}`;
    botao.title = estado === 'conectado' ? `Google conectado: ${email ?? ''} (clique para desconectar)`
      : estado === 'armado' ? 'Clique de novo para desconectar (revoga o acesso no Google)'
        : estado === 'esperando' ? 'Termine a permissão na página do Google que abriu no navegador'
          : estado === 'expirado' ? 'O acesso ao Google expirou ou foi tirado: clique para conectar de novo'
            : 'Conectar a conta Google (Gmail)';
  }

  async function atualizar() {
    try {
      const g = await jarvis.conexoes.google();
      email = g?.email ?? null;
      if (g?.status === 'ativa') estado = 'conectado';
      else if (estado === 'esperando' && Date.now() < esperarAte) return;
      else estado = g?.status === 'expirada' ? 'expirado' : 'desconectado';
    } catch {
      if (estado === 'carregando') estado = 'desconectado';
    }
    mostrar();
  }

  botao.onclick = async () => {
    if (estado === 'conectado') {
      estado = 'armado';
      mostrar();
      desarmar = setTimeout(() => {
        if (estado === 'armado') estado = 'conectado';
        mostrar();
      }, 4000);
      return;
    }
    if (estado === 'armado') {
      if (desarmar) clearTimeout(desarmar);
      try {
        await jarvis.conexoes.desconectarGoogle();
      } catch (e) {
        avisarErro(e instanceof Error ? e.message : String(e));
      }
      await atualizar();
      return;
    }
    if (estado === 'esperando' || estado === 'carregando') return;
    try {
      const url = await jarvis.conexoes.iniciarGoogle();
      await invoke('abrir_link', { url });
      estado = 'esperando';
      esperarAte = Date.now() + 10 * 60_000; // o link vale 10 min
      mostrar();
      setTimeout(() => void atualizar(), 10 * 60_000 + 1000);
    } catch (e) {
      avisarErro(e instanceof Error ? e.message : String(e));
    }
  };

  mostrar();
  void atualizar();
  // O retorno do Google grava `integrations`: o evento chega e o botão se atualiza.
  jarvis.aoEvento((e) => {
    if (e.entity_type === 'integrations') {
      esperarAte = 0;
      void atualizar();
    }
  });
}
