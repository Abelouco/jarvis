import * as THREE from 'three';
import { criarNucleo, type EstadoNucleo, type Nucleo, type TomPulso } from '@jarvis/nucleo';

export interface NucleoMontado {
  pulsar(forca?: number, tom?: TomPulso): void;
  definirEstado(estado: EstadoNucleo): void;
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

  // Girar arrastando, como um modelo 3D. Fora do arraste ele não segue o mouse.
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  let ultimo: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    ultimo = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ultimo) return;
    nucleo.arrastar(e.clientX - ultimo.x, e.clientY - ultimo.y);
    ultimo = { x: e.clientX, y: e.clientY };
  });
  const aoSoltar = () => {
    if (!ultimo) return;
    ultimo = null;
    nucleo.soltar();
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', aoSoltar);
  canvas.addEventListener('pointercancel', aoSoltar);

  let quadro = requestAnimationFrame(function laco(t) {
    nucleo.quadro(t);
    quadro = requestAnimationFrame(laco);
  });

  return {
    pulsar: (f, tom) => nucleo.pulsar(f, tom),
    definirEstado: (e) => nucleo.definirEstado(e),
    destruir() {
      cancelAnimationFrame(quadro);
      obs.disconnect();
      nucleo.destruir();
      renderer.dispose();
      canvas.remove();
    },
  };
}
