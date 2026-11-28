// O que o J.A.R.V.I.S. sabe sobre o próprio núcleo, para não inventar nem pesquisar na web.
// Cores em packages/nucleo/src/index.ts (apps/desktop/src/nucleo3d.ts só repassa o pacote):
// memória e lição usam o mesmo ciano #7fd8ff (a lição entra em definirMemorias, sem material próprio);
// projeto e tarefa a fazer: dourado #ffc56b; fazendo: azul #5aa9ff; concluída: verde #5cf29a.
// Pulso criado #6be3b0, apagado #ff6b81; pulso neutro não troca a cor (fica a do estado).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Fatos do núcleo. No máximo 900 caracteres. O chamador junta a contagem ao vivo. */
export const SOBRE_O_NUCLEO = [
  'Núcleo (cérebro 3D). Cada nó é um dado real do dono. Cada pulso é um evento real: verde = algo criado, vermelho = algo apagado; nos outros a descarga fica na cor do estado (também ao começar a pensar).',
  '- Memórias: pontos ciano, um por memória. Importância de 1 a 10: quanto maior, maior o ponto e mais perto do centro. A posição é fixa, pelo id.',
  '- Lições do like e do deslike: a mesma cor ciano, no mesmo grupo das memórias. Não são projetos e não têm cor própria. Nascem com importância 4 e crescem até 10 conforme são usadas, então brilham mais. Um ponto ciano novo, perto da esfera, costuma ser uma lição.',
  '- Projetos ativos: nós dourados, mais afastados. Brilham mais conforme o progresso. Concluído ou arquivado não aparece.',
  '- Tarefas desse projeto, pontinhos ligados ao nó: dourado = a fazer, azul = fazendo, verde = concluída.',
  'Partículas soltas no fundo são só ambiente, não são dados.',
].join('\n');

/**
 * Pergunta sobre o próprio app, já com `normalizar` de sensivel.ts (sem acento, minúsculas).
 * "Nó" sozinho não entra: também é nó de gravata. Exige núcleo, lição visual ou o próprio J.A.R.V.I.S.
 */
export const PERGUNTA_SOBRE_SI =
  /\b(nucleo|cerebro|pulsos?|bolinhas|nos do nucleo|no do nucleo|nos no nucleo|no no nucleo|esses nos|novos nos|outros nos|pontos (dourados|azuis|verdes))\b|\bjarvis\b.{0,48}\b(funciona|consegue|sabe|abas?|botao|tela|versao|o que voce e)\b|\b(funciona|consegue|sabe|abas?|botao|tela|versao)\b.{0,48}\bjarvis\b|\bvoce (consegue|sabe|pode)\b/;

const qtd = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Linha com o que está no núcleo agora, nas mesmas tabelas que o app desenha.
 * `semSensivel`: a resposta pode ir ao Gemini; lição sensível não entra (igual a `blocoLicoes`).
 * O núcleo desenha toda lição ativa, de qualquer escopo — o filtro por escopo do prompt é outra coisa.
 */
export async function contagemDoNucleo(sb: SupabaseClient, semSensivel = false): Promise<string> {
  let licoesConta = sb.from('assistant_lessons').select('id', { count: 'exact', head: true })
    .eq('active', true).is('deleted_at', null);
  let licoesNovas = sb.from('assistant_lessons').select('lesson')
    .eq('active', true).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(3);
  if (semSensivel) {
    licoesConta = licoesConta.eq('sensitive', false);
    licoesNovas = licoesNovas.eq('sensitive', false);
  }
  const [mem, lic, novas, proj] = await Promise.all([
    sb.from('memories').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    licoesConta,
    licoesNovas,
    sb.from('projects').select('id').is('deleted_at', null).eq('archived', false).neq('status', 'concluido'),
  ]);
  const ids = ((proj.data ?? []) as { id: string }[]).map((p) => p.id);
  const tar = ids.length
    ? await sb.from('tasks').select('id', { count: 'exact', head: true })
      .is('deleted_at', null).eq('archived', false).in('project_id', ids)
    : { count: 0 };
  const linha = `Agora: ${qtd(mem.count ?? 0, 'memória', 'memórias')}, ${qtd(lic.count ?? 0, 'lição', 'lições')}, ${qtd(ids.length, 'projeto ativo', 'projetos ativos')} com ${qtd(tar.count ?? 0, 'tarefa', 'tarefas')}.`;
  const textos = ((novas.data ?? []) as { lesson: string }[])
    .map((l) => l.lesson.replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean);
  return textos.length ? `${linha} Lições mais novas: ${textos.map((t) => `"${t}"`).join('; ')}.` : linha;
}
