// Resumo para falar: quando a pergunta foi feita por voz, a tela mostra a resposta completa e o
// J.A.R.V.I.S. fala só um resumo curto. A voz do PC (Piper pt-BR) só sabe ler português, então
// as palavras em inglês vão escritas como se pronunciam ("pike" → "páique").
// Só Groq: a resposta pode ter assunto sensível, e sensível nunca vai para o Gemini grátis.
import { conversar } from './provedores.ts';

const SISTEMA = [
  'Você é o J.A.R.V.I.S. e vai FALAR em voz alta com o dono. A resposta completa já está na tela dele.',
  'Escreva só o que vai ser dito: um resumo curto, direto e coerente da resposta, em 1 a 3 frases (no máximo 45 palavras), em português do Brasil.',
  'Tom: calmo, confiante, elegante, um pouco distante. Pode chamar o dono de "Senhor" no máximo uma vez.',
  '- Texto para falar: sem Markdown, listas, emojis, links, citações [n], código ou tabelas.',
  '- Vá ao essencial: a resposta em si, a decisão ou o número que importa. Se houver passos, listas ou detalhes, diga que estão na tela.',
  '- Mantenha os fatos da resposta. Não acrescente nada que não esteja nela.',
  '- PRONÚNCIA (importante): o leitor de voz só sabe ler português. Toda palavra ou nome em inglês deve ser escrito do jeito que se fala, com grafia do português. Exemplos: "bags" → "bégs", "pike" → "páique", "hood" → "rúd", "Medieval Dynasty" → "Midíval Dáinasti", "Steam" → "Stím", "Windows" → "Uíndous", "upgrade" → "âpgreide", "The Witcher" → "Dâ Uítcher". Palavras em português ficam normais.',
  '- Números e unidades do jeito que se fala ("10 kg" → "dez quilos").',
].join('\n');

/** Limpa o que não deve ser lido (caso o modelo escape alguma marcação). */
function limpar(texto: string): string {
  return texto
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\d{1,2}\]/g, '')
    .replace(/[*_#`>|]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*["“]|["”]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function resumoFalado(pergunta: string, resposta: string): Promise<string | null> {
  const r = await conversar('groq', [
    { role: 'system', content: SISTEMA },
    { role: 'user', content: `Pergunta do dono: ${pergunta.slice(0, 600)}\n\nResposta completa (na tela):\n${resposta.slice(0, 6000)}` },
  ], { temperatura: 0.3, maxTokens: 400 });
  if (!r.ok) {
    console.warn('fala: resumo falhou', r.erro);
    return null;
  }
  const fala = limpar(r.texto);
  return fala.length >= 3 ? fala.slice(0, 600) : null;
}
