import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SUPABASE_URL } from '@jarvis/core';

export default function App() {
  return (
    <View style={s.tela}>
      <Text style={s.titulo}>J.A.R.V.I.S.</Text>
      <Text style={s.sub}>Fase 0 · núcleo: {SUPABASE_URL.replace('https://', '')}</Text>
      <StatusBar style="light" />
    </View>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: '#05070d', alignItems: 'center', justifyContent: 'center' },
  titulo: { color: '#7fd8ff', fontSize: 32, letterSpacing: 6, fontWeight: '300' },
  sub: { color: '#5a6b80', marginTop: 8 },
});
