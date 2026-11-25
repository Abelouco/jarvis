// Voz no PC: gravar o que o dono fala (para o Whisper transcrever) e ler respostas em voz alta.
// Fala com a voz do Windows (grátis, sem rede), no perfil "lento, confiante e distante":
// um pouco mais devagar e mais grave que o normal. Nunca uma voz clonada de pessoa real.

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

let vozEscolhida: SpeechSynthesisVoice | null = null;

/** Voz do Windows em português do Brasil; prefere as masculinas e as "naturais" (mais humanas). */
function escolherVoz(): SpeechSynthesisVoice | null {
  if (vozEscolhida) return vozEscolhida;
  const vozes = speechSynthesis.getVoices().filter((v) => /^pt(-|_)?BR/i.test(v.lang));
  const nota = (v: SpeechSynthesisVoice) =>
    (/natural|online|neural/i.test(v.name) ? 4 : 0)
    + (/antonio|daniel|donato|fabio|humberto|julio|nicolau|valerio/i.test(v.name) ? 2 : 0)
    + (v.localService ? 0 : 1);
  vozEscolhida = vozes.sort((a, b) => nota(b) - nota(a))[0] ?? null;
  return vozEscolhida;
}
if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => { vozEscolhida = null; };

/** Frases curtas: o leitor do Windows corta textos muito longos de uma vez. */
function emFrases(texto: string): string[] {
  const frases = texto.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [texto];
  const out: string[] = [];
  let atual = '';
  for (const f of frases) {
    if ((atual + f).length > 220 && atual) {
      out.push(atual.trim());
      atual = '';
    }
    atual += f;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}

let falando = false;

export function estaFalando() {
  return falando;
}

/** Lê o texto em voz alta. `aoPalavra` é chamado a cada palavra (o núcleo pulsa junto). */
export function falar(texto: string, aoPalavra?: () => void, aoFim?: () => void) {
  if (typeof speechSynthesis === 'undefined' || !texto.trim()) {
    aoFim?.();
    return;
  }
  speechSynthesis.cancel();
  const frases = emFrases(texto);
  falando = true;
  frases.forEach((frase, i) => {
    const u = new SpeechSynthesisUtterance(frase);
    const voz = escolherVoz();
    if (voz) u.voice = voz;
    u.lang = voz?.lang ?? 'pt-BR';
    u.rate = 0.92; // um pouco mais lento
    u.pitch = 0.82; // mais grave
    u.onboundary = (e) => {
      if (e.name === 'word') aoPalavra?.();
    };
    if (i === frases.length - 1) {
      u.onend = () => {
        falando = false;
        aoFim?.();
      };
    }
    u.onerror = () => {
      if (i === frases.length - 1) {
        falando = false;
        aoFim?.();
      }
    };
    speechSynthesis.speak(u);
  });
}

export function calar() {
  falando = false;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
