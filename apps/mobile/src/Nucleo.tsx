import { useEffect, useRef } from 'react';
import { PixelRatio, View } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';
import { criarNucleo, type Nucleo as Cena } from '@jarvis/nucleo';

/**
 * O núcleo 3D no celular (expo-gl + Three.js, mesma cena do PC).
 * `pulso` é um contador: cada vez que muda, o núcleo descarrega energia.
 */
export function Nucleo({ tamanho = 240, pulso = 0 }: { tamanho?: number; pulso?: number }) {
  const cena = useRef<Cena | null>(null);
  const quadro = useRef<number | null>(null);

  useEffect(() => {
    if (pulso) cena.current?.pulsar();
  }, [pulso]);

  useEffect(
    () => () => {
      if (quadro.current) cancelAnimationFrame(quadro.current);
      cena.current?.destruir();
      cena.current = null;
    },
    [],
  );

  const aoCriar = (gl: ExpoWebGLRenderingContext) => {
    const { drawingBufferWidth: w, drawingBufferHeight: h } = gl;
    // O Three espera um <canvas>; o expo-gl só dá o contexto. Um canvas mínimo basta.
    const canvas = {
      width: w, height: h, style: {}, clientWidth: w, clientHeight: h,
      addEventListener: () => {}, removeEventListener: () => {}, getContext: () => gl,
    } as unknown as HTMLCanvasElement;
    const renderer = new THREE.WebGLRenderer({ canvas, context: gl as unknown as WebGL2RenderingContext, alpha: true, antialias: false });
    // drawingBuffer vem em pixels físicos: passa o tamanho em pontos + a densidade real,
    // assim o renderer volta ao mesmo buffer e as partículas ficam do tamanho certo.
    const dpr = PixelRatio.get();
    const n = criarNucleo(renderer, { largura: w / dpr, altura: h / dpr, dpr, densidade: 0.55 });
    cena.current = n;

    const laco = (t: number) => {
      n.quadro(t);
      gl.endFrameEXP();
      quadro.current = requestAnimationFrame(laco);
    };
    quadro.current = requestAnimationFrame(laco);
  };

  return (
    <View style={{ width: tamanho, height: tamanho }}>
      <GLView style={{ flex: 1 }} onContextCreate={aoCriar} />
    </View>
  );
}
