import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { quandoCurto, type Atividade, type Prioridade, type Task } from '@jarvis/core';
import { jarvis } from './src/jarvis';
import { ligarAtualizacao } from './src/atualizacao';
import { Conversa } from './src/Conversa';
import { Nucleo } from './src/Nucleo';
import { C, COR_PRIO, MONO, NOME_PRIO } from './src/tema';

export default function App() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [pulso, setPulso] = useState(0);

  useEffect(() => ligarAtualizacao(), []);

  useEffect(() => {
    const ver = async () => setLogado(!!(await jarvis.auth.sessao()));
    void jarvis.iniciar().then(ver);
    const a = jarvis.aoMudar(() => void ver());
    const b = jarvis.aoEvento(() => setPulso((n) => n + 1));
    return () => { a(); b(); };
  }, []);

  return (
    <View style={s.tela}>
      <View style={s.grade} pointerEvents="none" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {logado === null ? (
          <View style={s.centro}><ActivityIndicator color={C.ciano} /></View>
        ) : logado ? (
          <Painel pulso={pulso} />
        ) : (
          <Login pulso={pulso} />
        )}
      </KeyboardAvoidingView>
      <StatusBar style="light" />
    </View>
  );
}

// ======================= login =======================

function Login({ pulso }: { pulso: number }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState<{ txt: string; ok?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async () => {
    if (!email || !senha) return setAviso({ txt: 'Preencha e-mail e senha.' });
    setOcupado(true);
    setAviso(null);
    try {
      if (!criando) await jarvis.auth.entrar(email, senha);
      else if (!(await jarvis.auth.criarConta(email, senha))) {
        setCriando(false);
        setAviso({ txt: 'Conta criada. Confirme pelo link no seu e-mail e depois entre.', ok: true });
      }
    } catch (e) {
      setAviso({ txt: e instanceof Error ? e.message : String(e) });
    }
    setOcupado(false);
  };

  return (
    <ScrollView contentContainerStyle={s.entrada} keyboardShouldPersistTaps="handled">
      <View style={{ marginVertical: -40 }}><Nucleo tamanho={300} pulso={pulso} /></View>
      <Text style={s.marca}>J.A.R.V.I.S.</Text>
      <Text style={s.marcaSub}>ASSISTENTE PESSOAL</Text>

      <View style={s.cartao}>
        <View style={s.abas}>
          {(['Entrar', 'Criar conta'] as const).map((nome, i) => {
            const ativa = (i === 1) === criando;
            return (
              <Pressable key={nome} style={[s.aba, ativa && s.abaAtiva]} onPress={() => { setCriando(i === 1); setAviso(null); }}>
                <Text style={[s.abaTxt, ativa && { color: C.ciano }]}>{nome}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.rotulo}>E-MAIL</Text>
        <TextInput
          style={s.campo} placeholder="voce@exemplo.com" placeholderTextColor={C.apagado}
          autoCapitalize="none" autoComplete="email" keyboardType="email-address"
          value={email} onChangeText={setEmail} returnKeyType="next"
        />
        <Text style={s.rotulo}>SENHA</Text>
        <TextInput
          style={s.campo} placeholder={criando ? 'mínimo de 6 caracteres' : '••••••••'} placeholderTextColor={C.apagado}
          secureTextEntry autoComplete={criando ? 'new-password' : 'current-password'}
          value={senha} onChangeText={setSenha} onSubmitEditing={enviar} returnKeyType="go"
        />
        <Pressable style={({ pressed }) => [s.primario, (pressed || ocupado) && { opacity: 0.8 }]} disabled={ocupado} onPress={enviar}>
          {ocupado ? <ActivityIndicator color="#031018" /> : <Text style={s.primarioTxt}>{criando ? 'Criar conta' : 'Entrar'}</Text>}
        </Pressable>
        {aviso && <Text style={[s.aviso, aviso.ok && { color: C.baixa }]}>{aviso.txt}</Text>}
      </View>
    </ScrollView>
  );
}

// ======================= painel =======================

const NOME_ESTADO = { parado: 'sincronizado', sincronizando: 'sincronizando', offline: 'offline', erro: 'erro no sync' };
const COR_ESTADO = { parado: C.baixa, sincronizando: C.media, offline: C.apagado, erro: C.erro };
const PESO: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };

function saudacao() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}
function dataHoje() {
  const d = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function Painel({ pulso }: { pulso: number }) {
  const [lista, setLista] = useState<Task[]>([]);
  const [novo, setNovo] = useState('');
  const [prio, setPrio] = useState<Prioridade>('media');
  const [sync, setSync] = useState(jarvis.estado());
  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [aba, setAba] = useState<'conversa' | 'tarefas'>('conversa');
  const rolagem = useRef<ComponentRef<typeof ScrollView>>(null);
  const descer = useCallback(() => rolagem.current?.scrollToEnd({ animated: true }), []);

  const recarregar = useCallback(async () => {
    setLista(await jarvis.tarefas.listar());
    setSync(jarvis.estado());
    setAtividades(await jarvis.atividades.listar());
  }, []);

  useEffect(() => {
    void recarregar();
    return jarvis.aoMudar(() => void recarregar());
  }, [recarregar]);

  const abertas = useMemo(() => lista.filter((t) => !t.done_at).sort((a, b) => PESO[a.priority] - PESO[b.priority]), [lista]);
  const feitas = useMemo(() => lista.filter((t) => t.done_at), [lista]);

  const adicionar = async () => {
    const t = novo.trim();
    if (!t) return;
    setNovo('');
    await jarvis.tarefas.criar(t, prio);
  };

  return (
    <ScrollView ref={rolagem} contentContainerStyle={s.painel} keyboardShouldPersistTaps="handled">
      <View style={s.topo}>
        <Text style={s.topoNome}>J.A.R.V.I.S.</Text>
        <View style={{ flex: 1 }} />
        <View style={s.estado}>
          <View style={[s.estadoPonto, { backgroundColor: COR_ESTADO[sync.estado] }]} />
          <Text style={s.estadoTxt}>{NOME_ESTADO[sync.estado].toUpperCase()}</Text>
        </View>
      </View>

      <View style={{ alignItems: 'center', marginTop: -24, marginBottom: -28 }}>
        <Nucleo tamanho={280} pulso={pulso} />
      </View>
      <View style={s.saudacao}>
        <View style={{ flex: 1 }}>
          <Text style={s.ola}>{saudacao()}.</Text>
          <Text style={s.data}>{dataHoje()}</Text>
          <Text style={s.resumo}>
            {abertas.length
              ? `${abertas.length} pendente${abertas.length > 1 ? 's' : ''} · ${feitas.length} concluída${feitas.length === 1 ? '' : 's'}`
              : feitas.length ? 'Tudo em dia.' : 'Nada na fila ainda.'}
          </Text>
        </View>
      </View>

      <View style={s.abasPainel}>
        {(['conversa', 'tarefas'] as const).map((a) => (
          <Pressable key={a} style={[s.aba, aba === a && s.abaAtiva]} onPress={() => setAba(a)}>
            <Text style={[s.abaTxt, aba === a && { color: C.ciano }]}>{a === 'conversa' ? 'Conversa' : 'Tarefas'}</Text>
          </Pressable>
        ))}
      </View>

      {aba === 'conversa' ? <Conversa aoCrescer={descer} /> : (
      <>
      <View style={s.nova}>
        <TextInput
          style={s.novaCampo} placeholder="O que precisa ser feito?" placeholderTextColor={C.apagado}
          value={novo} onChangeText={setNovo} onSubmitEditing={adicionar} returnKeyType="done" submitBehavior="submit"
        />
        <Pressable style={s.mais} onPress={adicionar}><Text style={s.maisTxt}>+</Text></Pressable>
      </View>
      <View style={s.prios}>
        {(['alta', 'media', 'baixa'] as Prioridade[]).map((p) => {
          const ativa = p === prio;
          return (
            <Pressable
              key={p} onPress={() => setPrio(p)}
              style={[s.prio, ativa && { borderColor: COR_PRIO[p] + '66', backgroundColor: COR_PRIO[p] + '1a' }]}
            >
              <View style={[s.prioPonto, { backgroundColor: ativa ? COR_PRIO[p] : C.apagado }]} />
              <Text style={[s.prioTxt, ativa && { color: COR_PRIO[p] }]}>{NOME_PRIO[p]}</Text>
            </Pressable>
          );
        })}
      </View>

      {lista.length === 0 ? (
        <View style={s.vazio}>
          <Text style={s.vazioTitulo}>Nenhuma tarefa por aqui.</Text>
          <Text style={s.vazioTxt}>Escreva acima e toque em +.</Text>
        </View>
      ) : (
        <>
          <Secao titulo="PENDENTES" qtd={abertas.length} />
          {abertas.map((t) => <Item key={t.id} t={t} />)}
          {feitas.length > 0 && <Secao titulo="CONCLUÍDAS" qtd={feitas.length} />}
          {feitas.map((t) => <Item key={t.id} t={t} />)}
        </>
      )}

      <Secao titulo="ATIVIDADES RECENTES" qtd={atividades.length} />
      <View style={s.linhaTempo}>
        {atividades.length === 0 ? (
          <Text style={s.legenda}>{jarvis.atividades.carregado() ? 'Nenhuma atividade ainda.' : 'Carregando…'}</Text>
        ) : atividades.map((a, i) => (
          <View key={a.id} style={s.atividade}>
            <View style={[s.atividadePonto, i === 0 && { backgroundColor: C.ciano }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.atividadeTxt}>{a.texto}</Text>
              {a.detalhe ? <Text style={s.atividadeDetalhe} numberOfLines={1}>{a.detalhe}</Text> : null}
            </View>
            <Text style={s.atividadeHora}>{quandoCurto(a.quando)}</Text>
          </View>
        ))}
      </View>
      </>
      )}

      <Pressable style={s.sair} onPress={() => void jarvis.auth.sair()}>
        <Text style={s.sairTxt}>Sair da conta</Text>
      </Pressable>
    </ScrollView>
  );
}

function Secao({ titulo, qtd }: { titulo: string; qtd: number }) {
  return (
    <View style={s.secao}>
      <Text style={s.secaoTxt}>{titulo} <Text style={{ color: C.texto2 }}>{qtd}</Text></Text>
      <View style={s.secaoLinha} />
    </View>
  );
}

function Item({ t }: { t: Task }) {
  const feita = !!t.done_at;
  const cor = COR_PRIO[t.priority];
  return (
    <Pressable
      style={({ pressed }) => [s.tarefa, feita && { backgroundColor: 'transparent' }, pressed && { backgroundColor: 'rgba(20,32,52,0.7)' }]}
      onPress={() => void jarvis.tarefas.alternarConcluida(t.id)}
      onLongPress={() => void jarvis.tarefas.apagar(t.id)}
    >
      <View style={[s.barra, { backgroundColor: cor, opacity: feita ? 0.25 : 1 }]} />
      <View style={[s.check, feita && { backgroundColor: C.cianoForte, borderColor: C.cianoForte }]}>
        {feita && <Text style={s.checkTxt}>✓</Text>}
      </View>
      <Text style={[s.tarefaTxt, feita && s.feita]}>{t.title}</Text>
      <Text style={[s.tag, { color: cor, opacity: feita ? 0.35 : 0.85 }]}>{NOME_PRIO[t.priority].toUpperCase()}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: C.fundo },
  grade: {
    position: 'absolute', top: -200, left: -100, right: -100, height: 520, borderRadius: 400,
    backgroundColor: 'rgba(60,196,255,0.06)',
  },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // login
  entrada: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, paddingTop: 72 },
  marca: { color: C.ciano, fontSize: 26, fontWeight: '300', letterSpacing: 12, marginTop: 26, marginRight: -12 },
  marcaSub: { color: C.apagado, fontFamily: MONO, fontSize: 10, letterSpacing: 2, marginTop: 8 },
  cartao: {
    alignSelf: 'stretch', marginTop: 30, padding: 20, borderRadius: 20,
    backgroundColor: C.vidro, borderWidth: 1, borderColor: C.borda,
  },
  abasPainel: { flexDirection: 'row', padding: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: C.borda, marginBottom: 18 },
  abas: { flexDirection: 'row', padding: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)', marginBottom: 20 },
  aba: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  abaAtiva: { backgroundColor: 'rgba(127,216,255,0.12)', borderWidth: 1, borderColor: C.bordaForte },
  abaTxt: { color: C.texto2, fontSize: 14 },
  rotulo: { color: C.apagado, fontFamily: MONO, fontSize: 10, letterSpacing: 1.6, marginBottom: 6 },
  campo: {
    backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: C.borda, borderRadius: 11,
    color: C.texto, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, marginBottom: 14,
  },
  primario: {
    backgroundColor: C.cianoForte, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 6,
    shadowColor: C.cianoForte, shadowOpacity: 0.5, shadowRadius: 16, elevation: 8,
  },
  primarioTxt: { color: '#031018', fontWeight: '700', fontSize: 15, letterSpacing: 0.5 },
  aviso: { color: C.erro, textAlign: 'center', marginTop: 14, fontSize: 13 },

  // painel
  painel: { padding: 20, paddingTop: 56, paddingBottom: 48 },
  topo: { flexDirection: 'row', alignItems: 'center', marginBottom: 26 },
  topoNome: { color: C.ciano, fontWeight: '300', letterSpacing: 6, fontSize: 14 },
  estado: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: C.borda, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  estadoPonto: { width: 7, height: 7, borderRadius: 4 },
  estadoTxt: { color: C.texto2, fontFamily: MONO, fontSize: 10, letterSpacing: 1 },
  saudacao: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 24 },
  ola: { color: C.texto, fontSize: 26, fontWeight: '600' },
  data: { color: C.texto2, marginTop: 2 },
  resumo: { color: C.ciano, fontFamily: MONO, fontSize: 11, marginTop: 6 },
  nova: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, paddingLeft: 16,
    backgroundColor: C.vidro, borderWidth: 1, borderColor: C.borda, borderRadius: 16,
  },
  novaCampo: { flex: 1, color: C.texto, fontSize: 15.5, paddingVertical: 10 },
  mais: { width: 42, height: 42, borderRadius: 11, backgroundColor: C.cianoForte, alignItems: 'center', justifyContent: 'center' },
  maisTxt: { color: '#031018', fontSize: 22, lineHeight: 24 },
  prios: { flexDirection: 'row', gap: 6, marginTop: 10 },
  prio: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
  prioPonto: { width: 7, height: 7, borderRadius: 4 },
  prioTxt: { color: C.apagado, fontSize: 12.5 },
  secao: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 28, marginBottom: 10 },
  secaoTxt: { color: C.apagado, fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.8 },
  secaoLinha: { flex: 1, height: 1, backgroundColor: C.borda },
  tarefa: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingLeft: 18, paddingRight: 14,
    borderRadius: 12, backgroundColor: C.vidroLeve, marginBottom: 6, overflow: 'hidden',
  },
  barra: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderRadius: 3 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.bordaForte, alignItems: 'center', justifyContent: 'center' },
  checkTxt: { color: '#031018', fontSize: 12, fontWeight: '700' },
  tarefaTxt: { flex: 1, color: C.texto, fontSize: 15.5 },
  feita: { color: C.apagado, textDecorationLine: 'line-through' },
  tag: { fontFamily: MONO, fontSize: 9.5, letterSpacing: 1 },
  vazio: { alignItems: 'center', paddingVertical: 44 },
  vazioTitulo: { color: C.texto2, fontWeight: '500', marginBottom: 4 },
  vazioTxt: { color: C.apagado },
  legenda: { color: C.texto2, fontSize: 12.5, marginBottom: 12 },
  linhaTempo: { borderLeftWidth: 1, borderLeftColor: C.borda, paddingLeft: 16, marginLeft: 4 },
  atividade: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  atividadePonto: { position: 'absolute', left: -20.5, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: C.ciano, backgroundColor: C.fundo },
  atividadeTxt: { color: C.texto, fontSize: 13.5 },
  atividadeDetalhe: { color: C.texto2, fontSize: 12.5, marginTop: 1 },
  atividadeHora: { color: C.apagado, fontFamily: MONO, fontSize: 11 },
  sair: { alignSelf: 'center', marginTop: 32, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.borda },
  sairTxt: { color: C.texto2, fontSize: 12.5 },
});
