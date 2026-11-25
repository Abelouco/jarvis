// Núcleo local-first: o app lê e escreve no SQLite e responde na hora;
// o sync empurra o que mudou aqui e puxa o que mudou no Supabase.
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { criarCliente, ouvirEventos, type ArmazenamentoSessao } from './supabase';
import { novoId, prepararBanco, TABELAS_SYNC, type BancoLocal, type TabelaSync, type Valor } from './local';
import type { Fonte, JarvisEvent, Memory, Message, Prioridade, Task } from './types';

export interface OpcoesJarvis {
  db: BancoLocal;
  sessao?: ArmazenamentoSessao;
  /** Qual app e versão (ex.: "PC v0.1.12"): a IA usa para saber a própria versão. */
  versaoApp?: () => string | Promise<string>;
}

export type EstadoSync = 'parado' | 'sincronizando' | 'offline' | 'erro';

/** O que a IA está fazendo agora (vai ganhar 'agindo' e 'permissao' com as ferramentas). */
export type EstadoIA = 'repouso' | 'pensando' | 'pesquisando' | 'agindo' | 'permissao';

type Ouvinte = () => void;

export interface Atividade {
  id: number;
  /** Ex.: "Tarefa criada". */
  texto: string;
  /** Nome do item, quando ele existe no banco local. */
  detalhe: string | null;
  quando: string;
}

const NOME_ENTIDADE: Record<string, string> = {
  tasks: 'Tarefa', projects: 'Projeto', reminders: 'Lembrete', habits: 'Hábito',
  habit_logs: 'Registro de hábito', memories: 'Memória', memory_links: 'Ligação de memória',
};
/** Entidades que aparecem em "Atividades recentes" (mensagens só fazem o cérebro pulsar). */
const ENTIDADES_ATIVIDADE = Object.keys(NOME_ENTIDADE);
const NOME_ACAO: Record<string, string> = { created: 'criada', updated: 'atualizada', deleted: 'apagada' };

/** "14:15" se for hoje, "ontem 14:15", ou "21/11 14:15". */
export function quandoCurto(iso: string, agoraRef = new Date()): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = (x: Date) => x.toDateString();
  if (dia(d) === dia(agoraRef)) return hora;
  const ontem = new Date(agoraRef);
  ontem.setDate(ontem.getDate() - 1);
  if (dia(d) === dia(ontem)) return `ontem ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

const agora = () => new Date().toISOString();

function lerFontes(bruto: string | null): Fonte[] | null {
  if (!bruto) return null;
  try {
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) ? lista.filter((f) => f && typeof f.url === 'string') : null;
  } catch {
    return null;
  }
}
const LOTE = 500;

export function criarJarvis({ db, sessao, versaoApp }: OpcoesJarvis) {
  const sb: SupabaseClient = criarCliente(sessao);
  const ouvintes = new Set<Ouvinte>();
  const ouvintesEvento = new Set<(e: JarvisEvent) => void>();
  let estado: EstadoSync = 'parado';
  let ultimoErro: string | null = null;
  let fila: Promise<void> = Promise.resolve();
  let agendado: ReturnType<typeof setTimeout> | null = null;
  let canal: ReturnType<typeof ouvirEventos> | null = null;
  let relogio: ReturnType<typeof setInterval> | null = null;
  let pronto: Promise<void> | null = null;

  const avisar = () => ouvintes.forEach((f) => f());
  const mudarEstado = (e: EstadoSync, erro: string | null = null) => {
    estado = e;
    ultimoErro = erro;
    avisar();
  };

  async function iniciar() {
    pronto ??= prepararBanco(db);
    await pronto;
    const { data } = await sb.auth.getSession();
    if (data.session) ligarSync();
    sb.auth.onAuthStateChange((_ev, s) => {
      if (s) ligarSync();
      else desligarSync();
      avisar();
    });
  }

  // ---------- login (e-mail e senha; a conta é criada pelo próprio app) ----------
  const auth = {
    /** Cria a conta. Devolve true se já entrou; false se o Supabase exige confirmar o e-mail. */
    async criarConta(email: string, senha: string): Promise<boolean> {
      if (senha.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
      const { data, error } = await sb.auth.signUp({ email: email.trim().toLowerCase(), password: senha });
      if (error) throw new Error(error.message === 'User already registered' ? 'Esse e-mail já tem conta. Use Entrar.' : error.message);
      return !!data.session;
    },
    async entrar(email: string, senha: string) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
    },
    async sessao(): Promise<Session | null> {
      return (await sb.auth.getSession()).data.session;
    },
    async sair() {
      await sb.auth.signOut();
    },
  };

  // ---------- tarefas (sempre no banco local) ----------
  const tarefas = {
    async listar(): Promise<Task[]> {
      const linhas = await db.consultar<Omit<Task, 'archived'> & { archived: number }>(
        `select * from tasks where deleted_at is null and archived = 0
         order by done_at is not null, position, created_at desc`,
      );
      return linhas.map((t) => ({ ...t, archived: !!t.archived }));
    },
    async criar(titulo: string, prioridade: Prioridade = 'media') {
      const t = agora();
      const user = (await auth.sessao())?.user.id ?? null;
      await db.executar(
        `insert into tasks (id, user_id, title, priority, created_at, updated_at, dirty)
         values (?, ?, ?, ?, ?, ?, 1)`,
        [novoId(), user, titulo.trim(), prioridade, t, t],
      );
      mudouLocal();
    },
    async alternarConcluida(id: string) {
      const t = agora();
      await db.executar(
        `update tasks set done_at = case when done_at is null then ? else null end,
         updated_at = ?, dirty = 1 where id = ?`,
        [t, t, id],
      );
      mudouLocal();
    },
    /** Exclusão suave: nunca apaga de verdade. */
    async apagar(id: string) {
      const t = agora();
      await db.executar(`update tasks set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`, [t, t, id]);
      mudouLocal();
    },
  };

  function mudouLocal() {
    avisar();
    agendarSync(300);
  }

  // ---------- sync ----------
  function agendarSync(atraso = 0) {
    if (agendado) clearTimeout(agendado);
    agendado = setTimeout(() => {
      agendado = null;
      void sincronizar();
    }, atraso);
  }

  /** Roda um sync por vez, em fila. */
  function sincronizar(): Promise<void> {
    fila = fila.then(rodarSync, rodarSync);
    return fila;
  }

  async function rodarSync() {
    const s = await auth.sessao();
    if (!s) return;
    mudarEstado('sincronizando');
    try {
      await empurrar(s.user.id);
      await puxar();
      mudarEstado('parado');
      void retomarPendente();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      mudarEstado(/fetch|network|rede/i.test(msg) ? 'offline' : 'erro', msg);
    }
  }

  async function empurrar(userId: string) {
    for (const t of TABELAS_SYNC) await empurrarTabela(t, userId);
  }

  async function empurrarTabela(t: TabelaSync, userId: string) {
    const sujas = await db.consultar<Record<string, Valor>>(`select * from ${t.nome} where dirty = 1 limit ${LOTE}`);
    if (!sujas.length) return;
    const envio = sujas.map((r) => {
      const linha: Record<string, unknown> = {};
      for (const c of t.colunas) linha[c] = r[c];
      linha.user_id = userId;
      for (const c of t.booleanas) linha[c] = !!r[c];
      for (const c of t.somenteServidor ?? []) delete linha[c];
      delete linha.updated_at; // quem carimba é o trigger do servidor
      return linha;
    });
    const { data, error } = await sb.from(t.nome).upsert(envio, { onConflict: 'id' }).select();
    if (error) throw error;
    // Grava a versão do servidor e limpa a marca, só se a linha não mudou de novo enquanto subia.
    const enviadoEm = new Map(sujas.map((r) => [r.id as string, r.updated_at as string]));
    for (const srv of (data ?? []) as Record<string, unknown>[]) {
      await gravarDoServidor(t, srv, enviadoEm.get(srv.id as string));
    }
  }

  async function puxar() {
    for (const t of TABELAS_SYNC) await puxarTabela(t);
    avisar();
  }

  async function puxarTabela(t: TabelaSync) {
    const [estadoRow] = await db.consultar<{ cursor: string | null }>(
      `select cursor from sync_state where tabela = ?`,
      [t.nome],
    );
    let cursor = estadoRow?.cursor ?? '1970-01-01T00:00:00Z';
    for (;;) {
      const { data, error } = await sb
        .from(t.nome)
        .select('*')
        .gte('updated_at', cursor)
        .order('updated_at', { ascending: true })
        .limit(LOTE);
      if (error) throw error;
      const linhas = (data ?? []) as Record<string, unknown>[];
      for (const srv of linhas) await gravarDoServidor(t, srv);
      const ultimo = linhas.at(-1)?.updated_at as string | undefined;
      // Sem avanço (lote vazio ou tudo no mesmo instante): para, evita laço infinito.
      if (!ultimo || ultimo === cursor) break;
      cursor = ultimo;
      await db.executar(
        `insert into sync_state (tabela, cursor) values (?, ?)
         on conflict (tabela) do update set cursor = excluded.cursor`,
        [t.nome, cursor],
      );
      if (linhas.length < LOTE) break;
    }
  }

  /**
   * Grava uma linha vinda do servidor.
   * - Sem `enviadoEm`: só sobrescreve se a local não tiver mudança pendente.
   * - Com `enviadoEm`: confirmação de envio; limpa `dirty` se a local ainda é a que subiu.
   */
  async function gravarDoServidor(t: TabelaSync, srv: Record<string, unknown>, enviadoEm?: string) {
    const valores: Valor[] = t.colunas.map((c) => {
      const v = srv[c];
      if (t.booleanas.includes(c)) return v ? 1 : 0;
      if (t.json?.includes(c)) return v == null ? null : JSON.stringify(v);
      return (v ?? null) as Valor;
    });
    const sets = t.colunas.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
    const condicao = enviadoEm === undefined ? `${t.nome}.dirty = 0` : `${t.nome}.updated_at = ?`;
    await db.executar(
      `insert into ${t.nome} (${t.colunas.join(', ')}, dirty)
       values (${t.colunas.map(() => '?').join(', ')}, 0)
       on conflict (id) do update set ${sets}, dirty = 0 where ${condicao}`,
      enviadoEm === undefined ? valores : [...valores, enviadoEm],
    );
  }

  // ---------- conversa (chat) ----------
  const TABELA_MSG = TABELAS_SYNC.find((t) => t.nome === 'messages')!;
  /** undefined = ainda não decidiu; null = conversa nova, criada no primeiro envio. */
  let conversaAtual: string | null | undefined;
  let pensando = false;
  let erroChat: string | null = null;

  async function idConversaAtual(): Promise<string | null> {
    if (conversaAtual === undefined) {
      const [c] = await db.consultar<{ id: string }>(
        `select id from conversations where deleted_at is null order by updated_at desc limit 1`,
      );
      conversaAtual = c?.id ?? null;
    }
    return conversaAtual;
  }

  async function mensagemDeErro(error: unknown): Promise<string> {
    const ctx = (error as { context?: unknown })?.context;
    if (ctx instanceof Response) {
      try {
        const j = await ctx.clone().json();
        if (j?.erro) return String(j.erro);
      } catch {
        /* resposta sem JSON */
      }
    }
    const msg = error instanceof Error ? error.message : String(error);
    return /fetch|network|rede|Failed to send/i.test(msg) ? 'Sem conexão. A mensagem ficou guardada; tente de novo.' : msg;
  }

  // ---------- pergunta sem resposta (queda, erro, app fechado no meio) ----------
  // Se a última mensagem da conversa é do dono, ela está em aberto: o J.A.R.V.I.S. responde
  // essa antes de qualquer outra coisa. Outro aparelho pode estar respondendo agora mesmo,
  // então só retoma uma pergunta recente se a falha foi aqui; as antigas, sempre.
  // A função é idempotente: se já houver resposta, devolve a mesma (nunca responde duas vezes).
  const TEMPO_OUTRO_APARELHO = 40_000;
  const ESPERAS_RETENTATIVA = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
  const falhasAqui = new Map<string, number>(); // id da pergunta -> nº de falhas nesta sessão
  let relogioPendente: ReturnType<typeof setTimeout> | null = null;

  async function perguntaEmAberto(): Promise<Message | null> {
    const id = await idConversaAtual();
    if (!id) return null;
    const [ultima] = await db.consultar<Omit<Message, 'sensitive'> & { sensitive: number }>(
      `select * from messages where conversation_id = ? and deleted_at is null
       order by created_at desc, rowid desc limit 1`,
      [id],
    );
    return ultima?.role === 'user' ? { ...ultima, sensitive: !!ultima.sensitive } : null;
  }

  function agendarRetomada(atraso: number) {
    if (relogioPendente) clearTimeout(relogioPendente);
    relogioPendente = setTimeout(() => {
      relogioPendente = null;
      void retomarPendente();
    }, atraso);
  }

  /** Pede a resposta de uma pergunta já gravada. true = respondida. */
  /** Perguntas feitas por voz: a resposta delas é lida em voz alta. */
  const porVoz = new Set<string>();
  const ouvintesResposta = new Set<(m: Message, voz: boolean) => void>();

  async function pedirResposta(m: Pick<Message, 'id' | 'conversation_id' | 'content'>): Promise<boolean> {
    pensando = true;
    erroChat = null;
    avisar();
    try {
      const { data, error } = await sb.functions.invoke('ia_conversar', {
        body: {
          conversation_id: m.conversation_id, message_id: m.id, text: m.content,
          app: versaoApp ? await Promise.resolve(versaoApp()).catch(() => '') : '',
        },
      });
      if (error) throw error;
      if (data?.mensagem) {
        await gravarDoServidor(TABELA_MSG, data.mensagem as Record<string, unknown>);
        const resposta = { ...(data.mensagem as Message), sources: (data.mensagem as Message).sources ?? null };
        const voz = porVoz.delete(m.id);
        ouvintesResposta.forEach((f) => f(resposta, voz));
      }
      falhasAqui.delete(m.id);
      return true;
    } catch (e) {
      const n = (falhasAqui.get(m.id) ?? 0) + 1;
      falhasAqui.set(m.id, n);
      const espera = ESPERAS_RETENTATIVA[Math.min(n - 1, ESPERAS_RETENTATIVA.length - 1)]!;
      erroChat = `${await mensagemDeErro(e)} Tento de novo em ${Math.round(espera / 1000)} s.`;
      agendarRetomada(espera);
      return false;
    } finally {
      pensando = false;
      avisar();
      agendarSync(300);
    }
  }

  /** Responde a pergunta em aberto da conversa atual, se houver. */
  async function retomarPendente(): Promise<boolean> {
    if (pensando || !(await auth.sessao())) return !pensando;
    const p = await perguntaEmAberto();
    if (!p) return true;
    const idade = Date.now() - Date.parse(p.created_at);
    if (!falhasAqui.has(p.id) && idade < TEMPO_OUTRO_APARELHO) {
      // Pode ser outro aparelho respondendo agora: espera um pouco e confere de novo.
      agendarRetomada(TEMPO_OUTRO_APARELHO - idade + 500);
      return false;
    }
    return pedirResposta(p);
  }

  const chat = {
    /** Mensagens da conversa atual, da mais antiga para a mais nova (banco local). */
    async mensagens(): Promise<Message[]> {
      const id = await idConversaAtual();
      if (!id) return [];
      const linhas = await db.consultar<Omit<Message, 'sensitive' | 'sources'> & { sensitive: number; sources: string | null }>(
        `select * from messages where conversation_id = ? and deleted_at is null order by created_at, rowid`,
        [id],
      );
      return linhas.map((m) => ({ ...m, sensitive: !!m.sensitive, sources: lerFontes(m.sources) }));
    },
    estado: () => ({ pensando, erro: erroChat }),
    novaConversa() {
      conversaAtual = null;
      erroChat = null;
      if (relogioPendente) clearTimeout(relogioPendente);
      relogioPendente = null;
      avisar();
    },
    /**
     * Envia uma pergunta. Se houver outra em aberto, responde aquela primeiro.
     * Devolve false se não deu para enviar agora (o texto deve voltar para o campo).
     */
    /** Avisa quando chega a resposta da IA (voz = a pergunta foi feita falando). */
    aoResponder(f: (m: Message, voz: boolean) => void) {
      ouvintesResposta.add(f);
      return () => { ouvintesResposta.delete(f); };
    },
    /** Transcreve um áudio gravado (Groq Whisper, no servidor). */
    async transcrever(audio: Blob, nome = 'fala.webm'): Promise<string> {
      const form = new FormData();
      form.append('audio', audio, nome);
      // As últimas mensagens ajudam a acertar nomes ("Medieval Dynasty", não "medieval de Nastia").
      // Mensagens sensíveis ficam de fora.
      const id = await idConversaAtual();
      if (id) {
        const ultimas = await db.consultar<{ role: string; content: string }>(
          `select role, content from messages where conversation_id = ? and deleted_at is null and coalesce(sensitive, 0) = 0
           order by created_at desc, rowid desc limit 4`,
          [id],
        );
        const contexto = ultimas.reverse()
          .map((m) => `${m.role === 'user' ? 'Dono' : 'JARVIS'}: ${m.content.replace(/\s+/g, ' ').slice(0, 400)}`)
          .join('\n');
        if (contexto) form.append('contexto', contexto);
      }
      const { data, error } = await sb.functions.invoke('ia_transcrever', { body: form });
      if (error) throw new Error(await mensagemDeErro(error));
      return String(data?.texto ?? '').trim();
    },
    async enviar(texto: string, opcoes: { voz?: boolean } = {}): Promise<boolean> {
      const limpo = texto.trim();
      if (!limpo || pensando) return false;
      const s = await auth.sessao();
      if (!s) throw new Error('Faça login.');
      const aberta = await perguntaEmAberto();
      if (aberta && !(await pedirResposta(aberta))) return false;
      const t = agora();
      let conversa = await idConversaAtual();
      if (!conversa) {
        conversa = novoId();
        await db.executar(
          `insert into conversations (id, user_id, title, created_at, updated_at, dirty) values (?, ?, ?, ?, ?, 1)`,
          [conversa, s.user.id, limpo.slice(0, 60), t, t],
        );
        conversaAtual = conversa;
      }
      const idMsg = novoId();
      await db.executar(
        `insert into messages (id, user_id, conversation_id, role, content, created_at, updated_at, dirty)
         values (?, ?, ?, 'user', ?, ?, ?, 1)`,
        [idMsg, s.user.id, conversa, limpo, t, t],
      );
      if (opcoes.voz) porVoz.add(idMsg);
      await pedirResposta({ id: idMsg, conversation_id: conversa, content: limpo });
      return true;
    },
  };

  // ---------- memória (o que a IA aprendeu sobre o dono) ----------
  const memorias = {
    /** Tudo o que ele sabe, das mais importantes para as menos (banco local). */
    async listar(): Promise<Memory[]> {
      const linhas = await db.consultar<Omit<Memory, 'sensitive'> & { sensitive: number }>(
        `select * from memories where deleted_at is null order by importance desc, updated_at desc`,
      );
      return linhas.map((m) => ({ ...m, sensitive: !!m.sensitive }));
    },
    /** Esquecer = exclusão suave (some do app e da IA; nada é apagado de verdade). */
    async esquecer(id: string) {
      const t = agora();
      await db.executar(`update memories set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`, [t, t, id]);
      mudouLocal();
    },
  };

  // ---------- atividades recentes (a partir da tabela events) ----------
  const MAX_ATIVIDADES = 15;
  let eventosRecentes: JarvisEvent[] = [];
  let historicoCarregado = false;

  async function carregarHistorico() {
    const { data, error } = await sb
      .from('events')
      .select('*')
      .in('entity_type', ENTIDADES_ATIVIDADE)
      .order('created_at', { ascending: false })
      .limit(MAX_ATIVIDADES);
    if (error) return; // offline: a lista começa só com o que chegar ao vivo
    const vistos = new Set(eventosRecentes.map((e) => e.id));
    eventosRecentes = [...eventosRecentes, ...((data ?? []) as JarvisEvent[]).filter((e) => !vistos.has(e.id))]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, MAX_ATIVIDADES);
    historicoCarregado = true;
    avisar();
  }

  const atividades = {
    /** As últimas coisas que aconteceram, já em texto, com o nome do item (vem do banco local). */
    async listar(): Promise<Atividade[]> {
      const titulos = new Map<string, string>();
      for (const [tabela, coluna] of [['tasks', 'title'], ['memories', "coalesce(title, content)"]] as const) {
        const ids = eventosRecentes.filter((e) => e.entity_type === tabela && e.entity_id).map((e) => e.entity_id!);
        if (!ids.length) continue;
        const linhas = await db.consultar<{ id: string; titulo: string }>(
          `select id, ${coluna} as titulo from ${tabela} where id in (${ids.map(() => '?').join(', ')})`,
          ids,
        );
        for (const l of linhas) titulos.set(l.id, l.titulo);
      }
      return eventosRecentes.map((e) => ({
        id: e.id,
        texto: `${NOME_ENTIDADE[e.entity_type ?? ''] ?? 'Item'} ${NOME_ACAO[e.kind] ?? e.kind}`,
        detalhe: (e.entity_id && titulos.get(e.entity_id)) || null,
        quando: e.created_at,
      }));
    },
    carregado: () => historicoCarregado,
  };

  function ligarSync() {
    if (!canal) {
      canal = ouvirEventos(sb, (e) => {
        // Outro aparelho pediu algo à IA: o cérebro mostra "pensando" aqui também, até a resposta chegar.
        if (e.kind === 'thinking') {
          pensandoRemotoAte = Date.now() + 60_000;
          if (relogioRemoto) clearTimeout(relogioRemoto);
          relogioRemoto = setTimeout(avisar, 60_500);
        } else if (e.kind === 'searching') {
          // A IA está pesquisando na internet (em qualquer aparelho).
          pesquisandoAte = Date.now() + 60_000;
        } else if (e.kind === 'created' && e.entity_type === 'messages') {
          pensandoRemotoAte = 0;
          pesquisandoAte = 0;
        }
        const entraNaLista = !!e.entity_type && ENTIDADES_ATIVIDADE.includes(e.entity_type);
        if (entraNaLista && !eventosRecentes.some((x) => x.id === e.id)) {
          eventosRecentes = [e, ...eventosRecentes].slice(0, MAX_ATIVIDADES);
        }
        ouvintesEvento.forEach((f) => f(e));
        avisar();
        if (e.entity_type && TABELAS_SYNC.some((t) => t.nome === e.entity_type)) agendarSync(150);
      });
      void carregarHistorico();
    }
    relogio ??= setInterval(() => void sincronizar(), 60_000);
    agendarSync(0);
  }

  // ---------- estado da IA (o que o cérebro mostra) ----------
  let pensandoRemotoAte = 0;
  let pesquisandoAte = 0;
  let relogioRemoto: ReturnType<typeof setTimeout> | null = null;
  const ia = {
    /** 'pensando' enquanto este aparelho ou outro espera uma resposta da IA. */
    estado(): EstadoIA {
      const pensandoAgora = pensando || pensandoRemotoAte > Date.now();
      if (pensandoAgora && pesquisandoAte > Date.now()) return 'pesquisando';
      return pensandoAgora ? 'pensando' : 'repouso';
    },
  };

  function desligarSync() {
    if (canal) void sb.removeChannel(canal);
    canal = null;
    eventosRecentes = [];
    historicoCarregado = false;
    if (relogio) clearInterval(relogio);
    relogio = null;
  }

  return {
    iniciar,
    auth,
    tarefas,
    atividades,
    chat,
    ia,
    memorias,
    sincronizar,
    estado: () => ({ estado, ultimoErro }),
    /** Avisa quando algo local mudou (para a tela recarregar). */
    aoMudar(f: Ouvinte) {
      ouvintes.add(f);
      return () => { ouvintes.delete(f); };
    },
    /** Cada evento real do núcleo (o cérebro vai pulsar com isso). */
    aoEvento(f: (e: JarvisEvent) => void) {
      ouvintesEvento.add(f);
      return () => { ouvintesEvento.delete(f); };
    },
  };
}

export type Jarvis = ReturnType<typeof criarJarvis>;
