// Aba "Conversa" do celular: mensagens da conversa atual (banco local) + campo para falar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Message } from '@jarvis/core';
import { jarvis } from './jarvis';
import { compartilharTexto, RespostaMd } from './Markdown';
import { C, MONO } from './tema';

export function Conversa({ aoCrescer }: { aoCrescer: () => void }) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [estado, setEstado] = useState(jarvis.chat.estado());
  const [texto, setTexto] = useState('');
  const qtd = useRef(-1);

  const recarregar = useCallback(async () => {
    setMsgs(await jarvis.chat.mensagens());
    setEstado(jarvis.chat.estado());
  }, []);

  useEffect(() => {
    void recarregar();
    return jarvis.aoMudar(() => void recarregar());
  }, [recarregar]);

  // Desce até a última mensagem quando chega algo novo.
  useEffect(() => {
    const n = msgs.length + (estado.pensando ? 1 : 0);
    if (n !== qtd.current) {
      qtd.current = n;
      setTimeout(aoCrescer, 60);
    }
  }, [msgs, estado.pensando, aoCrescer]);

  const enviar = () => {
    const t = texto.trim();
    if (!t || estado.pensando) return;
    setTexto('');
    // Se não deu para enviar (havia uma pergunta em aberto e ela falhou), o texto volta.
    void jarvis.chat.enviar(t).then((ok) => {
      if (!ok) setTexto((atual) => atual || t);
    });
  };

  return (
    <View>
      {msgs.length === 0 && !estado.pensando ? (
        <View style={s.vazio}>
          <Text style={s.vazioTitulo}>Às suas ordens.</Text>
          <Text style={s.vazioTxt}>Pergunte qualquer coisa.</Text>
        </View>
      ) : (
        <View style={s.lista}>
          {msgs.map((m) => <Balao key={m.id} m={m} />)}
          {estado.pensando && <Pensando />}
        </View>
      )}

      {estado.erro ? <Text style={s.erro}>{estado.erro}</Text> : null}

      <View style={s.campoCaixa}>
        <TextInput
          style={s.campo} placeholder="Fale com o J.A.R.V.I.S." placeholderTextColor={C.apagado}
          value={texto} onChangeText={setTexto} onSubmitEditing={enviar} returnKeyType="send"
          submitBehavior="submit" maxLength={4000}
        />
        <Pressable style={[s.enviar, estado.pensando && { opacity: 0.5 }]} onPress={enviar}>
          <Text style={s.enviarTxt}>↑</Text>
        </Pressable>
      </View>
      <Pressable style={s.nova} onPress={() => jarvis.chat.novaConversa()}>
        <Text style={s.novaTxt}>NOVA CONVERSA</Text>
      </Pressable>
    </View>
  );
}

function Balao({ m }: { m: Message }) {
  if (m.role === 'user') {
    return (
      <View style={s.eu}>
        <Text style={s.txt} selectable>{m.content}</Text>
      </View>
    );
  }
  return (
    <View style={s.ele}>
      <RespostaMd texto={m.content} />
      <Pressable onPress={() => compartilharTexto(m.content)} hitSlop={8} style={s.copiarTudo}>
        <Text style={s.copiarTudoTxt}>COPIAR</Text>
      </Pressable>
    </View>
  );
}

function Pensando() {
  const v = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.3, duration: 450, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [v]);
  return (
    <View style={[s.ele, { flexDirection: 'row', gap: 5, paddingVertical: 10 }]}>
      {[0, 1, 2].map((i) => <Animated.View key={i} style={[s.ponto, { opacity: v }]} />)}
    </View>
  );
}

const s = StyleSheet.create({
  lista: { gap: 12, paddingTop: 4 },
  eu: {
    alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, borderBottomRightRadius: 4, backgroundColor: 'rgba(60,196,255,0.12)',
    borderWidth: 1, borderColor: C.bordaForte,
  },
  copiarTudo: { alignSelf: 'flex-start', marginTop: 2, paddingVertical: 4 },
  copiarTudoTxt: { color: C.apagado, fontFamily: MONO, fontSize: 10, letterSpacing: 1 },
  ele: { alignSelf: 'stretch', maxWidth: '100%', paddingLeft: 12, paddingVertical: 2, borderLeftWidth: 2, borderLeftColor: C.cianoForte },
  txt: { color: C.texto, fontSize: 15, lineHeight: 22 },
  ponto: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.ciano },
  erro: { color: C.erro, fontSize: 13, marginTop: 14 },
  campoCaixa: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, paddingLeft: 16, marginTop: 16,
    backgroundColor: C.vidro, borderWidth: 1, borderColor: C.borda, borderRadius: 16,
  },
  campo: { flex: 1, color: C.texto, fontSize: 15.5, paddingVertical: 10 },
  enviar: { width: 42, height: 42, borderRadius: 11, backgroundColor: C.cianoForte, alignItems: 'center', justifyContent: 'center' },
  enviarTxt: { color: '#031018', fontSize: 20, fontWeight: '700' },
  nova: { alignSelf: 'flex-end', marginTop: 10, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: C.borda },
  novaTxt: { color: C.apagado, fontFamily: MONO, fontSize: 10, letterSpacing: 1 },
  vazio: { alignItems: 'center', paddingVertical: 36 },
  vazioTitulo: { color: C.texto2, fontWeight: '500', marginBottom: 4 },
  vazioTxt: { color: C.apagado },
});
