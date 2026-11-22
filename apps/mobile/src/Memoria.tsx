// Aba "Memória" do celular: o que o J.A.R.V.I.S. aprendeu sobre o dono, com "esquecer".
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { quandoCurto, type Memory } from '@jarvis/core';
import { jarvis } from './jarvis';
import { C, MONO } from './tema';

const NOME_TIPO: Record<string, string> = {
  preferencia: 'PREFERÊNCIAS', fato: 'FATOS', nota: 'NOTAS', captura: 'CAPTURAS', diario: 'DIÁRIO',
};

export function Memoria() {
  const [lista, setLista] = useState<Memory[]>([]);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const recarregar = useCallback(async () => setLista(await jarvis.memorias.listar()), []);
  useEffect(() => {
    void recarregar();
    return jarvis.aoMudar(() => void recarregar());
  }, [recarregar]);

  const grupos = new Map<string, Memory[]>();
  for (const m of lista) grupos.set(m.kind, [...(grupos.get(m.kind) ?? []), m]);

  return (
    <View>
      <Text style={s.intro}>
        O que o J.A.R.V.I.S. aprendeu sobre você nas conversas. Peça no chat para lembrar ou esquecer algo,
        ou toque e segure um item para esquecer.
      </Text>
      {lista.length === 0 ? (
        <View style={s.vazio}>
          <Text style={s.vazioTitulo}>Ainda não sei nada sobre você.</Text>
          <Text style={s.vazioTxt}>Conte algo no chat, como seu nome ou sua rotina.</Text>
        </View>
      ) : (
        [...grupos.entries()].map(([tipo, itens]) => (
          <View key={tipo}>
            <View style={s.secao}>
              <Text style={s.secaoTxt}>{NOME_TIPO[tipo] ?? tipo.toUpperCase()} <Text style={{ color: C.texto2 }}>{itens.length}</Text></Text>
              <View style={s.secaoLinha} />
            </View>
            {itens.map((m) => {
              const cor = m.importance >= 8 ? C.ciano : m.importance >= 5 ? '#4b8fb3' : C.apagado;
              const armado = confirmando === m.id;
              return (
                <Pressable
                  key={m.id}
                  style={[s.item, armado && { borderColor: 'rgba(255,107,129,0.45)' }]}
                  onLongPress={() => setConfirmando(m.id)}
                  onPress={() => armado && setConfirmando(null)}
                >
                  <View style={[s.barra, { backgroundColor: cor }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.titulo}>
                      {m.title ?? m.content}
                      {m.sensitive ? <Text style={s.sens}>  SENSÍVEL</Text> : null}
                    </Text>
                    {m.title ? <Text style={s.texto}>{m.content}</Text> : null}
                    <Text style={s.quando}>{quandoCurto(m.updated_at)}</Text>
                  </View>
                  {armado && (
                    <Pressable
                      style={s.esquecer}
                      onPress={() => { setConfirmando(null); void jarvis.memorias.esquecer(m.id); }}
                    >
                      <Text style={s.esquecerTxt}>Esquecer</Text>
                    </Pressable>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))
      )}
    </View>
  );
}

const s = StyleSheet.create({
  intro: { color: C.texto2, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  vazio: { alignItems: 'center', paddingVertical: 36 },
  vazioTitulo: { color: C.texto2, fontWeight: '500', marginBottom: 4 },
  vazioTxt: { color: C.apagado, textAlign: 'center' },
  secao: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22, marginBottom: 10 },
  secaoTxt: { color: C.apagado, fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.8 },
  secaoLinha: { flex: 1, height: 1, backgroundColor: C.borda },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingLeft: 18, paddingRight: 10,
    borderRadius: 12, backgroundColor: C.vidroLeve, marginBottom: 6, overflow: 'hidden', borderWidth: 1, borderColor: 'transparent',
  },
  barra: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderRadius: 3 },
  titulo: { color: C.texto, fontSize: 14.5, fontWeight: '600' },
  sens: { color: C.media, fontFamily: MONO, fontSize: 9.5, fontWeight: '400' },
  texto: { color: C.texto2, fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  quando: { color: C.apagado, fontFamily: MONO, fontSize: 10, marginTop: 4 },
  esquecer: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: 'rgba(255,107,129,0.25)' },
  esquecerTxt: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
});
