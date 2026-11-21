import * as THREE from 'three';
import { criarNucleo, type Nucleo } from '@jarvis/nucleo';

export interface NucleoMontado {
  pulsar(forca?: number): void;
  destruir(): void;
}

/** Monta o núcleo 3D dentro de `caixa` (ocupa o tamanho dela) e anima até destruir. */
export function montarNucleo(caixa: HTMLElement, densidade = 1): NucleoMontado {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  caixa.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const nucleo: Nucleo = criarNucleo(renderer, {
    largura: caixa.clientWidth || 300,
    altura: caixa.clientHeight || 300,
    dpr,
    densidade,
  });

  const obs = new ResizeObserver(() => {
    if (caixa.clientWidth && caixa.clientHeight) nucleo.redimensionar(caixa.clientWidth, caixa.clientHeight, dpr);
  });
  obs.observe(caixa);

  const aoMover = (e: PointerEvent) => {
    const r = caixa.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
    const y = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
    nucleo.olhar(x, y);
  };
  window.addEventListener('pointermove', aoMover);

  let quadro = requestAnimationFrame(function laco(t) {
    nucleo.quadro(t);
    quadro = requestAnimationFrame(laco);
  });

  return {
    pulsar: (f) => nucleo.pulsar(f),
    destruir() {
      cancelAnimationFrame(quadro);
      window.removeEventListener('pointermove', aoMover);
      obs.disconnect();
      nucleo.destruir();
      renderer.dispose();
      canvas.remove();
    },
  };
}
