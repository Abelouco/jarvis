// J.A.R.V.I.S. · Edge Function `ia_conversar`
// Recebe a mensagem do dono, guarda no banco (RLS do próprio usuário), escolhe o caminho
// (rápido = Groq, inteligente = Gemini Flash), troca de provedor quando um bate o limite
// e devolve a resposta já gravada. As chaves de IA ficam só nos secrets do Supabase.
//
// Secrets: GROQ_API_KEY, GEMINI_API_KEY (opcionais um do outro), GROQ_MODEL e GEMINI_MODEL (opcionais).
// Regra de ouro: conteúdo sensível nunca vai para o Gemini grátis (pode treinar com os dados).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { avaliarSensibilidade } from './sensivel.ts';
import { escolherRota, type Rota } from './rota.ts';
import {
  conversar, pesquisarGemini, pesquisarGroq, temChave, type Fonte, type MensagemIA, type NomeProvedor,
} from './provedores.ts';
import { aprender, blocoMemoria, lembrar } from './memoria.ts';

// Trabalho depois da resposta (aprender), sem atrasar o chat. Existe no runtime do Supabase.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const MAX_TEXTO = 4000;
const HISTORICO = 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function promptSistema(rota: Rota, pesquisando = false) {
  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return [
    'Você é o J.A.R.V.I.S., assistente pessoal e co-piloto do seu dono: ajuda a pensar, decidir e agir. Fale sempre em português do Brasil.',
    'J.A.R.V.I.S. significa "Just a Rather Very Intelligent System". Explique isso se perguntarem sobre o seu nome.',
    'Tom: calmo, confiante, um pouco distante e elegante; direto ao ponto, sem bajulação e sem enrolação.',
    rota === 'inteligente'
      ? 'Este pedido pede raciocínio: aprofunde o necessário, com estrutura clara.'
      : rota === 'pesquisa'
        ? 'Este pedido é sobre fatos do mundo: seja preciso e completo, sem enrolação.'
        : 'Respostas curtas por padrão (1 a 4 frases); só se estenda quando pedirem detalhe.',
    ...(pesquisando
      ? [
        '',
        'PESQUISA: use a busca na web antes de responder.',
        '- Responda SOMENTE com o que as fontes encontradas confirmam. Não complete lacunas com suposições.',
        '- Confirme cada informação importante em pelo menos 2 fontes independentes. Se só achar em uma, diga "segundo uma fonte". Se as fontes divergirem, mostre a divergência.',
        '- Se não encontrar a resposta, diga claramente que não encontrou, em vez de chutar.',
        '- Para jogos e produtos, use os nomes exatos de itens, menus e materiais como aparecem nas fontes (e o nome em inglês entre parênteses quando o jogo for em inglês).',
        '- Não escreva lista de links nem seção de fontes: o app mostra as fontes embaixo da resposta.',
      ]
      : rota === 'pesquisa'
        ? ['', 'Não foi possível pesquisar na web agora. Sobre fatos específicos, diga claramente o que não tem certeza em vez de afirmar.']
        : []),
    '',
    'Formatação (Markdown; o app desenha tudo, então use-a sempre que ajudar a ler):',
    '- Resposta curta: texto direto, sem títulos.',
    '- Resposta longa: seções com "## Título" e subtópicos com "### Título".',
    '- Passos e sequências: lista numerada. Itens soltos: lista com "-".',
    '- Comparações, números, prós e contras lado a lado, efeitos, cronogramas: tabela Markdown.',
    '- **Negrito** no que importa: valores, prazos, a decisão.',
    '- Código: bloco ``` com a linguagem (```python, ```typescript...).',
    '- Comandos para o dono rodar no computador dele (Windows): cada passo num bloco ```powershell (ou ```cmd, se for do Prompt de comando), sem "$" ou "PS>" na frente. O app mostra um botão para rodar; um bloco por passo que ele deva rodar separado.',
    '- Quando houver uma próxima escolha clara para o dono (2 a 4 caminhos), termine com um bloco que abre com ```opcoes seguido de uma pergunta curta na mesma linha, uma opção por linha, e fecha com ``` (ex.: ```opcoes Por onde seguimos?). Cada opção deve funcionar sozinha como a resposta do dono. Não use em toda resposta, só quando ajudar a decidir o próximo passo; se usar, não repita as mesmas coisas em "Próximos passos".',
    '- Texto para o dono copiar e usar (mensagem, e-mail, post, legenda, documento, roteiro, prompt): coloque SÓ esse texto dentro de um bloco que abre com ```texto seguido de um título curto na mesma linha (ex.: ```texto E-mail para o síndico) e fecha com ```. Dentro desse bloco, texto puro e pronto para colar: sem Markdown, sem ** nem #. Fora do bloco, no máximo 1 ou 2 frases.',
    '- Contas: mostre a conta em uma linha e o resultado em negrito.',
    '- Alerta importante: linha começando com "> ".',
    '',
    'Como co-piloto: vá direto ao que resolve. Em decisões, termine com "**Recomendação:**" e o porquê em uma frase.',
    'Quando houver o que fazer, termine com "**Próximos passos:**" em lista numerada curta. Pergunte só o indispensável.',
    'Se não souber algo, diga. Nunca invente fatos sobre o dono nem detalhes do mundo (jogos, produtos, versões, regras, números): sem certeza, diga que não tem certeza.',
    'Você tem memória de longo prazo: o app guarda sozinho fatos e preferências do dono depois de cada conversa, e o que você já sabe aparece abaixo. Se o dono pedir para lembrar ou esquecer algo, confirme em uma frase que vai fazer isso.',
    `Agora é ${agora} (fuso America/Sao_Paulo). Para pessoas, escreva datas do jeito natural (ex.: "sábado, 23/11", "23 de novembro"); AAAA-MM-DD só em dados técnicos ou tabelas.`,
  ].join('\n');
}

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Conta uma chamada (e os tokens) do provedor no dia. */
async function registrarUso(sb: SupabaseClient, userId: string, provedor: NomeProvedor, tokens: number) {
  const day = hojeSP();
  const { data } = await sb.from('ai_usage').select('requests, tokens')
    .eq('day', day).eq('provider', provedor).maybeSingle();
  await sb.from('ai_usage').upsert(
    { user_id: userId, day, provider: provedor, requests: (data?.requests ?? 0) + 1, tokens: (data?.tokens ?? 0) + tokens },
    { onConflict: 'user_id,day,provider' },
  );
}

/** Marca o provedor como sem cota até daqui a `segundos`. */
async function bloquear(sb: SupabaseClient, userId: string, provedor: NomeProvedor, segundos: number) {
  await sb.from('ai_usage').upsert(
    { user_id: userId, day: hojeSP(), provider: provedor, blocked_until: new Date(Date.now() + segundos * 1000).toISOString() },
    { onConflict: 'user_id,day,provider' },
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder(405, { erro: 'Use POST.' });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return responder(401, { erro: 'Faça login.' });

  // Cliente com o token do próprio usuário: tudo passa pela RLS.
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: u, error: erroUser } = await sb.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  if (erroUser || !u.user) return responder(401, { erro: 'Sessão inválida. Entre de novo.' });
  const userId = u.user.id;

  let corpo: { conversation_id?: string; message_id?: string; text?: string };
  try {
    corpo = await req.json();
  } catch {
    return responder(400, { erro: 'Corpo inválido.' });
  }
  const texto = (corpo.text ?? '').trim();
  if (!corpo.conversation_id || !UUID.test(corpo.conversation_id)) return responder(400, { erro: 'conversation_id inválido.' });
  if (!corpo.message_id || !UUID.test(corpo.message_id)) return responder(400, { erro: 'message_id inválido.' });
  if (!texto) return responder(400, { erro: 'Mensagem vazia.' });
  if (texto.length > MAX_TEXTO) return responder(400, { erro: `Mensagem longa demais (máx. ${MAX_TEXTO} caracteres).` });

  if (!temChave('groq') && !temChave('gemini')) {
    return responder(503, { erro: 'Nenhuma chave de IA configurada no Supabase (GROQ_API_KEY / GEMINI_API_KEY).' });
  }

  const sens = avaliarSensibilidade(texto);

  // Idempotente: se o app já sincronizou a conversa/mensagem, não duplica.
  const conv = await sb.from('conversations')
    .upsert({ id: corpo.conversation_id, title: texto.slice(0, 60) }, { onConflict: 'id', ignoreDuplicates: true });
  if (conv.error) return responder(500, { erro: conv.error.message });
  const msg = await sb.from('messages')
    .upsert({ id: corpo.message_id, conversation_id: corpo.conversation_id, role: 'user', content: texto, sensitive: sens.sensivel },
      { onConflict: 'id', ignoreDuplicates: true });
  if (msg.error) return responder(500, { erro: msg.error.message });
  // Se o app subiu a pergunta antes (sem a marca), marca agora.
  if (sens.sensivel) await sb.from('messages').update({ sensitive: true }).eq('id', corpo.message_id);

  // A pergunta como está no servidor (o horário dela define o que vem "antes" e "depois").
  const pergunta = await sb.from('messages')
    .select('created_at').eq('id', corpo.message_id).single();
  if (pergunta.error) return responder(500, { erro: pergunta.error.message });

  // Já respondida (por outro aparelho ou numa tentativa anterior que caiu no meio)? Devolve a mesma.
  const jaRespondida = await sb.from('messages')
    .select('*')
    .eq('conversation_id', corpo.conversation_id)
    .eq('role', 'assistant')
    .is('deleted_at', null)
    .gt('created_at', pergunta.data.created_at)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (jaRespondida.data) return responder(200, { mensagem: jaRespondida.data, repetida: true });

  // Pulso de "pensando" no cérebro.
  await sb.from('events').insert({ kind: 'thinking', payload: { conversation_id: corpo.conversation_id } });

  // Histórico até a pergunta (inclusive): a resposta é sempre para ela, mesmo se chegou outra depois.
  const hist = await sb.from('messages')
    .select('role, content, sensitive')
    .eq('conversation_id', corpo.conversation_id)
    .is('deleted_at', null)
    .lte('created_at', pergunta.data.created_at)
    .order('created_at', { ascending: false })
    .limit(HISTORICO);
  if (hist.error) return responder(500, { erro: hist.error.message });
  const historico = (hist.data ?? []).reverse();

  // O histórico inteiro vai junto na chamada: se qualquer parte for sensível, a conversa toda é.
  const conversaSensivel = sens.sensivel
    || historico.some((m) => m.sensitive || avaliarSensibilidade(m.content).sensivel);
  const rota = escolherRota(texto);
  const ordem: NomeProvedor[] = conversaSensivel
    ? ['groq'] // nunca Gemini
    : rota === 'rapido' ? ['groq', 'gemini'] : ['gemini', 'groq'];

  // Memória: o que ele já sabe e que tem a ver com a pergunta. Sensível nunca vai para o Gemini.
  const memorias = await lembrar(sb, texto).catch(() => []);
  const conversa: MensagemIA[] = historico.map((m) => ({ role: m.role, content: m.content }));
  const sistemaPara = (provedor: NomeProvedor, pesquisando = false) => {
    const bloco = blocoMemoria(memorias, provedor === 'gemini' || pesquisando);
    return promptSistema(rota, pesquisando) + (bloco ? `\n\n${bloco}` : '');
  };
  const mensagensPara = (provedor: NomeProvedor): MensagemIA[] => [
    { role: 'system', content: sistemaPara(provedor) },
    ...conversa,
  ];

  const { data: bloqueios } = await sb.from('ai_usage')
    .select('provider, blocked_until')
    .gt('blocked_until', new Date().toISOString());
  const bloqueadoAte = new Map((bloqueios ?? []).map((b) => [b.provider as NomeProvedor, b.blocked_until as string]));

  const inicio = Date.now();
  const erros: string[] = [];
  let menorEspera = 0;
  let resposta: { provedor: NomeProvedor; texto: string; modelo: string; fontes?: Fonte[] } | null = null;
  let rotaUsada: Rota = rota;

  // Pesquisa na web (nunca com assunto sensível: a pergunta iria para a busca).
  if (rota === 'pesquisa' && !conversaSensivel) {
    const tentativas: [NomeProvedor, () => Promise<import('./provedores.ts').Resultado>][] = [
      ['gemini', () => pesquisarGemini(sistemaPara('gemini', true), conversa)],
      ['groq', () => pesquisarGroq(sistemaPara('groq', true), conversa)],
    ];
    for (const [provedor, pesquisar] of tentativas) {
      if (!temChave(provedor) || bloqueadoAte.get(provedor)) continue;
      const r = await pesquisar();
      if (r.ok) {
        resposta = { provedor, texto: r.texto, modelo: r.modelo, fontes: r.fontes };
        await registrarUso(sb, userId, provedor, r.tokens);
        break;
      }
      erros.push(r.erro);
      console.warn('ia_conversar: pesquisa falhou', { provedor, erro: r.erro });
      if (r.limite) await bloquear(sb, userId, provedor, r.esperarSeg);
    }
  }
  // Sem pesquisa (ou ela falhou): responde normalmente, avisando quando não tiver certeza.
  if (!resposta && rota === 'pesquisa') rotaUsada = 'inteligente';

  for (const provedor of resposta ? [] : ordem) {
    if (!temChave(provedor)) continue;
    const ate = bloqueadoAte.get(provedor);
    if (ate) {
      const seg = Math.ceil((Date.parse(ate) - Date.now()) / 1000);
      menorEspera = menorEspera ? Math.min(menorEspera, seg) : seg;
      erros.push(`${provedor} sem cota por mais ${seg} s`);
      continue;
    }
    const r = await conversar(provedor, mensagensPara(provedor));
    if (r.ok) {
      resposta = { provedor, texto: r.texto, modelo: r.modelo };
      await registrarUso(sb, userId, provedor, r.tokens);
      break;
    }
    erros.push(r.erro);
    console.warn('ia_conversar: provedor falhou, tentando o próximo', { provedor, rota, erro: r.erro });
    if (r.limite) {
      await bloquear(sb, userId, provedor, r.esperarSeg);
      menorEspera = menorEspera ? Math.min(menorEspera, r.esperarSeg) : r.esperarSeg;
    }
  }

  if (!resposta) {
    console.error('ia_conversar sem resposta', { rota, conversaSensivel, erros });
    const espera = menorEspera ? ` Tente de novo em ${menorEspera < 90 ? `${menorEspera} s` : `${Math.ceil(menorEspera / 60)} min`}.` : '';
    const erro = conversaSensivel && menorEspera
      ? `O Groq está sem cota agora e esta conversa tem assunto sensível, então não envio para o Gemini.${espera}`
      : menorEspera
        ? `As IAs estão sem cota no momento.${espera}`
        : `Não consegui resposta da IA (${erros.join('; ')}).`;
    return responder(menorEspera ? 429 : 502, { erro });
  }

  const salva = await sb.from('messages')
    .insert({
      conversation_id: corpo.conversation_id, role: 'assistant', content: resposta.texto,
      provider: resposta.provedor, model: resposta.modelo, latency_ms: Date.now() - inicio,
      route: resposta.fontes?.length || (rotaUsada === 'pesquisa') ? 'pesquisa' : rotaUsada,
      sensitive: conversaSensivel,
      sources: resposta.fontes?.length ? resposta.fontes : null,
    })
    .select()
    .single();
  if (salva.error) return responder(500, { erro: salva.error.message });

  // Aprende com esta troca depois de responder (não atrasa o chat).
  if (texto.length >= 8) {
    const tarefa = aprender(sb, userId, {
      pergunta: texto, resposta: resposta.texto, perguntaId: corpo.message_id, sensivel: conversaSensivel,
    }, memorias).catch((e) => console.warn('memoria: erro', e instanceof Error ? e.message : e));
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(tarefa);
    else await tarefa;
  }

  return responder(200, { mensagem: salva.data });
});
