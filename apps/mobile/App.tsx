import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { JarvisEvent, Task } from '@jarvis/core';
import { jarvis } from './src/jarvis';

const C = { fundo: '#05070d', ciano: '#7fd8ff', apagado: '#5a6b80', linha: '#121a26', erro: '#ff7a7a' };

export default function App() {
  const [logado, setLogado] = useState<boolean | null>(null);

  useEffect(() => {
    void jarvis.iniciar().then(async () => setLogado(!!(await jarvis.auth.sessao())));
    return jarvis.aoMudar(async () => setLogado(!!(await jarvis.auth.sessao())));
  }, []);

  return (
    <KeyboardAvoidingView style={s.tela} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={s.titulo}>J.A.R.V.I.S.</Text>
      {logado === null ? <ActivityIndicator color={C.ciano} /> : logado ? <Tarefas /> : <Login />}
      <StatusBar style="light" />
    </KeyboardAvoidingView>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const rodar = async (f: () => Promise<void>) => {
    setOcupado(true);
    setMsg(null);
    try { await f(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setOcupado(false);
  };

  return (
    <View style={s.caixa}>
      <TextInput
        style={s.campo} placeholder="seu e-mail" placeholderTextColor={C.apagado}
        autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail}
        editable={!enviado}
      />
      {enviado && (
        <TextInput
          style={s.campo} placeholder="código do e-mail" placeholderTextColor={C.apagado}
          keyboardType="number-pad" value={codigo} onChangeText={setCodigo}
        />
      )}
      <Pressable
        style={s.botao} disabled={ocupado}
        onPress={() => rodar(async () => {
          if (!enviado) { await jarvis.auth.enviarCodigo(email); setEnviado(true); }
          else await jarvis.auth.confirmarCodigo(email, codigo);
        })}
      >
        <Text style={s.botaoTxt}>{ocupado ? '...' : enviado ? 'Entrar' : 'Enviar código'}</Text>
      </Pressable>
      {msg && <Text style={s.erro}>{msg}</Text>}
    </View>
  );
}

function Tarefas() {
  const [lista, setLista] = useState<Task[]>([]);
  const [novo, setNovo] = useState('');
  const [sync, setSync] = useState(jarvis.estado());
  const [pulsos, setPulsos] = useState<JarvisEvent[]>([]);

  const recarregar = useCallback(async () => {
    setLista(await jarvis.tarefas.listar());
    setSync(jarvis.estado());
  }, []);

  useEffect(() => {
    void recarregar();
    const a = jarvis.aoMudar(() => void recarregar());
    const b = jarvis.aoEvento((e) => setPulsos((p) => [e, ...p].slice(0, 5)));
    return () => { a(); b(); };
  }, [recarregar]);

  const adicionar = async () => {
    if (!novo.trim()) return;
    await jarvis.tarefas.criar(novo);
    setNovo('');
  };

  return (
    <View style={s.caixa}>
      <Text style={s.sub}>sync: {sync.estado}{sync.ultimoErro ? ` · ${sync.ultimoErro}` : ''}</Text>
      <View style={s.linhaNova}>
        <TextInput
          style={[s.campo, { flex: 1 }]} placeholder="nova tarefa" placeholderTextColor={C.apagado}
          value={novo} onChangeText={setNovo} onSubmitEditing={adicionar} returnKeyType="done"
        />
        <Pressable style={s.botaoMais} onPress={adicionar}><Text style={s.botaoTxt}>+</Text></Pressable>
      </View>
      <FlatList
        style={{ flexGrow: 0, maxHeight: 360 }}
        data={lista}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <Pressable
            style={s.item}
            onPress={() => void jarvis.tarefas.alternarConcluida(item.id)}
            onLongPress={() => void jarvis.tarefas.apagar(item.id)}
          >
            <Text style={[s.itemTxt, item.done_at && s.feito]}>{item.done_at ? '✓ ' : '○ '}{item.title}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={s.sub}>nenhuma tarefa</Text>}
      />
      <Text style={[s.sub, { marginTop: 16 }]}>pulsos (eventos reais):</Text>
      {pulsos.map((p) => (
        <Text key={p.id} style={s.pulso}>• {p.kind} {p.entity_type} {new Date(p.created_at).toLocaleTimeString('pt-BR')}</Text>
      ))}
      <Pressable onPress={() => void jarvis.auth.sair()}><Text style={[s.sub, { marginTop: 16 }]}>sair</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: C.fundo, paddingTop: 72, paddingHorizontal: 20 },
  titulo: { color: C.ciano, fontSize: 28, letterSpacing: 6, fontWeight: '300', textAlign: 'center', marginBottom: 24 },
  caixa: { gap: 10 },
  sub: { color: C.apagado, fontSize: 12 },
  campo: { borderWidth: 1, borderColor: C.linha, borderRadius: 10, color: '#dfe8f2', padding: 12 },
  botao: { backgroundColor: C.linha, borderRadius: 10, padding: 14, alignItems: 'center' },
  botaoMais: { backgroundColor: C.linha, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  botaoTxt: { color: C.ciano, fontSize: 16 },
  linhaNova: { flexDirection: 'row', gap: 8 },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.linha },
  itemTxt: { color: '#dfe8f2', fontSize: 16 },
  feito: { color: C.apagado, textDecorationLine: 'line-through' },
  erro: { color: C.erro },
  pulso: { color: C.ciano, fontSize: 12, opacity: 0.8 },
});
