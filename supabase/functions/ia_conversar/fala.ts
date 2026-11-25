// Resumo para falar: quando a pergunta foi feita por voz, a tela mostra a resposta completa e o
// J.A.R.V.I.S. fala a resposta inteira, resumida (quem só ouvir
// precisa ficar sabendo a resposta). A voz do PC (Piper pt-BR) só sabe ler português, então as palavras em inglês vão escritas como se pronunciam ("pike" → "páique").
// Só Groq: a resposta pode ter assunto sensível, e sensível nunca vai para o Gemini grátis.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { conversar } from './provedores.ts';

const SISTEMA = [
  'Você é o J.A.R.V.I.S. e vai FALAR em voz alta com o dono.',
  'Escreva só o que vai ser dito: a resposta completa, mas resumida, direta e coerente, em português do Brasil. O dono pode não estar olhando a tela: ele precisa sair sabendo a resposta só de ouvir.',
  'Tamanho: o mínimo para responder por inteiro (em geral 2 a 5 frases, até uns 90 palavras). Inclua o que é essencial: a resposta, os itens/materiais/passos principais em poucas palavras, os números que importam.',
  '- NUNCA diga que algo está na tela, no app ou que há mais detalhes em outro lugar.',
  'Tom: calmo, confiante, elegante, um pouco distante. Pode chamar o dono de "Senhor" no máximo uma vez.',
  '- Texto para falar: sem Markdown, listas, emojis, links, citações [n], código ou tabelas.',
  '- Passos e listas viram uma frase corrida (ex.: "primeiro..., depois..., por fim..."). Corte enfeites e repetições, nunca o que é preciso para responder.',
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

/** Pronúncias que o dono ensinou (guardadas na memória: "X se pronuncia \"Y\""). */
export async function pronunciasEnsinadas(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb.from('memories').select('content').is('deleted_at', null)
    .ilike('content', '%se pronuncia%').order('updated_at', { ascending: false }).limit(40);
  return (data ?? []).map((m: { content: string }) => m.content.slice(0, 200));
}

export async function resumoFalado(pergunta: string, resposta: string, pronuncias: string[] = []): Promise<string | null> {
  const ensinadas = pronuncias.length
    ? `\n- PRONÚNCIAS ENSINADAS PELO DONO (use exatamente esta grafia ao falar esses nomes; valem mais que os exemplos acima):\n${pronuncias.map((p) => `  - ${p}`).join('\n')}`
    : '';
  const r = await conversar('groq', [
    { role: 'system', content: SISTEMA + ensinadas },
    { role: 'user', content: `Pergunta do dono: ${pergunta.slice(0, 600)}\n\nResposta completa:\n${resposta.slice(0, 6000)}` },
  ], { temperatura: 0.3, maxTokens: 600 });
  if (!r.ok) {
    console.warn('fala: resumo falhou', r.erro);
    return null;
  }
  const fala = limpar(r.texto);
  return fala.length >= 3 ? fala.slice(0, 900) : null;
}
