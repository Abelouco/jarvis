// O núcleo do J.A.R.V.I.S. em 3D: esfera geodésica + campos de partículas
// deformados por ruído. Cada evento real dispara uma descarga (`pulsar`).
// Não depende de DOM: o desktop passa um renderer de <canvas>, o mobile um do expo-gl.
import * as THREE from 'three';
import { RUIDO_GLSL } from './ruido';

export interface OpcoesNucleo {
  largura: number;
  altura: number;
  dpr?: number;
  /** 1 = cheio (PC). Menos no celular para poupar bateria. */
  densidade?: number;
}

/**
 * O que o J.A.R.V.I.S. está fazendo. O núcleo muda de cor, ritmo e velocidade aos poucos.
 * repouso: teal calmo · pensando: azul, giro rápido e pulsação contínua · agindo: violeta
 * permissao: âmbar, respiração lenta e forte (esperando o dono) · erro: vermelho apagado
 */
export type EstadoNucleo = 'repouso' | 'pensando' | 'agindo' | 'permissao' | 'erro';

/** Cor da descarga de um evento: criado (verde), apagado (vermelho), neutro (a cor do estado). */
export type TomPulso = 'neutro' | 'criado' | 'apagado';

export interface NoMemoria {
  id: string;
  /** 1 a 10 */
  importancia: number;
}

export interface Nucleo {
  /** Desenha um quadro. `tempo` em milissegundos (requestAnimationFrame). */
  quadro(tempo: number): void;
  /** Descarga de energia; chamada a cada evento real. */
  pulsar(forca?: number, tom?: TomPulso): void;
  /** Estado contínuo (fica até mudar). */
  definirEstado(estado: EstadoNucleo): void;
  /** Cada memória real vira um nó em volta da esfera (posição fixa pelo id; brilho pela importância). */
  definirMemorias(memorias: NoMemoria[]): void;
  /** Gira o núcleo pelo arraste (dx, dy em pixels desde o último movimento). */
  arrastar(dx: number, dy: number): void;
  /** Fim do arraste: o giro continua por inércia e desacelera. */
  soltar(): void;
  redimensionar(largura: number, altura: number, dpr?: number): void;
  destruir(): void;
}

const TEAL = new THREE.Color('#38e1cf');
const CIANO = new THREE.Color('#7fd8ff');

interface Perfil {
  cor: THREE.Color;
  /** quanto a cor do estado toma conta (0 = cores normais) */
  mistura: number;
  /** velocidade do "tempo" interno (ruído, giro) */
  velocidade: number;
  /** energia contínua (brilho e abertura dos filamentos) */
  energia: number;
  /** batidas por segundo da pulsação contínua (0 = sem) */
  ritmo: number;
  /** força da pulsação contínua */
  batida: number;
}

const PERFIS: Record<EstadoNucleo, Perfil> = {
  repouso: { cor: TEAL, mistura: 0, velocidade: 1, energia: 0, ritmo: 0, batida: 0 },
  pensando: { cor: new THREE.Color('#7aa8ff'), mistura: 0.78, velocidade: 2.6, energia: 0.22, ritmo: 1.7, batida: 0.22 },
  agindo: { cor: new THREE.Color('#b58cff'), mistura: 0.74, velocidade: 1.9, energia: 0.18, ritmo: 1.1, batida: 0.16 },
  permissao: { cor: new THREE.Color('#ffc56b'), mistura: 0.88, velocidade: 0.55, energia: 0.1, ritmo: 0.45, batida: 0.32 },
  erro: { cor: new THREE.Color('#ff6b81'), mistura: 0.7, velocidade: 0.7, energia: 0.04, ritmo: 0, batida: 0 },
};

const COR_TOM: Record<Exclude<TomPulso, 'neutro'>, THREE.Color> = {
  criado: new THREE.Color('#6be3b0'),
  apagado: new THREE.Color('#ff6b81'),
};

// ---------- campos (anéis de filamentos) ----------

const CAMPO_VERT = /* glsl */ `
${RUIDO_GLSL}
attribute float aAng;
attribute vec2 aOff;
attribute float aSemente;
attribute float aFio;
uniform float uTempo;
uniform float uPulso;
uniform float uRaio;
uniform float uEspessura;
uniform float uAmp;
uniform float uFreq;
uniform float uFase;
uniform float uTam;
uniform float uDpr;
varying float vAlfa;
varying float vBrilho;

void main() {
  vec2 dir = vec2(cos(aAng), sin(aAng));
  float t = uTempo * 0.22 + uFase;
  float fioFase = aFio * 0.37;
  float energia = 1.0 + uPulso * 2.6;

  // deformação grande (o "respirar" do campo) e fina (os filamentos se separando)
  float n1 = snoise(vec3(dir * uFreq, t + fioFase));
  float n2 = snoise(vec3(dir * uFreq * 1.6 + 11.0, t * 1.3 + fioFase * 1.5));
  float n3 = snoise(vec3(dir * 1.1 + 5.0, t * 0.7 + uFase));

  float abertura = 0.6 + (n2 * 0.5 + 0.5) * 2.2 + uPulso * 1.6;
  float r = uRaio * (1.0 + uAmp * (n1 * 0.75 + n2 * 0.25) * energia)
          + aOff.x * uEspessura * abertura;
  float z = aOff.y * uEspessura * 0.55 + n3 * uAmp * uRaio * 0.9 * energia;

  vec3 p = vec3(dir * r, z);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float prof = -mv.z;
  gl_PointSize = uTam * uDpr * (0.55 + aSemente * 0.9) * (6.0 / prof) * (1.0 + uPulso * 0.6);

  // filamentos das bordas mais nítidos, miolo da fita mais translúcido (aspecto de membrana)
  float borda = smoothstep(0.35, 1.0, abs(aOff.x));
  vAlfa = (0.35 + 0.65 * borda) * (0.5 + 0.5 * aSemente) * (0.75 + 0.25 * n2);
  vBrilho = 0.55 + 0.45 * n1 + uPulso * 0.9;
}
`;

const PONTO_FRAG = /* glsl */ `
uniform vec3 uCor;
uniform vec3 uCor2;
uniform vec3 uTinta;
uniform float uMistura;
uniform float uOpacidade;
varying float vAlfa;
varying float vBrilho;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  vec3 base = mix(uCor, uTinta, uMistura);
  vec3 claro = mix(uCor2, mix(uCor2, uTinta, 0.55), uMistura);
  vec3 cor = mix(base, claro, clamp(vBrilho - 0.6, 0.0, 1.0)) * (0.7 + vBrilho * 0.55);
  gl_FragColor = vec4(cor, a * vAlfa * uOpacidade);
}
`;

interface CampoCfg {
  n: number;
  fios: number;
  raio: number;
  espessura: number;
  amp: number;
  freq: number;
  tam: number;
  opacidade: number;
  rot: [number, number, number];
  giro: number;
  cor?: THREE.Color;
}

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

function criarCampo(cfg: CampoCfg, uComuns: Record<string, THREE.IUniform>) {
  const { n, fios } = cfg;
  const ang = new Float32Array(n);
  const off = new Float32Array(n * 2);
  const semente = new Float32Array(n);
  const fio = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = i % fios;
    ang[i] = Math.random() * Math.PI * 2;
    off[i * 2] = (fios > 1 ? (f / (fios - 1)) * 2 - 1 : 0) + gauss() * 0.035;
    off[i * 2 + 1] = gauss() * 0.25;
    semente[i] = Math.random();
    fio[i] = f;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aAng', new THREE.BufferAttribute(ang, 1));
  geo.setAttribute('aOff', new THREE.BufferAttribute(off, 2));
  geo.setAttribute('aSemente', new THREE.BufferAttribute(semente, 1));
  geo.setAttribute('aFio', new THREE.BufferAttribute(fio, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: CAMPO_VERT,
    fragmentShader: PONTO_FRAG,
    uniforms: {
      ...uComuns,
      uRaio: { value: cfg.raio },
      uEspessura: { value: cfg.espessura },
      uAmp: { value: cfg.amp },
      uFreq: { value: cfg.freq },
      uFase: { value: Math.random() * 100 },
      uTam: { value: cfg.tam },
      uCor: { value: cfg.cor ?? TEAL },
      uCor2: { value: new THREE.Color('#d8fffb') },
      uOpacidade: { value: cfg.opacidade },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.rotation.set(...cfg.rot);
  return { pts, giro: cfg.giro };
}

// ---------- poeira (partículas soltas no volume) ----------

const POEIRA_VERT = /* glsl */ `
attribute float aSemente;
uniform float uTempo;
uniform float uPulso;
uniform float uDpr;
varying float vAlfa;
varying float vBrilho;
void main() {
  vec3 p = position;
  float a = uTempo * (0.03 + aSemente * 0.05);
  p.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xy;
  p *= 1.0 + uPulso * 0.12 * aSemente;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uDpr * (1.0 + aSemente * 2.2) * (6.0 / -mv.z);
  vAlfa = (0.25 + 0.6 * aSemente) * (0.6 + 0.4 * sin(uTempo * (1.0 + aSemente * 2.0) + aSemente * 40.0));
  vBrilho = 0.6 + uPulso;
}
`;

// ---------- nós de memória ----------

const NOS_VERT = /* glsl */ `
attribute float aSemente;
attribute float aTam;
uniform float uTempo;
uniform float uPulso;
uniform float uDpr;
varying float vAlfa;
varying float vBrilho;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float cintila = 0.6 + 0.4 * sin(uTempo * (0.7 + aSemente * 1.4) + aSemente * 50.0);
  gl_PointSize = uDpr * (7.0 + aTam * 9.0 + uPulso * 4.0) * (6.0 / -mv.z);
  vAlfa = 0.5 + 0.5 * cintila;
  vBrilho = 0.85 + aTam * 0.45 + uPulso * 0.5;
}
`;

/** Embaralhador final do MurmurHash3: ids parecidos viram números bem diferentes. */
function misturar(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Três números estáveis em [0,1) a partir do id (mesma memória, mesmo lugar). */
function hashId(id: string): [number, number, number] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return [misturar(h), misturar(h ^ 0x9e3779b9), misturar(h ^ 0x7f4a7c15)];
}

// ---------- esfera geodésica ----------

const VERTICE_VERT = /* glsl */ `
attribute float aSemente;
uniform float uTempo;
uniform float uPulso;
uniform float uDpr;
varying float vAlfa;
varying float vBrilho;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float cintila = 0.5 + 0.5 * sin(uTempo * (1.5 + aSemente * 3.0) + aSemente * 60.0);
  gl_PointSize = uDpr * (2.0 + cintila * 2.5 + uPulso * 3.0) * (6.0 / -mv.z);
  vAlfa = 0.35 + 0.65 * cintila;
  vBrilho = 0.8 + uPulso;
}
`;

const BRILHO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BRILHO_FRAG = /* glsl */ `
uniform vec3 uCorBase;
uniform vec3 uTinta;
uniform float uMistura;
uniform float uPulso;
uniform float uTempo;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float nucleo = pow(max(0.0, 1.0 - d / 0.3), 2.5);
  float halo = pow(max(0.0, 1.0 - d), 4.0);
  float resp = 0.85 + 0.15 * sin(uTempo * 1.4);
  float a = (nucleo * 0.28 + halo * 0.22) * resp * (1.0 + uPulso * 1.8);
  gl_FragColor = vec4(mix(uCorBase, uTinta, uMistura), a);
}
`;

export function criarNucleo(renderer: THREE.WebGLRenderer, op: OpcoesNucleo): Nucleo {
  const dens = op.densidade ?? 1;
  let dpr = op.dpr ?? 1;

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, op.largura / op.altura, 0.1, 100);
  camera.position.set(0, 0, 8.4);

  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(dpr);
  renderer.setSize(op.largura, op.altura, false);

  const uComuns: Record<string, THREE.IUniform> = {
    uTempo: { value: 0 },
    uPulso: { value: 0 },
    uDpr: { value: dpr },
    uTinta: { value: TEAL.clone() },
    uMistura: { value: 0 },
  };

  const conjunto = new THREE.Group();
  cena.add(conjunto);

  // Campos: raio, espessura e planos diferentes para ter profundidade de verdade.
  const campos = [
    criarCampo({ n: Math.round(22000 * dens), fios: 14, raio: 2.15, espessura: 0.2, amp: 0.075, freq: 1.4, tam: 3.4, opacidade: 1.0, rot: [0.18, -0.12, 0], giro: 0.035 }, uComuns),
    criarCampo({ n: Math.round(14000 * dens), fios: 9, raio: 1.98, espessura: 0.13, amp: 0.09, freq: 2.1, tam: 2.8, opacidade: 0.8, rot: [0.55, 0.35, 0.4], giro: -0.05 }, uComuns),
    criarCampo({ n: Math.round(8000 * dens), fios: 6, raio: 1.3, espessura: 0.07, amp: 0.06, freq: 2.6, tam: 2.4, opacidade: 0.6, rot: [-0.3, 0.6, 0], giro: 0.08, cor: CIANO }, uComuns),
    criarCampo({ n: Math.round(6000 * dens), fios: 4, raio: 2.6, espessura: 0.06, amp: 0.05, freq: 1.1, tam: 2.2, opacidade: 0.45, rot: [1.15, 0.2, 0.9], giro: 0.02 }, uComuns),
  ];
  campos.forEach((c) => conjunto.add(c.pts));

  // Poeira no volume.
  {
    const n = Math.round(900 * dens);
    const pos = new Float32Array(n * 3);
    const sem = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = 0.9 + Math.pow(Math.random(), 0.7) * 2.6;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph) * 0.6], i * 3);
      sem[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSemente', new THREE.BufferAttribute(sem, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: POEIRA_VERT,
      fragmentShader: PONTO_FRAG,
      uniforms: { ...uComuns, uCor: { value: TEAL }, uCor2: { value: CIANO }, uOpacidade: { value: 0.6 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    conjunto.add(p);
  }

  // Esfera geodésica: arestas + vértices cintilando + brilho interno.
  const esfera = new THREE.Group();
  conjunto.add(esfera);
  const ico = new THREE.IcosahedronGeometry(0.62, 3);
  const arestas = new THREE.LineSegments(
    new THREE.WireframeGeometry(ico),
    new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  esfera.add(arestas);
  {
    // vértices únicos
    const p = ico.getAttribute('position');
    const vistos = new Map<string, number[]>();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!vistos.has(k)) vistos.set(k, [p.getX(i), p.getY(i), p.getZ(i)]);
    }
    const pos = new Float32Array([...vistos.values()].flat());
    const sem = new Float32Array(pos.length / 3).map(() => Math.random());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSemente', new THREE.BufferAttribute(sem, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERTICE_VERT,
      fragmentShader: PONTO_FRAG,
      uniforms: { ...uComuns, uCor: { value: TEAL }, uCor2: { value: new THREE.Color('#e6fffc') }, uOpacidade: { value: 0.95 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    esfera.add(new THREE.Points(geo, mat));
  }
  ico.dispose();

  // Nós de memória: pontos em volta da esfera, cada um ligado a ela por um filamento.
  const nos = new THREE.Group();
  esfera.add(nos);
  const matNos = new THREE.ShaderMaterial({
    vertexShader: NOS_VERT,
    fragmentShader: PONTO_FRAG,
    uniforms: { ...uComuns, uCor: { value: CIANO }, uCor2: { value: new THREE.Color('#f2fffd') }, uOpacidade: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const matFios = new THREE.LineBasicMaterial({
    color: CIANO, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  let pontosNos: THREE.Points | null = null;
  let fiosNos: THREE.LineSegments | null = null;
  let assinaturaNos = '';

  const brilho = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.ShaderMaterial({
      vertexShader: BRILHO_VERT,
      fragmentShader: BRILHO_FRAG,
      uniforms: {
        uCorBase: { value: TEAL }, uPulso: uComuns.uPulso!, uTempo: uComuns.uTempo!,
        uTinta: uComuns.uTinta!, uMistura: uComuns.uMistura!,
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  cena.add(brilho); // fora do conjunto: sempre de frente para a câmera

  // ---------- estado ----------
  let pulso = 0;
  let ultimo = 0;
  // Estado contínuo: os valores atuais andam suavemente até o perfil do estado.
  let alvo: Perfil = PERFIS.repouso;
  const atual = { cor: TEAL.clone(), mistura: 0, velocidade: 1, energia: 0, ritmo: 0, batida: 0 };
  let tempoInterno = 0;
  let fase = 0;
  // Cor da última descarga (verde = criado, vermelho = apagado), some sozinha.
  const corTom = TEAL.clone();
  let tom = 0;
  const tinta = uComuns.uTinta!.value as THREE.Color;
  const corArestas = (arestas.material as THREE.LineBasicMaterial).color;
  // Giro feito pela pessoa: orientação livre (quaternion, estilo trackball), sem limite
  // em nenhum eixo. `vel` é a velocidade angular (rad/s) em torno dos eixos da tela, para a inércia.
  const orientacao = new THREE.Quaternion();
  const vel = { x: 0, y: 0 };
  const EIXO_X = new THREE.Vector3(1, 0, 0);
  const EIXO_Y = new THREE.Vector3(0, 1, 0);
  const qPasso = new THREE.Quaternion();
  const qOscila = new THREE.Quaternion();
  const eOscila = new THREE.Euler();
  /** Gira a orientação em torno dos eixos da tela (sempre relativo ao que a pessoa vê). */
  function girar(ax: number, ay: number) {
    if (ay) orientacao.premultiply(qPasso.setFromAxisAngle(EIXO_Y, ay));
    if (ax) orientacao.premultiply(qPasso.setFromAxisAngle(EIXO_X, ax));
    orientacao.normalize();
  }
  let segurando = false;
  let ultimoArraste = 0;
  const RAD_POR_PX = 0.008;

  return {
    quadro(tempo) {
      const t = tempo / 1000;
      const dt = ultimo ? Math.min(0.05, t - ultimo) : 0.016;
      ultimo = t;

      pulso *= Math.exp(-dt * 1.9);
      tom *= Math.exp(-dt * 1.4);

      // aproxima do estado alvo (~0,6 s para mudar de humor)
      const k = 1 - Math.exp(-dt * 3.2);
      atual.cor.lerp(alvo.cor, k);
      atual.mistura += (alvo.mistura - atual.mistura) * k;
      atual.velocidade += (alvo.velocidade - atual.velocidade) * k;
      atual.energia += (alvo.energia - atual.energia) * k;
      atual.ritmo += (alvo.ritmo - atual.ritmo) * k;
      atual.batida += (alvo.batida - atual.batida) * k;

      tempoInterno += dt * atual.velocidade;
      fase += dt * atual.ritmo * Math.PI * 2;
      // batida contínua: sobe rápido e desce devagar, como um coração
      const batida = atual.batida * Math.pow(0.5 + 0.5 * Math.sin(fase), 3);
      const energiaTotal = pulso + atual.energia + batida;

      tinta.copy(atual.cor).lerp(corTom, Math.min(1, tom));
      uComuns.uMistura!.value = Math.max(atual.mistura, Math.min(0.85, tom));
      uComuns.uTempo!.value = tempoInterno;
      uComuns.uPulso!.value = energiaTotal;
      corArestas.copy(TEAL).lerp(tinta, uComuns.uMistura!.value as number);
      matFios.color.copy(CIANO).lerp(tinta, uComuns.uMistura!.value as number);
      matFios.opacity = 0.28 + energiaTotal * 0.3;

      if (!segurando) {
        // inércia: continua girando e desacelera
        girar(vel.x * dt, vel.y * dt);
        const atrito = Math.exp(-dt * 2.4);
        vel.x *= atrito;
        vel.y *= atrito;
      }
      // leve oscilação viva por cima da orientação escolhida pela pessoa
      qOscila.setFromEuler(eOscila.set(0.12 + Math.sin(t * 0.21) * 0.08, Math.sin(t * 0.17) * 0.12, 0));
      conjunto.quaternion.multiplyQuaternions(orientacao, qOscila);

      for (const c of campos) c.pts.rotation.z += c.giro * dt * atual.velocidade * (1 + pulso * 3);

      esfera.rotation.y += dt * (0.25 * atual.velocidade + pulso * 1.5);
      esfera.rotation.x += dt * 0.07 * atual.velocidade;
      esfera.scale.setScalar(1 + energiaTotal * 0.14 + Math.sin(t * 1.4) * 0.015);
      (arestas.material as THREE.LineBasicMaterial).opacity = 0.42 + energiaTotal * 0.4;

      renderer.render(cena, camera);
    },
    pulsar(forca = 1, tomPulso: TomPulso = 'neutro') {
      pulso = Math.min(1.6, pulso + forca);
      if (tomPulso !== 'neutro') {
        corTom.copy(COR_TOM[tomPulso]);
        tom = 1;
      }
    },
    definirEstado(estado) {
      alvo = PERFIS[estado] ?? PERFIS.repouso;
    },
    definirMemorias(memorias) {
      const lista = memorias.slice(0, 400);
      const assinatura = lista.map((m) => `${m.id}:${m.importancia}`).join(',');
      if (assinatura === assinaturaNos) return;
      assinaturaNos = assinatura;
      if (pontosNos) { nos.remove(pontosNos); pontosNos.geometry.dispose(); pontosNos = null; }
      if (fiosNos) { nos.remove(fiosNos); fiosNos.geometry.dispose(); fiosNos = null; }
      if (!lista.length) return;

      const pos = new Float32Array(lista.length * 3);
      const sem = new Float32Array(lista.length);
      const tam = new Float32Array(lista.length);
      const fios = new Float32Array(lista.length * 6);
      lista.forEach((m, i) => {
        const [a, b, c] = hashId(m.id);
        const th = a * Math.PI * 2;
        const ph = Math.acos(2 * b - 1);
        const dir = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph));
        const imp = Math.min(10, Math.max(1, m.importancia)) / 10;
        // as mais importantes ficam mais perto do centro
        const r = 1.18 - imp * 0.32 + c * 0.12;
        const p = dir.clone().multiplyScalar(r);
        pos.set([p.x, p.y, p.z], i * 3);
        sem[i] = c;
        tam[i] = imp;
        const base = dir.clone().multiplyScalar(0.64);
        fios.set([base.x, base.y, base.z, p.x, p.y, p.z], i * 6);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSemente', new THREE.BufferAttribute(sem, 1));
      geo.setAttribute('aTam', new THREE.BufferAttribute(tam, 1));
      pontosNos = new THREE.Points(geo, matNos);
      pontosNos.frustumCulled = false;
      const geoFios = new THREE.BufferGeometry();
      geoFios.setAttribute('position', new THREE.BufferAttribute(fios, 3));
      fiosNos = new THREE.LineSegments(geoFios, matFios);
      nos.add(fiosNos, pontosNos);
    },
    arrastar(dx, dy) {
      const agora = Date.now() / 1000;
      const intervalo = Math.min(0.1, Math.max(0.008, agora - ultimoArraste));
      ultimoArraste = agora;
      segurando = true;
      girar(dy * RAD_POR_PX, dx * RAD_POR_PX);
      // velocidade suavizada, para a inércia sair natural ao soltar
      vel.y = vel.y * 0.6 + ((dx * RAD_POR_PX) / intervalo) * 0.4;
      vel.x = vel.x * 0.6 + ((dy * RAD_POR_PX) / intervalo) * 0.4;
    },
    soltar() {
      segurando = false;
      const max = 6;
      vel.x = Math.max(-max, Math.min(max, vel.x));
      vel.y = Math.max(-max, Math.min(max, vel.y));
    },
    redimensionar(largura, altura, novoDpr) {
      if (novoDpr) {
        dpr = novoDpr;
        uComuns.uDpr!.value = dpr;
        renderer.setPixelRatio(dpr);
      }
      camera.aspect = largura / altura;
      camera.updateProjectionMatrix();
      renderer.setSize(largura, altura, false);
    },
    destruir() {
      cena.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((x) => x.dispose());
      });
    },
  };
}
