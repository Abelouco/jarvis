// Roteador rápido/inteligente (regras locais, instantâneo: não gasta uma chamada de IA para decidir).
// rapido      -> Groq (resposta em ~0,5 s)
// inteligente -> Gemini Flash (raciocínio mais longo), se o conteúdo não for sensível
import { normalizar } from './sensivel.ts';

export type Rota = 'rapido' | 'inteligente';

const PEDE_RACIOCINIO =
  /\b(planej\w*|analis\w*|analise\w*|compar\w*|estrateg\w*|passo a passo|detalhad\w*|em detalhes?|explique|explica\w*|por que|como funciona\w*|resum\w*|escrev\w*|redij\w*|redig\w*|elabor\w*|cri[ea] um\w*|mont[ea] um\w*|calcul\w*|codigo|programa\w*|debug\w*|pros e contras|vantagens|desvantagens|avali\w*|revis\w*|traduz\w*|otimiz\w*|cronograma|roteiro|organiz\w* (minha|meu|a|o)|prioriz\w*|decid\w*|devo (fazer|escolher|comprar)|qual (e )?(a )?melhor)\b/;

export function escolherRota(texto: string): Rota {
  const t = normalizar(texto);
  if (t.length > 300) return 'inteligente';
  if ((t.match(/\?/g) ?? []).length >= 2) return 'inteligente';
  if (t.split('\n').filter((l) => l.trim()).length >= 4) return 'inteligente';
  if (PEDE_RACIOCINIO.test(t)) return 'inteligente';
  return 'rapido';
}
