// Respostas formatadas no celular (mesmo leitor de Markdown do PC, no core).
// Copiar: por enquanto pelo menu Compartilhar do Android (tem "Copiar"); a cópia direta
// precisa do expo-clipboard, que entra no próximo .apk (junto com a voz).
import { Fragment, useState, type ReactNode } from 'react';
import { Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { lerMarkdown, type Bloco, type Inline, type Shell } from '@jarvis/core';

const NOME_SHELL: Record<Shell, string> = { powershell: 'PowerShell', cmd: 'Prompt de comando', bash: 'Terminal' };

interface Acoes {
  /** Só a última resposta tem as opções clicáveis. */
  aoEscolher?: (opcao: string) => void;
}
import { C, MONO } from './tema';

/** Fontes da resposta que está sendo desenhada (as citações [n] apontam para elas). */
let fontesAtuais: { titulo: string; url: string }[] = [];

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
      case 'cita': {
        const fonte = fontesAtuais[x.n - 1];
        return fonte
          ? <Text key={k} style={s.cita} onPress={() => void Linking.openURL(fonte.url)}>{` ${x.n} `}</Text>
          : null;
      }
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

function BlocoMd({ b, chave, acoes }: { b: Bloco; chave: string; acoes?: Acoes }): ReactNode {
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
    case 'comando':
      // No celular não dá para rodar no PC: só copiar.
      return (
        <View style={[s.cartao, { borderColor: 'rgba(127,216,255,0.22)' }]}>
          <View style={s.cab}>
            <Text style={s.cabTitulo}>{NOME_SHELL[b.shell]}</Text>
            <Botao rotulo="Copiar" aoTocar={() => compartilharTexto(b.texto)} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={s.codigo} selectable>{b.texto}</Text>
          </ScrollView>
        </View>
      );
    case 'opcoes': {
      const ativas = !!acoes?.aoEscolher;
      return (
        <View style={[s.opcoes, !ativas && { opacity: 0.55 }]}>
          {b.pergunta ? <Text style={s.opcoesPergunta}>{b.pergunta}</Text> : null}
          {b.itens.map((it, i) => (
            <Pressable
              key={i}
              disabled={!ativas}
              onPress={() => acoes?.aoEscolher?.(it)}
              style={({ pressed }) => [s.opcao, pressed && { backgroundColor: 'rgba(60,196,255,0.14)', borderColor: C.bordaForte }]}
            >
              <Text style={s.opcaoN}>{i + 1}</Text>
              <Text style={s.opcaoTxt}>{it}</Text>
            </Pressable>
          ))}
        </View>
      );
    }
  }
}

export function RespostaMd({ texto, aoEscolher, fontes = [] }: { texto: string; fontes?: { titulo: string; url: string }[] } & Acoes) {
  fontesAtuais = fontes;
  const blocos = lerMarkdown(texto);
  // O cartão de opções sempre vai no fim da resposta.
  const ordenados = [...blocos.filter((b) => b.t !== 'opcoes'), ...blocos.filter((b) => b.t === 'opcoes')];
  return <View>{ordenados.map((b, i) => <BlocoMd key={i} b={b} chave={`${i}`} acoes={{ aoEscolher }} />)}</View>;
}

const s = StyleSheet.create({
  txt: { color: C.texto, fontSize: 15, lineHeight: 23 },
  par: { marginBottom: 10 },
  neg: { fontWeight: '700', color: '#ffffff' },
  ita: { fontStyle: 'italic' },
  risc: { textDecorationLine: 'line-through', color: C.texto2 },
  codInline: { fontFamily: MONO, fontSize: 13, color: '#cfeeff', backgroundColor: 'rgba(127,216,255,0.1)' },
  link: { color: C.ciano, textDecorationLine: 'underline' },
  cita: { color: C.ciano, fontFamily: MONO, fontSize: 11, backgroundColor: 'rgba(127,216,255,0.14)' },
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
  opcoes: {
    marginTop: 10, marginBottom: 4, padding: 12, gap: 6, borderRadius: 14, borderWidth: 1, borderColor: C.bordaForte,
    backgroundColor: 'rgba(60,196,255,0.06)',
  },
  opcoesPergunta: { color: C.texto, fontWeight: '700', fontSize: 14, marginBottom: 4, marginLeft: 2 },
  opcao: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11,
    borderRadius: 10, borderWidth: 1, borderColor: C.borda, backgroundColor: 'rgba(0,0,0,0.25)',
  },
  opcaoN: {
    width: 22, height: 22, borderRadius: 6, textAlign: 'center', textAlignVertical: 'center', lineHeight: 22,
    color: C.ciano, fontFamily: MONO, fontSize: 11.5, backgroundColor: 'rgba(127,216,255,0.1)', overflow: 'hidden',
  },
  opcaoTxt: { flex: 1, color: C.texto, fontSize: 14, lineHeight: 19 },
  sobreposto: { flex: 1, backgroundColor: 'rgba(2,4,8,0.8)', justifyContent: 'center', padding: 18 },
  janela: { maxHeight: '86%', borderRadius: 16, borderWidth: 1, borderColor: C.bordaForte, backgroundColor: '#0a1220', overflow: 'hidden' },
});
