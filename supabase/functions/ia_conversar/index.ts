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
import { blocoTrechos, buscar, fontesDe, temBusca, type PesquisaAnterior, type Trecho } from './busca.ts';
import { pronunciasEnsinadas, resumoFalado } from './fala.ts';
import './lembretes.ts'; // registra as ferramentas de lembretes no planejador
import './projetos.ts'; // idem, projetos e marcos
import './habitos.ts'; // idem, hábitos
import './conhecimento.ts'; // idem, notas, capturas e diário
import {
  carregarAbertas, confirmacaoPendente, contextoExtensoes, executar, pareceTarefa, planejar, textoFinal,
} from './tarefas.ts';

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

function promptSistema(rota: Rota, pesquisando = false, nosDeMemoria = 0, app = '') {
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
        'PESQUISA: a resposta deve vir dos resultados da pesquisa na web (no fim deste texto ou da sua busca).',
        '- Responda SOMENTE com o que os resultados confirmam. Não complete lacunas com conhecimento próprio nem suposições.',
        '- Confirme cada informação importante em pelo menos 2 fontes independentes; cite os números das fontes entre colchetes no fim da frase, ex.: [1][3]. Se só uma fonte disser, escreva "segundo uma fonte [n]". Se as fontes divergirem, mostre a divergência.',
        '- Se os resultados não responderem a pergunta, diga claramente que não encontrou nas fontes, em vez de chutar, e sugira como o dono pode verificar.',
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
    '- `Código inline` para o que o dono pode querer copiar sozinho: nomes exatos (de itens, menus, arquivos, programas), valores, endereços, comandos curtos. O app destaca e deixa copiar com o clique direito.',
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
    '',
    'Seu núcleo (o "cérebro" 3D que aparece no app). Explique quando o dono perguntar, com estes fatos (é tudo real, nada é enfeite):',
    '- Esfera geodésica no centro: é você. Gira mais rápido e brilha mais quando você trabalha.',
    '- Anéis de filamentos de partículas em volta: o seu campo de atividade. Ondulam o tempo todo e se abrem e aceleram quando você pensa, pesquisa ou age.',
    '- Pontos de luz presos à esfera por linhas finas: as memórias que você guardou sobre o dono, um nó por memória. Os mais importantes brilham mais e ficam mais perto do centro; a posição de cada nó é fixa (vem da própria memória). Quando o dono esquece uma memória, o nó some.',
    '- Pontos dourados mais afastados: os projetos do dono, um nó por projeto aberto (brilha mais conforme o progresso); os pontinhos dourados em volta de cada um são as tarefas abertas daquele projeto.',
    '- Partículas soltas no fundo: só ambiente.',
    '- Pulsos (descargas rápidas): cada um é um evento real no banco de dados. Verde = algo foi criado (tarefa, memória...); vermelho = algo foi apagado; branco/neutro = uma mudança ou você começando a pensar.',
    '- Cor contínua do núcleo = seu estado: verde-água em repouso; azul pulsando como um coração = pensando; violeta = pesquisando na internet ou agindo; âmbar com respiração lenta = esperando a permissão do dono; vermelho apagado = deu erro.',
    '- O dono pode girar o núcleo em qualquer direção, arrastando com o mouse ou com o dedo.',
    `- Agora o seu núcleo tem ${nosDeMemoria} ${nosDeMemoria === 1 ? 'nó' : 'nós'} de memória.`,
    '',
    `Você é um projeto pessoal do dono, feito sob medida para ele (não é o software "Jarvis" de outras empresas, nem o do filme). ${app ? `O dono está falando com você pelo app ${app}; essa é a sua versão atual.` : 'Se perguntarem sua versão, diga que ela aparece no app.'} Sobre você mesmo, responda com o que está aqui, nunca com resultados da web.`,
    `Agora é ${agora} (fuso America/Sao_Paulo). Para pessoas, escreva datas do jeito natural (ex.: "sábado, 23/11", "23 de novembro"); AAAA-MM-DD só em dados técnicos ou tabelas.`,
  ].join('\n');
}

/**
 * Mostra embaixo só as fontes citadas na resposta ([n]) e renumera as citações para baterem
 * com essa lista (1, 2, 3...). Se a resposta não citou nenhuma, mostra todas.
 */
function fontesCitadas(original: string, todas: Fonte[]): { texto: string; fontes: Fonte[] } {
  // Alguns modelos escrevem 【7】 ou ［7］ em vez de [7].
  const texto = original.replace(/[【［]\s*(\d{1,2})\s*[】］]/g, '[$1]');
  const citadas = new Set([...texto.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]) - 1));
  const validas = [...citadas].filter((i) => i >= 0 && i < todas.length).sort((a, b) => a - b);
  if (!validas.length) return { texto, fontes: todas };
  const novo = new Map(validas.map((i, k) => [i, k + 1]));
  return {
    texto: texto.replace(/\[(\d{1,2})\]/g, (_m, n) => {
      const k = novo.get(Number(n) - 1);
      return k ? `[${k}]` : '';
    }),
    fontes: validas.map((i) => todas[i]!),
  };
}

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Conta chamadas e tokens do provedor no dia (no Tavily: buscas e créditos gastos). */
async function registrarUso(
  sb: SupabaseClient, userId: string, provedor: NomeProvedor | 'tavily', tokens: number, chamadas = 1,
) {
  const day = hojeSP();
  const { data } = await sb.from('ai_usage').select('requests, tokens')
    .eq('day', day).eq('provider', provedor).maybeSingle();
  await sb.from('ai_usage').upsert(
    { user_id: userId, day, provider: provedor, requests: (data?.requests ?? 0) + chamadas, tokens: (data?.tokens ?? 0) + tokens },
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

  let corpo: { conversation_id?: string; message_id?: string; text?: string; app?: string; voz?: boolean };
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
  // De qual app/versão veio a pergunta (ex.: "PC v0.1.12"); só texto curto e simples.
  const app = String(corpo.app ?? '').replace(/[^\p{L}\p{N} .()+-]/gu, '').slice(0, 60);

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

  const inicioAcao = Date.now();
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
    : rota === 'inteligente' ? ['gemini', 'groq'] : ['groq', 'gemini']; // sem pesquisa: o Groq responde mais rápido

  // Memória: o que ele já sabe e que tem a ver com a pergunta. Sensível nunca vai para o Gemini.
  const memorias = await lembrar(sb, texto).catch(() => []);
  const conversa: MensagemIA[] = historico.map((m) => ({ role: m.role, content: m.content }));
  // Tarefas por conversa: se a mensagem pede uma ação nas tarefas, executa e responde na hora.
  const pendente = await confirmacaoPendente(sb).catch(() => null);
  if (pareceTarefa(texto, !!pendente)) {
    const hoje = hojeSP();
    const [abertas, contexto] = await Promise.all([carregarAbertas(sb), contextoExtensoes(sb)]);
    const plano = await planejar(conversa, hoje, abertas, pendente, conversaSensivel, contexto);
    if (plano.provedor) await registrarUso(sb, userId, plano.provedor, plano.tokens);
    if (plano.acoes.length) {
      await sb.from('events').insert({
        kind: 'tool_call', payload: { conversation_id: corpo.conversation_id, ferramentas: plano.acoes.map((a) => a.ferramenta) },
      });
      const resultados = await executar(sb, plano.acoes, hoje);
      const conteudo = textoFinal(resultados) || 'Feito.';
      const falaPronta = corpo.voz ? pronunciasEnsinadas(sb).catch(() => []).then((p) => resumoFalado(texto, conteudo, p)).catch(() => null) : Promise.resolve(null);
      const salva = await sb.from('messages').insert({
        conversation_id: corpo.conversation_id, role: 'assistant', content: conteudo,
        provider: plano.provedor, model: 'ferramentas', latency_ms: Date.now() - inicioAcao,
        route: 'acao', sensitive: conversaSensivel,
      }).select().single();
      if (salva.error) return responder(500, { erro: salva.error.message });
      console.log('ia_conversar: ferramentas', resultados.map((r) => `${r.ferramenta}:${r.ok ? 'ok' : 'falhou'} ${r.resumo}`));
      return responder(200, { mensagem: salva.data, fala: await falaPronta, ferramentas: resultados });
    }
  }

  const { count: nosDeMemoria } = await sb.from('memories')
    .select('id', { count: 'exact', head: true }).is('deleted_at', null);
  const sistemaPara = (provedor: NomeProvedor, pesquisando = false) => {
    const bloco = blocoMemoria(memorias, provedor === 'gemini' || pesquisando);
    return promptSistema(rota, pesquisando, nosDeMemoria ?? 0, app) + (bloco ? `\n\n${bloco}` : '');
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

  // Pesquisa na web pelo Tavily (nunca com assunto sensível: a pergunta iria para a busca).
  if (rota === 'pesquisa' && !conversaSensivel && temBusca()) {
    // Avisa os aparelhos: o chat mostra "Pesquisando na internet…" e o núcleo fica violeta.
    await sb.from('events').insert({ kind: 'searching', payload: { conversation_id: corpo.conversation_id } });
    // Memória de pesquisas: se algo igual já foi pesquisado, reaproveita (rápido e sem crédito).
    const perguntaAnterior = [...conversa].reverse().find((m, i) => i > 0 && m.role === 'user')?.content ?? '';
    const { data: anteriores } = await sb.rpc('buscar_pesquisas', {
      consulta: `${texto} ${perguntaAnterior}`.slice(0, 600), limite: 3,
    });
    const carregar = async (id: string) => {
      const { data } = await sb.from('web_searches').select('results, reused').eq('id', id).maybeSingle();
      if (data) await sb.from('web_searches').update({ reused: (data.reused ?? 0) + 1 }).eq('id', id);
      return (data?.results as Trecho[] | undefined) ?? null;
    };
    const { trechos, creditos, consultas, reusada } = await buscar(conversa, (anteriores ?? []) as PesquisaAnterior[], carregar)
      .catch((e) => {
        erros.push(`busca: ${e instanceof Error ? e.message : e}`);
        return { trechos: [] as Trecho[], creditos: 0, consultas: [] as string[], reusada: null };
      });
    if (creditos) await registrarUso(sb, userId, 'tavily', creditos, creditos);
    if (reusada) console.log('ia_conversar: pesquisa reaproveitada', reusada);
    if (trechos.length) {
      for (const provedor of ['groq', 'gemini'] as NomeProvedor[]) {
        if (!temChave(provedor) || bloqueadoAte.get(provedor)) continue;
        const r = await conversar(provedor, [
          { role: 'system', content: `${sistemaPara(provedor, true)}\n\n${blocoTrechos(trechos)}` },
          ...conversa,
        ], { temperatura: 0.2, maxTokens: 1800 });
        if (r.ok) {
          const { texto: comCitacoes, fontes } = fontesCitadas(r.texto, fontesDe(trechos));
          resposta = { provedor, texto: comCitacoes, modelo: r.modelo, fontes };
          await registrarUso(sb, userId, provedor, r.tokens);
          // Guarda a pesquisa nova só se ela serviu (a resposta citou as fontes).
          if (!reusada && /\[\d{1,2}\]/.test(comCitacoes)) {
            const { error } = await sb.from('web_searches').insert({
              question: texto.slice(0, 1000), queries: consultas.join('\n'), results: trechos,
            });
            if (error) console.warn('ia_conversar: não guardei a pesquisa', error.message);
          }
          break;
        }
        erros.push(r.erro);
        console.warn('ia_conversar: síntese da pesquisa falhou', { provedor, erro: r.erro });
        if (r.limite) {
          await bloquear(sb, userId, provedor, r.esperarSeg);
          bloqueadoAte.set(provedor, new Date(Date.now() + r.esperarSeg * 1000).toISOString());
        }
      }
    } else {
      console.warn('ia_conversar: pesquisa sem resultados', { erros });
    }
  }
  // Sem Tavily: tenta a busca embutida dos provedores (hoje indisponível no plano grátis).
  if (!resposta && rota === 'pesquisa' && !conversaSensivel && !temBusca()) {
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
      if (r.limite) {
        await bloquear(sb, userId, provedor, r.esperarSeg);
        bloqueadoAte.set(provedor, new Date(Date.now() + r.esperarSeg * 1000).toISOString());
      }
    }
  }
  // Sem pesquisa (ou ela falhou): responde normalmente, mas avisa que não foi verificado.
  const semVerificar = !resposta && rota === 'pesquisa';
  if (semVerificar) rotaUsada = 'inteligente';

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
      bloqueadoAte.set(provedor, new Date(Date.now() + r.esperarSeg * 1000).toISOString());
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

  if (semVerificar) {
    resposta.texto = `> **Não consegui pesquisar na internet agora**, então esta resposta não foi verificada em fontes. Confira antes de confiar.\n\n${resposta.texto}`;
  }

  // Pergunta feita por voz: além da resposta completa (tela), um resumo curto para falar.
  const falaPronta = corpo.voz ? pronunciasEnsinadas(sb).catch(() => []).then((p) => resumoFalado(texto, resposta!.texto, p)).catch(() => null) : Promise.resolve(null);

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

  return responder(200, { mensagem: salva.data, fala: await falaPronta });
});
