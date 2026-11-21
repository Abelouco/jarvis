import { Platform } from 'react-native';

export const C = {
  fundo: '#04060b',
  vidro: 'rgba(14, 22, 36, 0.72)',
  vidroLeve: 'rgba(14, 22, 36, 0.4)',
  borda: 'rgba(127, 216, 255, 0.12)',
  bordaForte: 'rgba(127, 216, 255, 0.32)',
  ciano: '#7fd8ff',
  cianoForte: '#3cc4ff',
  texto: '#e3ecf6',
  texto2: '#9db0c6',
  apagado: '#56677d',
  alta: '#ff6b81',
  media: '#ffc56b',
  baixa: '#6be3b0',
  erro: '#ff7a8a',
};

export const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export const COR_PRIO = { alta: C.alta, media: C.media, baixa: C.baixa } as const;
export const NOME_PRIO = { alta: 'alta', media: 'média', baixa: 'baixa' } as const;
