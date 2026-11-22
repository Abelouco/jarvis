import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, PixelRatio, View } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';
import { criarNucleo, type EstadoNucleo, type NoMemoria, type Nucleo as Cena, type TomPulso } from '@jarvis/nucleo';

/** Uma descarga do núcleo: `n` muda a cada evento. */
export interface Pulso {
  n: number;
  forca: number;
  tom: TomPulso;
}

/**
 * O núcleo 3D no celular (expo-gl + Three.js, mesma cena do PC).
 * `pulso`: cada vez que `n` muda, o núcleo descarrega energia (com a cor do evento).
 * `estado`: o que a IA está fazendo agora (pensando, esperando permissão...).
 */
export function Nucleo({ tamanho = 240, pulso, estado = 'repouso', memorias }: {
  tamanho?: number; pulso?: Pulso; estado?: EstadoNucleo; memorias?: NoMemoria[];
}) {
  const cena = useRef<Cena | null>(null);
  const quadro = useRef<number | null>(null);
  const estadoAtual = useRef(estado);
  const memoriasAtuais = useRef(memorias);

  useEffect(() => {
    if (pulso?.n) cena.current?.pulsar(pulso.forca, pulso.tom);
  }, [pulso]);

  useEffect(() => {
    memoriasAtuais.current = memorias;
    if (memorias) cena.current?.definirMemorias(memorias);
  }, [memorias]);

  useEffect(() => {
    estadoAtual.current = estado;
    cena.current?.definirEstado(estado);
  }, [estado]);

  // Girar com o dedo, como um modelo 3D. Enquanto arrasta, a tela não rola.
  const arraste = useMemo(() => {
    let antes = { x: 0, y: 0 };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { antes = { x: 0, y: 0 }; },
      onPanResponderMove: (_e, g) => {
        cena.current?.arrastar(g.dx - antes.x, g.dy - antes.y);
        antes = { x: g.dx, y: g.dy };
      },
      onPanResponderRelease: () => cena.current?.soltar(),
      onPanResponderTerminate: () => cena.current?.soltar(),
    });
  }, []);

  useEffect(
    () => () => {
      if (quadro.current) cancelAnimationFrame(quadro.current);
      cena.current?.destruir();
      cena.current = null;
    },
    [],
  );

  const [semWebGL2, setSemWebGL2] = useState(false);

  const aoCriar = (gl: ExpoWebGLRenderingContext) => {
    // Three.js só funciona com WebGL2 (OpenGL ES 3). Sem isso, mostra o núcleo simples.
    if (!(gl as unknown as { supportsWebGL2?: boolean }).supportsWebGL2) {
      setSemWebGL2(true);
      return;
    }
    try {
      iniciarCena(gl);
    } catch (e) {
      console.warn('[nucleo] falhou ao iniciar o 3D:', e);
      setSemWebGL2(true);
    }
  };

  const iniciarCena = (gl: ExpoWebGLRenderingContext) => {
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
    n.definirEstado(estadoAtual.current);
    if (memoriasAtuais.current) n.definirMemorias(memoriasAtuais.current);

    const laco = (t: number) => {
      n.quadro(t);
      gl.endFrameEXP();
      quadro.current = requestAnimationFrame(laco);
    };
    quadro.current = requestAnimationFrame(laco);
  };

  return (
    <View style={{ width: tamanho, height: tamanho }} {...arraste.panHandlers}>
      {semWebGL2 ? <NucleoSimples tamanho={tamanho} /> : <GLView style={{ flex: 1 }} onContextCreate={aoCriar} />}
    </View>
  );
}

/** Reserva para aparelhos sem WebGL2: esfera luminosa com anel. */
function NucleoSimples({ tamanho }: { tamanho: number }) {
  const esfera = tamanho * 0.26;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute', width: tamanho * 0.78, height: tamanho * 0.78, borderRadius: tamanho,
          borderWidth: 1, borderColor: 'rgba(56,225,207,0.35)',
        }}
      />
      <View
        style={{
          width: esfera, height: esfera, borderRadius: esfera, backgroundColor: '#38e1cf',
          shadowColor: '#38e1cf', shadowOpacity: 1, shadowRadius: 24, elevation: 16, opacity: 0.85,
        }}
      />
    </View>
  );
}
