/** Efek suara sintetis lewat Web Audio: tanpa berkas audio, tanpa pihak ketiga. */
import type { KV } from "./storage";

export type SoundName = "dice" | "capture" | "place" | "pass" | "turn" | "nudge" | "start" | "win" | "lose" | "chat" | "error";

export interface SoundLike {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  play(name: SoundName): void;
  /** Panggil dari gestur pengguna pertama (kebijakan putar-otomatis peramban). */
  unlock(): void;
}

/** Bagian kecil dari AudioContext yang dipakai, agar bisa diganti di uji. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  exponentialRampToValueAtTime(v: number, t: number): unknown;
}
export interface AudioNodeLike {
  connect(dest: unknown): unknown;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly sampleRate: number;
  readonly state: string;
  resume(): Promise<void> | void;
  createOscillator(): AudioNodeLike & { type: string; frequency: AudioParamLike; start(t: number): void; stop(t: number): void };
  createGain(): AudioNodeLike & { gain: AudioParamLike };
  createBiquadFilter(): AudioNodeLike & { type: string; frequency: AudioParamLike; Q: AudioParamLike };
  createBufferSource(): AudioNodeLike & { buffer: unknown; start(t: number): void; stop(t: number): void };
  createBuffer(channels: number, length: number, rate: number): { getChannelData(c: number): Float32Array };
}

const KEY = "gmers.sound";
const MASTER = 0.35;

export class SoundPlayer implements SoundLike {
  private ctx: AudioContextLike | null = null;
  private noiseBuf: unknown = null;
  private on: boolean;

  constructor(
    private readonly kv?: KV,
    private readonly createContext: () => AudioContextLike | null = defaultContext,
  ) {
    this.on = kv ? kv.get(KEY) !== "off" : true;
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    this.kv?.set(KEY, on ? "on" : "off");
    if (on) this.unlock();
  }

  unlock(): void {
    const c = this.context();
    if (c && c.state === "suspended") void c.resume();
  }

  private context(): AudioContextLike | null {
    if (!this.ctx) {
      try {
        this.ctx = this.createContext();
      } catch {
        this.ctx = null;
      }
    }
    return this.ctx;
  }

  play(name: SoundName): void {
    if (!this.on) return;
    const c = this.context();
    if (!c) return;
    try {
      if (c.state === "suspended") void c.resume();
      const t = c.currentTime;
      switch (name) {
        case "dice": // dadu berderak
          for (let i = 0; i < 5; i++) this.noise(c, t + i * 0.05, 0.04, 0.7, 1200 + i * 350);
          this.tone(c, t + 0.26, 0.08, 300, 220, "triangle", 0.6);
          break;
        case "capture": // bidak dimakan: dentum turun
          this.tone(c, t, 0.18, 320, 90, "sawtooth", 0.5);
          this.noise(c, t, 0.08, 0.8, 700);
          break;
        case "place": // klak kartu: ketukan berderak + dentum rendah
          this.noise(c, t, 0.05, 0.9, 1800);
          this.tone(c, t, 0.1, 170, 70, "sine", 0.9);
          break;
        case "pass": // dua nada turun lembut
          this.tone(c, t, 0.12, 440, 400, "sine", 0.6);
          this.tone(c, t + 0.13, 0.16, 330, 290, "sine", 0.6);
          break;
        case "turn": // ding giliranmu
          this.tone(c, t, 0.18, 880, 880, "sine", 0.55);
          this.tone(c, t + 0.09, 0.28, 1320, 1320, "sine", 0.4);
          break;
        case "nudge": // dug-dug: dua ketukan berat
          this.tone(c, t, 0.09, 130, 90, "triangle", 1);
          this.noise(c, t, 0.04, 0.5, 600);
          this.tone(c, t + 0.14, 0.12, 110, 70, "triangle", 1);
          this.noise(c, t + 0.14, 0.05, 0.6, 500);
          break;
        case "start": // kocokan kartu
          for (let i = 0; i < 6; i++) this.noise(c, t + i * 0.055, 0.045, 0.6, 2400 + i * 150);
          break;
        case "win": // arpeggio naik
          [523, 659, 784, 1047].forEach((f, i) => this.tone(c, t + i * 0.12, 0.3, f, f, "triangle", 0.7));
          break;
        case "lose": // tiga nada turun
          [392, 330, 262].forEach((f, i) => this.tone(c, t + i * 0.16, 0.26, f, f * 0.97, "sawtooth", 0.25));
          break;
        case "chat": // pop kecil
          this.tone(c, t, 0.07, 700, 900, "sine", 0.45);
          break;
        case "error":
          this.tone(c, t, 0.1, 200, 160, "square", 0.2);
          break;
      }
    } catch {
      // suara tidak boleh pernah merusak permainan
    }
  }

  private tone(c: AudioContextLike, at: number, dur: number, f0: number, f1: number, type: string, gain: number): void {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(MASTER * gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private noise(c: AudioContextLike, at: number, dur: number, gain: number, freq: number): void {
    if (!this.noiseBuf) {
      const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * 0.2)), c.sampleRate);
      const data = buf.getChannelData(0);
      let seed = 12345; // derau deterministik, tanpa Math.random
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = (seed / 2 ** 32) * 2 - 1;
      }
      this.noiseBuf = buf;
    }
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq, at);
    filter.Q.setValueAtTime(1.2, at);
    const g = c.createGain();
    g.gain.setValueAtTime(MASTER * gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(c.destination);
    src.start(at);
    src.stop(at + dur + 0.02);
  }
}

function defaultContext(): AudioContextLike | null {
  const w = window as unknown as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/** Getar singkat (bila didukung perangkat dan suara hidup). */
export function haptic(player: SoundLike, pattern: number | number[]): void {
  try {
    if (player.enabled && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    // abaikan
  }
}
