import { describe, expect, it, vi } from "vitest";
import { SoundPlayer, haptic, type AudioContextLike, type SoundName } from "../src/sound";
import { memoryKV } from "./helpers";

function fakeContext(state = "running") {
  const made = { osc: 0, gain: 0, noise: 0, filter: 0 };
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const node = () => ({ connect: vi.fn() });
  const ctx = {
    currentTime: 1,
    destination: {},
    sampleRate: 8000,
    state,
    resume: vi.fn(async () => undefined),
    createOscillator: () => (made.osc++, { ...node(), type: "", frequency: param(), start: vi.fn(), stop: vi.fn() }),
    createGain: () => (made.gain++, { ...node(), gain: param() }),
    createBiquadFilter: () => (made.filter++, { ...node(), type: "", frequency: param(), Q: param() }),
    createBufferSource: () => (made.noise++, { ...node(), buffer: null, start: vi.fn(), stop: vi.fn() }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  } as unknown as AudioContextLike;
  return { ctx, made };
}

const ALL: SoundName[] = ["place", "pass", "turn", "nudge", "start", "win", "lose", "chat", "error"];

describe("efek suara", () => {
  it.each(ALL)("%s menghasilkan bunyi (ada oscillator atau derau)", (name) => {
    const { ctx, made } = fakeContext();
    new SoundPlayer(undefined, () => ctx).play(name);
    expect(made.osc + made.noise).toBeGreaterThan(0);
  });

  it("suara mati: tidak membuat apa pun, dan pilihan tersimpan", () => {
    const kv = memoryKV();
    const { ctx, made } = fakeContext();
    const p = new SoundPlayer(kv, () => ctx);
    p.setEnabled(false);
    p.play("place");
    expect(made.osc + made.noise + made.gain).toBe(0);
    expect(kv.data.get("gmers.sound")).toBe("off");
    expect(new SoundPlayer(kv, () => ctx).enabled).toBe(false);
    p.setEnabled(true);
    expect(kv.data.get("gmers.sound")).toBe("on");
  });

  it("konteks audio ditunda (suspended) dilanjutkan saat unlock dan saat bermain", () => {
    const { ctx } = fakeContext("suspended");
    const p = new SoundPlayer(undefined, () => ctx);
    p.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    p.play("chat");
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it("tanpa dukungan Web Audio atau galat di dalamnya, tidak pernah melempar", () => {
    expect(() => new SoundPlayer(undefined, () => null).play("place")).not.toThrow();
    expect(() => new SoundPlayer(undefined, () => { throw new Error("tidak ada"); }).play("place")).not.toThrow();
    const broken = { ...fakeContext().ctx, createOscillator: () => { throw new Error("rusak"); } } as unknown as AudioContextLike;
    expect(() => new SoundPlayer(undefined, () => broken).play("turn")).not.toThrow();
  });

  it("getar hanya bila suara hidup dan perangkat mendukung", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const p = new SoundPlayer(undefined, () => null);
    haptic(p, [30, 40, 30]);
    expect(vibrate).toHaveBeenCalledWith([30, 40, 30]);
    p.setEnabled(false);
    haptic(p, 20);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
