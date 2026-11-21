import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { C } from './tema';

/** O núcleo: anéis girando, centro respirando e uma onda a cada evento (`pulso` muda). */
export function Nucleo({ tamanho = 120, pulso = 0 }: { tamanho?: number; pulso?: number }) {
  const giro = useRef(new Animated.Value(0)).current;
  const respiro = useRef(new Animated.Value(0)).current;
  const onda = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const a = Animated.loop(Animated.timing(giro, { toValue: 1, duration: 18000, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(respiro, { toValue: 1, duration: 2250, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(respiro, { toValue: 0, duration: 2250, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    a.start();
    b.start();
    return () => { a.stop(); b.stop(); };
  }, [giro, respiro]);

  useEffect(() => {
    if (!pulso) return;
    onda.setValue(0);
    Animated.timing(onda, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [pulso, onda]);

  const t = tamanho;
  const rot = giro.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rotInv = giro.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-252deg'] });
  const rotRapido = giro.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '590deg'] });
  const escala = Animated.add(
    respiro.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }),
    onda.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.3, 0] }),
  );
  const anel = (inset: number, extra: object) => ({
    position: 'absolute' as const,
    top: t * inset, left: t * inset, right: t * inset, bottom: t * inset,
    borderRadius: t,
    borderWidth: 1,
    ...extra,
  });

  return (
    <View style={{ width: t, height: t }}>
      <Animated.View
        style={[anel(0, { borderWidth: 2, borderColor: C.ciano }), {
          opacity: onda.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
          transform: [{ scale: onda.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.35] }) }],
        }]}
      />
      <Animated.View style={[anel(0, { borderColor: C.bordaForte }), { transform: [{ rotate: rot }] }]}>
        <View style={[s.ponto, { left: t / 2 - 3 }]} />
      </Animated.View>
      <Animated.View style={[anel(0.14, { borderColor: 'rgba(127,216,255,0.18)', borderStyle: 'dashed' }), { transform: [{ rotate: rotInv }] }]} />
      <Animated.View style={[anel(0.28, { borderColor: C.bordaForte }), { transform: [{ rotate: rotRapido }] }]}>
        <View style={[s.ponto, { left: t * 0.22 - 3, width: 4, height: 4 }]} />
      </Animated.View>
      <Animated.View
        style={[anel(0.38, { borderWidth: 0, backgroundColor: C.cianoForte }), s.brilho, { transform: [{ scale: escala }] }]}
      >
        <View style={s.reflexo} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  ponto: {
    position: 'absolute', top: -3, width: 6, height: 6, borderRadius: 3,
    backgroundColor: C.ciano, shadowColor: C.ciano, shadowOpacity: 1, shadowRadius: 6, elevation: 4,
  },
  brilho: { shadowColor: C.cianoForte, shadowOpacity: 0.9, shadowRadius: 18, elevation: 12 },
  reflexo: {
    position: 'absolute', top: '14%', left: '18%', width: '42%', height: '42%',
    borderRadius: 999, backgroundColor: 'rgba(217,245,255,0.55)',
  },
});
