// Roteador (regras locais, instantâneo: não gasta uma chamada de IA para decidir).
// rapido      -> Groq (resposta em ~0,5 s)
// inteligente -> Gemini Flash (raciocínio mais longo), se o conteúdo não for sensível
// pesquisa    -> Gemini com Google Search (fatos do mundo: jogos, produtos, notícias...),
//                resposta baseada em fontes; se o conteúdo for sensível, não pesquisa.
import { normalizar } from './sensivel.ts';

export type Rota = 'rapido' | 'inteligente' | 'pesquisa';

const PEDE_RACIOCINIO =
  /\b(planej\w*|analis\w*|analise\w*|compar\w*|estrateg\w*|passo a passo|detalhad\w*|em detalhes?|explique|explica\w*|por que|como funciona\w*|resum\w*|escrev\w*|redij\w*|redig\w*|elabor\w*|cri[ea] um\w*|mont[ea] um\w*|calcul\w*|codigo|programa\w*|debug\w*|pros e contras|vantagens|desvantagens|avali\w*|revis\w*|traduz\w*|otimiz\w*|cronograma|roteiro|organiz\w* (minha|meu|a|o)|prioriz\w*|decid\w*|devo (fazer|escolher|comprar)|qual (e )?(a )?melhor)\b/;

// Pedido explícito de pesquisa.
const PEDE_BUSCA = /\b(pesquis\w*|procur\w* (na|no) (internet|web|google)|busc\w* (na|no) (internet|web|google)|na internet|fontes?|confira|verifique)\b/;

// Fatos do mundo que mudam ou que o modelo costuma inventar.
const FATO_DO_MUNDO =
  /\b(jogo|game|no jogo|dlc|mod\b|patch|update|atualizacao|versao|lancament\w*|lanca\w*|preco\w*|quanto custa|onde comprar|noticia\w*|hoje|ontem|esta semana|atualmente|ultim[oa]s?|recente\w*|20[2-3]\d|quem (e|foi|ganhou|venceu|criou|fundou|inventou) (?!voce\b|eu\b|vc\b)\S|quando (e|foi|sera|vai|sai|saiu|comeca)|onde fica|horario\w*|placar|resultado d\w*|cotacao|clima em|previsao do tempo|requisitos|especificac\w*|ficha tecnica|receita de|como (fazer|conseguir|craftar|criar|desbloquear|obter|achar|encontrar|pegar|construir|evoluir|upar|derrotar|chegar)\b[^?]*\b(no|na|em|do|da|dos|das)\b)/;

// Nome próprio de duas ou mais palavras no meio da frase (ex.: "Medieval Dynasty").
const NOME_PROPRIO = /\s(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}\d'’-]+\s+){1,4}[A-ZÁÉÍÓÚÂÊÔÃÕÇ\d][\p{L}\d'’-]*/u;
const E_PERGUNTA = /\?|^(como|qual|quais|quem|quando|onde|quanto|quantos|quantas|o que|existe|tem como|da para|e verdade)\b/;

export function precisaPesquisar(texto: string): boolean {
  const t = normalizar(texto);
  if (PEDE_BUSCA.test(t)) return true;
  if (FATO_DO_MUNDO.test(t)) return true;
  return E_PERGUNTA.test(t.trim()) && NOME_PROPRIO.test(` ${texto.trim()}`.replace(/^\s*\S+/, ' '));
}

export function escolherRota(texto: string): Rota {
  if (precisaPesquisar(texto)) return 'pesquisa';
  const t = normalizar(texto);
  if (t.length > 300) return 'inteligente';
  if ((t.match(/\?/g) ?? []).length >= 2) return 'inteligente';
  if (t.split('\n').filter((l) => l.trim()).length >= 4) return 'inteligente';
  if (PEDE_RACIOCINIO.test(t)) return 'inteligente';
  return 'rapido';
}
