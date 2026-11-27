// Regras puras do chat (sem banco nem rede), testadas no Node.

/** O mínimo de uma mensagem que estas regras olham. */
export interface MsgRegra {
  id: string;
  role: 'user' | 'assistant';
  route?: string | null;
}

/**
 * Ids das respostas que chegaram depois de um "Parar" para a mesma pergunta (corrida: o servidor já
 * tinha terminado quando o dono parou). Considera o trecho entre uma pergunta e a próxima.
 * Resposta de ação ('acao') fica: o que ela fez já aconteceu.
 */
export function respostasDepoisDoParar(msgs: MsgRegra[]): string[] {
  const sobras: string[] = [];
  let trecho: MsgRegra[] = [];
  const fechar = () => {
    if (trecho.some((m) => m.route === 'interrompido')) {
      for (const m of trecho) if (m.route !== 'interrompido' && m.route !== 'acao') sobras.push(m.id);
    }
    trecho = [];
  };
  for (const m of msgs) {
    if (m.role === 'user') fechar();
    else trecho.push(m);
  }
  fechar();
  return sobras;
}
