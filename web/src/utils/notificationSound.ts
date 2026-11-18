/**
 * Short two-note chime for new notifications (Web Audio — no sound file needed).
 * Muted with localStorage "sr-notif-sound" = "off". Browsers allow it after the user has clicked
 * something in the tab (signing in counts).
 */
const KEY = "sr-notif-sound";

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage blocked — keep the default */
  }
}

let ctx: AudioContext | null = null;

/** One bell strike: a fundamental plus bell partials, quick attack, long ring-out. */
function strike(audio: AudioContext, at: number, base: number, volume: number) {
  const master = audio.createGain();
  master.gain.value = volume;
  master.connect(audio.destination);
  // Bell-like partials: frequency ratio, relative loudness, ring time (seconds).
  const partials: Array<[number, number, number]> = [
    [1, 1, 1.8],
    [2, 0.6, 1.4],
    [2.76, 0.45, 1.1],
    [5.4, 0.25, 0.7],
    [8.93, 0.12, 0.45],
  ];
  for (const [ratio, level, ring] of partials) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = base * ratio;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0008, at + ring);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + ring + 0.05);
  }
}

function audioCtor(): typeof AudioContext | undefined {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/**
 * Browsers keep audio blocked until the person interacts with the page. After a reload the portal
 * may sit idle, and a bell fired from a timer would be silent: so the first click / key press
 * anywhere unlocks audio for the rest of the session. Call once (portal layout).
 */
export function installSoundUnlock(): () => void {
  const unlock = () => {
    try {
      const Ctor = audioCtor();
      if (!Ctor) return;
      ctx = ctx ?? new Ctor();
      if (ctx.state === "suspended") void ctx.resume();
    } catch {
      /* ignore */
    }
  };
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", unlock, opts);
  window.addEventListener("keydown", unlock, opts);
  return () => {
    window.removeEventListener("pointerdown", unlock, opts);
    window.removeEventListener("keydown", unlock, opts);
  };
}

/** True when the browser is still blocking sound (no click on the page yet). */
export function soundBlocked(): boolean {
  return !ctx || ctx.state !== "running";
}

/** Loud, clear "ding-dong" bell (about 2 seconds). */
export function playNotificationSound(): void {
  if (!soundEnabled()) return;
  try {
    const Ctor = audioCtor();
    if (!Ctor) return;
    ctx = ctx ?? new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime + 0.02;
    strike(ctx, now, 880, 0.55);
    strike(ctx, now + 0.45, 659.25, 0.55);
  } catch {
    /* audio not available: stay silent */
  }
}
