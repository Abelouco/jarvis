// Roteador (regras locais, instantâneo: não gasta uma chamada de IA para decidir).
// pesquisa    -> PADRÃO: busca na web e responde só com o que as fontes dizem.
// rapido      -> Groq, sem busca: conversa trivial, perguntas sobre o J.A.R.V.I.S., hora/data.
// inteligente -> sem busca, com raciocínio: assuntos do próprio dono (planejar a semana dele,
//                organizar a rotina dele) e pedidos de escrever/reescrever textos.
// Conteúdo sensível nunca vai para a busca (isso é decidido no index.ts).
import { normalizar } from './sensivel.ts';

export type Rota = 'rapido' | 'inteligente' | 'pesquisa';

const PEDE_RACIOCINIO =
  /\b(planej\w*|analis\w*|analise\w*|compar\w*|estrateg\w*|passo a passo|detalhad\w*|em detalhes?|explique|explica\w*|por que|resum\w*|escrev\w*|redij\w*|redig\w*|elabor\w*|cri[ea] um\w*|mont[ea] um\w*|calcul\w*|pros e contras|vantagens|desvantagens|avali\w*|revis\w*|traduz\w*|otimiz\w*|cronograma|roteiro|organiz\w*|prioriz\w*|decid\w*)\b/;

// Pedido explícito de pesquisa.
const PEDE_BUSCA = /\b(pesquis\w*|procur\w* (na|no) (internet|web|google)|busc\w* (na|no) (internet|web|google)|na internet|fontes?|confira|verifique)\b/;

// Fatos do mundo que mudam ou que o modelo costuma inventar (mesmo se a frase tiver "meu/minha").
const FATO_DO_MUNDO =
  /\b(jogo|game|no jogo|dlc|mod\b|patch|update|atualizacao|versao|lancament\w*|lanca\w*|preco\w*|quanto custa|onde comprar|noticia\w*|ontem|esta semana|atualmente|ultim[oa]s?|recente\w*|20[2-3]\d|quem (e|foi|ganhou|venceu|criou|fundou|inventou) (?!voce\b|eu\b|vc\b)\S|quando (e|foi|sera|vai|sai|saiu|comeca)|onde fica|horario de|placar|resultado d\w*|cotacao|clima em|previsao do tempo|requisitos|especificac\w*|ficha tecnica|receita de|como (fazer|conseguir|craftar|criar|desbloquear|obter|achar|encontrar|pegar|construir|evoluir|upar|derrotar|chegar)\b[^?]*\b(no|na|em|do|da|dos|das)\b)/;

// Nome próprio de duas ou mais palavras no meio da frase (ex.: "Medieval Dynasty").
const NOME_PROPRIO = /\s(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}\d'’-]+\s+){1,4}[A-ZÁÉÍÓÚÂÊÔÃÕÇ\d][\p{L}\d'’-]*/u;

// Não precisa de busca:
const TRIVIAL = /^(oi+|ola|opa|e ai|eai|hey|bom dia|boa tarde|boa noite|obrigad\w*|valeu|vlw|ok|okay|beleza|blz|show|perfeito|otimo|legal|tudo bem|td bem|tchau|ate mais|ate logo|sim|nao|isso|entendi|certo)\b/;
const SOBRE_JARVIS = /\b(quem e voce|quem (e|sao) vc|seu nome|o que voce (faz|sabe|pode)|voce (consegue|pode|sabe|lembra)|o que significa jarvis|j\.?a\.?r\.?v\.?i\.?s\.? significa)\b/;
// Perguntas sobre o núcleo 3D do próprio J.A.R.V.I.S. (não sobre física em geral).
const SOBRE_O_NUCLEO = /\b(nucleo|seu cerebro|(esses?|essas?|os|as|cada) (nos|no|pulsos?|filamentos?|aneis|anel|linhas|pontos|particulas)\b|nos de memoria|por que (a esfera|o nucleo|voce) (ficou|esta|mudou|piscou|pulsou)|(ficou|esta|mudou para) (azul|violeta|roxo|roxa|ambar|vermelho|vermelha|verde)|essa cor)\b/;
const AGORA = /\b(que horas|que dia e hoje|data de hoje|que dia da semana)\b/;
const SOBRE_O_DONO = /\b(meu nome|eu sou|eu (trabalho|estudo|moro|gosto|prefiro|tenho|quero|preciso|vou)|me (lembre|lembra)|lembr\w*|esquec\w*|minha (semana|rotina|agenda|vida|casa|familia|tarefa|lista|meta|dieta)|meu (dia|mes|plano|objetivo|treino|projeto))\b/;
const CRIATIVO = /\b(escrev\w*|redij\w*|redig\w*|reescrev\w*|cri[ea] (um|uma) (texto|mensagem|poema|historia|post|legenda|email|e-mail|carta|roteiro|discurso)|traduz\w*|melhor[ea] (este|esse|o) texto|corrij\w*|revis\w* (este|esse|o) texto)\b/;

export function precisaPesquisar(texto: string): boolean {
  return escolherRota(texto) === 'pesquisa';
}

export function escolherRota(texto: string): Rota {
  const t = normalizar(texto).trim();
  const palavras = t.split(/\s+/).filter(Boolean).length;

  if (PEDE_BUSCA.test(t)) return 'pesquisa';
  if ((TRIVIAL.test(t) && palavras <= 6) || SOBRE_JARVIS.test(t) || SOBRE_O_NUCLEO.test(t) || AGORA.test(t)) return 'rapido';
  if (FATO_DO_MUNDO.test(t) || NOME_PROPRIO.test(` ${texto.trim()}`.replace(/^\s*\S+/, ' '))) return 'pesquisa';
  if (CRIATIVO.test(t) || SOBRE_O_DONO.test(t)) {
    return PEDE_RACIOCINIO.test(t) || t.length > 300 ? 'inteligente' : 'rapido';
  }
  // Resposta curtíssima sem pergunta (ex.: "faz sentido", "pode ser"): continua a conversa.
  if (palavras <= 3 && !t.includes('?')) return 'rapido';
  // Todo o resto: pesquisa (o dono quer respostas confirmadas em fontes).
  return 'pesquisa';
}
