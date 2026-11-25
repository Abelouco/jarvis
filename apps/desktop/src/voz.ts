// Voz no PC: gravar o que o dono fala (para o Whisper transcrever) e ler respostas em voz alta.
// Fala com a voz natural do Piper (neural, roda no PC, grátis; voz masculina pt-BR "faber",
// não é clone de ninguém). Enquanto ela não está instalada, usa a voz do Windows.
import { invoke } from '@tauri-apps/api/core';


// ---------- gravar ----------

export interface Gravacao {
  /** Para de gravar e devolve o áudio (ou null se nada foi dito). */
  parar(): Promise<Blob | null>;
  /** Descarta sem enviar. */
  cancelar(): void;
}

interface OpcoesGravar {
  /** Nível da voz de 0 a 1, várias vezes por segundo (o núcleo pulsa com ele). */
  aoNivel?: (nivel: number) => void;
  /** Chamado quando a fala termina sozinha (silêncio depois de falar) ou bate o tempo máximo. */
  aoTerminar?: () => void;
}

const SILENCIO_FIM_MS = 1600; // depois de começar a falar, esse tempo calado encerra
const SEM_FALA_MS = 8000; // se não disser nada em 8 s, encerra
const MAXIMO_MS = 60_000;

export async function gravar({ aoNivel, aoTerminar }: OpcoesGravar = {}): Promise<Gravacao> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const gravador = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 32_000 } : undefined);
  const partes: Blob[] = [];
  gravador.ondataavailable = (e) => e.data.size && partes.push(e.data);

  // Medidor de volume (para o núcleo e para saber quando a pessoa parou de falar).
  const ctx = new AudioContext();
  const fonte = ctx.createMediaStreamSource(stream);
  const analisador = ctx.createAnalyser();
  analisador.fftSize = 1024;
  fonte.connect(analisador);
  const amostras = new Float32Array(analisador.fftSize);

  const inicio = Date.now();
  let falou = false;
  let ultimoSom = Date.now();
  let encerrado = false;
  let quadro = 0;

  const medir = () => {
    if (encerrado) return;
    analisador.getFloatTimeDomainData(amostras);
    let soma = 0;
    for (const v of amostras) soma += v * v;
    const nivel = Math.min(1, Math.sqrt(soma / amostras.length) * 9);
    aoNivel?.(nivel);
    if (nivel > 0.12) {
      falou = true;
      ultimoSom = Date.now();
    }
    const agora = Date.now();
    if ((falou && agora - ultimoSom > SILENCIO_FIM_MS) || (!falou && agora - inicio > SEM_FALA_MS) || agora - inicio > MAXIMO_MS) {
      aoTerminar?.();
      return;
    }
    quadro = requestAnimationFrame(medir);
  };
  quadro = requestAnimationFrame(medir);

  gravador.start(250);

  const encerrar = () => {
    encerrado = true;
    cancelAnimationFrame(quadro);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  return {
    parar() {
      return new Promise((resolver) => {
        if (gravador.state === 'inactive') {
          encerrar();
          resolver(null);
          return;
        }
        gravador.onstop = () => {
          encerrar();
          const audio = new Blob(partes, { type: gravador.mimeType || 'audio/webm' });
          resolver(falou && audio.size > 800 ? audio : null);
        };
        gravador.stop();
      });
    },
    cancelar() {
      gravador.onstop = null;
      if (gravador.state !== 'inactive') gravador.stop();
      encerrar();
    },
  };
}


// ---------- falar ----------

export interface EstadoVoz {
  instalada: boolean;
  baixando: boolean;
  baixado: number;
  total: number;
  pasta: string;
}

export const estadoVoz = () => invoke<EstadoVoz>('voz_estado');

/** Baixa e instala a voz natural (~85 MB, uma vez só). */
export async function instalarVoz() {
  await invoke<void>('voz_instalar');
  natural = null;
}

let natural: boolean | null = null;
async function temVozNatural(): Promise<boolean> {
  if (natural === null) {
    try {
      natural = (await estadoVoz()).instalada;
    } catch {
      natural = false;
    }
  }
  return natural;
}

/** Frases agrupadas em trechos curtos: a primeira sai rápido e as próximas são geradas enquanto ela toca. */
function emFrases(texto: string): string[] {
  const frases = texto.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [texto];
  const out: string[] = [];
  let atual = '';
  for (const f of frases) {
    const limite = out.length ? 220 : 90; // o primeiro trecho é menor, para começar a falar logo
    if ((atual + f).length > limite && atual) {
      out.push(atual.trim());
      atual = '';
    }
    atual += f;
  }
  if (atual.trim()) out.push(atual.trim());
  return out.filter((f) => /[\p{L}\p{N}]/u.test(f));
}

// Timbre do J.A.R.V.I.S.: um pouco mais grave (tocada ~5% abaixo, cerca de um semitom; o Piper
// já gera ~8% mais rápida, então o ritmo fica natural) e um equalizador leve, mais encorpado.
const TOM = 0.95;

let ctx: AudioContext | null = null;
let entrada: AudioNode | null = null;
let analisador: AnalyserNode | null = null;
let fonteAtual: AudioBufferSourceNode | null = null;

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    const graves = ctx.createBiquadFilter();
    graves.type = 'lowshelf';
    graves.frequency.value = 180;
    graves.gain.value = 3;
    const presenca = ctx.createBiquadFilter();
    presenca.type = 'peaking';
    presenca.frequency.value = 3200;
    presenca.Q.value = 0.9;
    presenca.gain.value = 1.5;
    const chiado = ctx.createBiquadFilter();
    chiado.type = 'highshelf';
    chiado.frequency.value = 8000;
    chiado.gain.value = -3;
    analisador = ctx.createAnalyser();
    analisador.fftSize = 512;
    graves.connect(presenca).connect(chiado).connect(analisador).connect(ctx.destination);
    entrada = graves;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

async function sintetizar(frase: string): Promise<AudioBuffer> {
  const bytes = await invoke<ArrayBuffer>('voz_falar', { texto: frase });
  return audio().decodeAudioData(bytes);
}

let geracao = 0; // cada falar() novo (ou calar) invalida a fala anterior
let falando = false;

export function estaFalando() {
  return falando;
}

function tocar(buffer: AudioBuffer, aoPulso: (() => void) | undefined, minha: number): Promise<void> {
  return new Promise((resolver) => {
    const c = audio();
    const fonte = c.createBufferSource();
    fonte.buffer = buffer;
    fonte.playbackRate.value = TOM;
    fonte.connect(entrada!);
    fonteAtual = fonte;
    const amostras = new Float32Array(analisador!.fftSize);
    let ultimoPulso = 0;
    let quadro = 0;
    // O núcleo pulsa nas sílabas mais fortes.
    const medir = () => {
      if (minha !== geracao) return;
      analisador!.getFloatTimeDomainData(amostras);
      let soma = 0;
      for (const v of amostras) soma += v * v;
      const nivel = Math.sqrt(soma / amostras.length) * 6;
      const agora = performance.now();
      if (nivel > 0.25 && agora - ultimoPulso > 170) {
        ultimoPulso = agora;
        aoPulso?.();
      }
      quadro = requestAnimationFrame(medir);
    };
    fonte.onended = () => {
      cancelAnimationFrame(quadro);
      if (fonteAtual === fonte) fonteAtual = null;
      resolver();
    };
    fonte.start();
    quadro = requestAnimationFrame(medir);
  });
}

/** Lê o texto em voz alta. `aoPulso` é chamado no ritmo da fala (o núcleo pulsa junto). */
export function falar(texto: string, aoPulso?: () => void, aoFim?: () => void) {
  calar();
  const minha = ++geracao;
  const frases = emFrases(texto);
  const terminar = () => {
    if (minha !== geracao) return;
    falando = false;
    aoFim?.();
  };
  if (!frases.length) {
    aoFim?.();
    return;
  }
  falando = true;
  void (async () => {
    if (!(await temVozNatural())) return falarWindows(frases, aoPulso, terminar, minha);
    let i = 0;
    try {
      let proxima = sintetizar(frases[0]!);
      for (; i < frases.length; i++) {
        const buffer = await proxima;
        if (minha !== geracao) return;
        if (i + 1 < frases.length) {
          proxima = sintetizar(frases[i + 1]!);
          proxima.catch(() => {}); // se for cancelada, o erro não importa
        }
        await tocar(buffer, aoPulso, minha);
        if (minha !== geracao) return;
      }
      terminar();
    } catch (e) {
      console.warn('voz natural falhou, usando a do Windows', e);
      if (minha === geracao) falarWindows(frases.slice(i), aoPulso, terminar, minha);
    }
  })();
}

// ---- reserva: voz do Windows ----

let vozWindows: SpeechSynthesisVoice | null = null;

/** Voz do Windows em pt-BR; prefere as "naturais" e as masculinas. */
function escolherVozWindows(): SpeechSynthesisVoice | null {
  if (vozWindows) return vozWindows;
  const vozes = speechSynthesis.getVoices().filter((v) => /^pt(-|_)?BR/i.test(v.lang));
  const nota = (v: SpeechSynthesisVoice) =>
    (/natural|online|neural/i.test(v.name) ? 4 : 0)
    + (/antonio|daniel|donato|fabio|humberto|julio|nicolau|valerio/i.test(v.name) ? 2 : 0);
  vozWindows = vozes.sort((a, b) => nota(b) - nota(a))[0] ?? null;
  return vozWindows;
}
if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => { vozWindows = null; };

function falarWindows(frases: string[], aoPulso: (() => void) | undefined, terminar: () => void, minha: number) {
  if (typeof speechSynthesis === 'undefined' || !frases.length || minha !== geracao) return terminar();
  frases.forEach((frase, i) => {
    const u = new SpeechSynthesisUtterance(frase);
    const voz = escolherVozWindows();
    if (voz) u.voice = voz;
    u.lang = voz?.lang ?? 'pt-BR';
    u.rate = 1.05;
    u.pitch = 0.95;
    u.onboundary = (e) => {
      if (e.name === 'word') aoPulso?.();
    };
    if (i === frases.length - 1) {
      u.onend = terminar;
      u.onerror = terminar;
    }
    speechSynthesis.speak(u);
  });
}

export function calar() {
  geracao++;
  falando = false;
  if (fonteAtual) {
    try {
      fonteAtual.stop();
    } catch {
      /* já tinha parado */
    }
    fonteAtual = null;
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
