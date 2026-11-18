/**
 * Loud, attention-grabbing notification chime (generated with Web Audio — no sound files).
 * Browsers only allow audio after the user has interacted with the page, so we track whether
 * audio is "unlocked" and let the UI offer an "Enable sound" button until it is.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlayed = 0;
const listeners = new Set<(ready: boolean) => void>();

const getContext = (): AudioContext | null => {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    // Compressor lets us push the volume up without clipping/distortion
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 6;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = 1.0;
    master.connect(compressor);
    compressor.connect(ctx.destination);
    ctx.onstatechange = () => notify();
  } catch {
    ctx = null;
  }
  return ctx;
};

const notify = () => listeners.forEach(fn => fn(isAudioReady()));

export const isAudioReady = () => !!ctx && ctx.state === 'running';

/** Subscribe to audio-ready changes; returns an unsubscribe function. */
export const onAudioReadyChange = (fn: (ready: boolean) => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

/** Call from a user gesture (click/keydown) to allow sound. */
export const unlockAudio = async (): Promise<boolean> => {
  const c = getContext();
  if (!c) return false;
  if (c.state === 'suspended') {
    try { await c.resume(); } catch { /* still locked */ }
  }
  notify();
  return c.state === 'running';
};

/** Two-tone "ding-dong" chime, loud and short (~0.7s). Throttled so bursts don't stack. */
export const playChime = (opts: { force?: boolean } = {}) => {
  const c = getContext();
  if (!c || !master) return;
  if (c.state !== 'running') return;
  const now = c.currentTime;
  if (!opts.force && Date.now() - lastPlayed < 1200) return;
  lastPlayed = Date.now();

  const note = (freq: number, start: number, dur: number, vol: number) => {
    // Sine body + a quieter triangle an octave up for "ping" brightness
    for (const [type, mult, gainMult] of [['sine', 1, 1], ['triangle', 2, 0.35]] as const) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * mult, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(vol * gainMult, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g);
      g.connect(master!);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    }
  };

  note(987.77, now, 0.32, 0.9);         // B5
  note(1318.51, now + 0.13, 0.55, 0.9); // E6
};
