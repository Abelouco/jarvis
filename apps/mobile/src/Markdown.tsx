// Respostas formatadas no celular (mesmo leitor de Markdown do PC, no core).
// Copiar: por enquanto pelo menu Compartilhar do Android (tem "Copiar"); a cópia direta
// precisa do expo-clipboard, que entra no próximo .apk (junto com a voz).
import { Fragment, useState, type ReactNode } from 'react';
import { Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { lerMarkdown, type Bloco, type Inline } from '@jarvis/core';
import { C, MONO } from './tema';

function inline(f: Inline[], chave = ''): ReactNode[] {
  return f.map((x, i) => {
    const k = `${chave}${i}`;
    switch (x.t) {
      case 'txt': return <Fragment key={k}>{x.v}</Fragment>;
      case 'quebra': return <Fragment key={k}>{'\n'}</Fragment>;
      case 'neg': return <Text key={k} style={s.neg}>{inline(x.f, k)}</Text>;
      case 'ita': return <Text key={k} style={s.ita}>{inline(x.f, k)}</Text>;
      case 'risc': return <Text key={k} style={s.risc}>{inline(x.f, k)}</Text>;
      case 'cod': return <Text key={k} style={s.codInline}>{` ${x.v} `}</Text>;
      case 'link': return <Text key={k} style={s.link} onPress={() => void Linking.openURL(x.url)}>{inline(x.f, k)}</Text>;
    }
  });
}

export function compartilharTexto(texto: string) {
  void Share.share({ message: texto });
}

function Botao({ rotulo, aoTocar }: { rotulo: string; aoTocar: () => void }) {
  return (
    <Pressable onPress={aoTocar} hitSlop={8} style={({ pressed }) => [s.botao, pressed && { backgroundColor: 'rgba(127,216,255,0.12)' }]}>
      <Text style={s.botaoTxt}>{rotulo}</Text>
    </Pressable>
  );
}

function Paragrafos({ texto, estilo }: { texto: string; estilo?: object }) {
  return (
    <>
      {texto.split(/\n{2,}/).map((p, i) => (
        <Text key={i} style={[s.txt, { marginBottom: 10 }, estilo]} selectable>{p}</Text>
      ))}
    </>
  );
}

function CartaoTexto({ titulo, texto }: { titulo: string; texto: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <View style={[s.cartao, s.cartaoTexto]}>
      <View style={s.cab}>
        <Text style={s.cabTituloTexto} numberOfLines={1}>{titulo}</Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Botao rotulo="Copiar" aoTocar={() => compartilharTexto(texto)} />
          <Botao rotulo="Abrir" aoTocar={() => setAberto(true)} />
        </View>
      </View>
      <View style={s.cartaoCorpo}><Paragrafos texto={texto} /></View>
      <Modal visible={aberto} transparent animationType="fade" onRequestClose={() => setAberto(false)}>
        <View style={s.sobreposto}>
          <View style={s.janela}>
            <View style={s.cab}>
              <Text style={s.cabTituloTexto} numberOfLines={1}>{titulo}</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <Botao rotulo="Copiar" aoTocar={() => compartilharTexto(texto)} />
                <Botao rotulo="Fechar" aoTocar={() => setAberto(false)} />
              </View>
            </View>
            <ScrollView contentContainerStyle={{ padding: 18 }}><Paragrafos texto={texto} estilo={{ fontSize: 16 }} /></ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function BlocoMd({ b, chave }: { b: Bloco; chave: string }): ReactNode {
  switch (b.t) {
    case 'titulo':
      return <Text style={[s.txt, s[`t${b.nivel}` as 't1']]} selectable>{inline(b.f)}</Text>;
    case 'par':
      return <Text style={[s.txt, s.par]} selectable>{inline(b.f)}</Text>;
    case 'linha':
      return <View style={s.linha} />;
    case 'citacao':
      return <View style={s.citacao}>{b.filhos.map((f, i) => <BlocoMd key={i} b={f} chave={`${chave}c${i}`} />)}</View>;
    case 'lista':
      return (
        <View style={s.lista}>
          {b.itens.map((it, i) => (
            <View key={i} style={s.item}>
              <Text style={s.marcador}>
                {it.marcado !== undefined ? (it.marcado ? '☑' : '☐') : b.ordenada ? `${b.inicio + i}.` : '•'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={s.txt} selectable>{inline(it.f)}</Text>
                {it.filhos.map((f, j) => <BlocoMd key={j} b={f} chave={`${chave}l${i}.${j}`} />)}
              </View>
            </View>
          ))}
        </View>
      );
    case 'tabela':
      return (
        <ScrollView horizontal style={s.tabela} showsHorizontalScrollIndicator={false}>
          <View>
            <View style={[s.linhaTab, s.cabTab]}>
              {b.cab.map((c, i) => <Text key={i} style={[s.cel, s.celCab]}>{inline(c)}</Text>)}
            </View>
            {b.linhas.map((l, i) => (
              <View key={i} style={[s.linhaTab, i === b.linhas.length - 1 && { borderBottomWidth: 0 }]}>
                {l.map((c, j) => (
                  <Text key={j} style={[s.cel, b.alin[j] === 'd' && { textAlign: 'right' }, b.alin[j] === 'c' && { textAlign: 'center' }]} selectable>
                    {inline(c)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    case 'codigo':
      return (
        <View style={s.cartao}>
          <View style={s.cab}>
            <Text style={s.cabTitulo}>{b.lang || 'código'}</Text>
            <Botao rotulo="Copiar" aoTocar={() => compartilharTexto(b.texto)} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={s.codigo} selectable>{b.texto}</Text>
          </ScrollView>
        </View>
      );
    case 'texto':
      return <CartaoTexto titulo={b.titulo} texto={b.texto} />;
  }
}

export function RespostaMd({ texto }: { texto: string }) {
  const blocos = lerMarkdown(texto);
  return <View>{blocos.map((b, i) => <BlocoMd key={i} b={b} chave={`${i}`} />)}</View>;
}

const s = StyleSheet.create({
  txt: { color: C.texto, fontSize: 15, lineHeight: 23 },
  par: { marginBottom: 10 },
  neg: { fontWeight: '700', color: '#ffffff' },
  ita: { fontStyle: 'italic' },
  risc: { textDecorationLine: 'line-through', color: C.texto2 },
  codInline: { fontFamily: MONO, fontSize: 13, color: '#cfeeff', backgroundColor: 'rgba(127,216,255,0.1)' },
  link: { color: C.ciano, textDecorationLine: 'underline' },
  t1: { fontSize: 19, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  t2: { fontSize: 17, fontWeight: '700', marginTop: 14, marginBottom: 8, paddingBottom: 5, borderBottomWidth: 1, borderBottomColor: C.borda },
  t3: { fontSize: 15.5, fontWeight: '700', color: C.ciano, marginTop: 12, marginBottom: 6 },
  t4: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: C.texto2, marginTop: 10, marginBottom: 6 },
  linha: { height: 1, backgroundColor: C.bordaForte, marginVertical: 14, opacity: 0.6 },
  citacao: {
    marginBottom: 10, paddingHorizontal: 12, paddingTop: 10, borderRadius: 10,
    backgroundColor: 'rgba(127,216,255,0.05)', borderWidth: 1, borderColor: C.borda, borderLeftWidth: 3, borderLeftColor: C.ciano,
  },
  lista: { marginBottom: 10, gap: 5 },
  item: { flexDirection: 'row', gap: 8, paddingLeft: 2 },
  marcador: { color: C.ciano, fontSize: 14, lineHeight: 23, minWidth: 16, fontFamily: MONO },
  tabela: { marginBottom: 12, borderWidth: 1, borderColor: C.borda, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)' },
  linhaTab: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.borda },
  cabTab: { backgroundColor: 'rgba(127,216,255,0.06)' },
  cel: { width: 150, paddingHorizontal: 12, paddingVertical: 9, color: C.texto, fontSize: 13.5, lineHeight: 19 },
  celCab: { color: C.texto2, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  cartao: { marginBottom: 12, borderWidth: 1, borderColor: C.borda, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.32)' },
  cartaoTexto: { borderColor: C.bordaForte, backgroundColor: 'rgba(14,22,36,0.8)' },
  cartaoCorpo: { padding: 14, paddingBottom: 4 },
  cab: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    paddingLeft: 14, paddingRight: 6, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borda,
    backgroundColor: 'rgba(127,216,255,0.04)',
  },
  cabTitulo: { color: C.texto2, fontFamily: MONO, fontSize: 11 },
  cabTituloTexto: { flex: 1, color: C.ciano, fontWeight: '700', fontSize: 13 },
  codigo: { fontFamily: MONO, fontSize: 12.5, lineHeight: 19, color: '#d6ecff', padding: 14 },
  botao: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  botaoTxt: { color: C.texto2, fontSize: 12, fontWeight: '600' },
  sobreposto: { flex: 1, backgroundColor: 'rgba(2,4,8,0.8)', justifyContent: 'center', padding: 18 },
  janela: { maxHeight: '86%', borderRadius: 16, borderWidth: 1, borderColor: C.bordaForte, backgroundColor: '#0a1220', overflow: 'hidden' },
});
