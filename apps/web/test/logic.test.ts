import { describe, expect, it } from "vitest";
import type { MoveView } from "@gmers/server/protocol";
import { ChatLimiter, canPass, checkName, cleanText, endOptions, parseRoute, playableKeys, secondsLeft, whatsappLink } from "../src/logic";
import { createKV, Identity } from "../src/storage";

describe("rute", () => {
  it.each([
    ["/", { kind: "home" }],
    ["/privasi", { kind: "privacy" }],
    ["/privasi/", { kind: "privacy" }],
    ["/g/abc123", { kind: "link", groupId: "ABC123" }],
    ["/g/AB", { kind: "notfound" }],
    ["/g/ABC123/extra", { kind: "notfound" }],
    ["/apa-saja", { kind: "notfound" }],
  ])("%s", (path, route) => expect(parseRoute(path)).toEqual(route));
});

describe("nama panggilan", () => {
  it("2 sampai 16 karakter setelah dirapikan", () => {
    expect(checkName("A")).toEqual({ ok: false, reason: "tooShort" });
    expect(checkName("  ")).toEqual({ ok: false, reason: "tooShort" });
    expect(checkName("x".repeat(17))).toEqual({ ok: false, reason: "tooLong" });
    expect(checkName("  Budi   Santoso ")).toEqual({ ok: true, name: "Budi Santoso" });
    expect(checkName("ab")).toEqual({ ok: true, name: "ab" });
    expect(checkName("x".repeat(16)).ok).toBe(true);
  });
  it("karakter kontrol dan tak terlihat dibuang", () => {
    expect(cleanText("a\u0000b​c‮d")).toBe("abcd");
  });
});

describe("langkah sah", () => {
  const moves: MoveView[] = [
    { type: "play", card: [2, 5], end: "left" },
    { type: "play", card: [2, 5], end: "right" },
    { type: "play", card: [1, 1], end: "left" },
  ];
  it("playableKeys, endOptions, canPass", () => {
    expect([...playableKeys(moves)].sort()).toEqual(["1|1", "2|5"]);
    expect(endOptions(moves, [2, 5])).toEqual(["left", "right"]);
    expect(endOptions(moves, [1, 1])).toEqual(["left"]);
    expect(endOptions(moves, [3, 3])).toEqual([]);
    expect(canPass(moves)).toBe(false);
    expect(canPass([{ type: "pass" }])).toBe(true);
  });
  it("sisa waktu dari jam server", () => {
    expect(secondsLeft(61_000, 1_000)).toBe(60);
    expect(secondsLeft(1_500, 1_000)).toBe(1);
    expect(secondsLeft(500, 1_000)).toBe(0);
    expect(secondsLeft(null, 1_000)).toBeNull();
  });
});

describe("pembatas laju chat", () => {
  it("maksimal 5 pesan per 10 detik", () => {
    const l = new ChatLimiter();
    for (let i = 0; i < 5; i++) expect(l.tryAcquire(1000 + i)).toBe(true);
    expect(l.tryAcquire(2000)).toBe(false);
    expect(l.tryAcquire(11_001)).toBe(true);
  });
});

describe("tautan WhatsApp", () => {
  it("memakai wa.me dengan teks ter-encode", () => {
    const url = whatsappLink("Ayo main! https://x.test/g/ABC");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1] as string)).toBe("Ayo main! https://x.test/g/ABC");
  });
});

describe("penyimpanan", () => {
  it("token dibuat sekali dan stabil; cadangan memori bila localStorage melempar galat", () => {
    const broken = createKV(() => {
      throw new Error("diblokir");
    });
    const id = new Identity(broken);
    const t = id.token();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(new Identity(broken).token()).toBe(t);
    id.setName("Citra");
    expect(id.name()).toBe("Citra");
  });
  it("memakai localStorage bila tersedia dan menolak token tersimpan yang rusak", () => {
    const store = new Map<string, string>([["gmers.token", "pendek"]]);
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
    const id = new Identity(createKV(() => fake));
    const t = id.token();
    expect(t).not.toBe("pendek");
    expect(store.get("gmers.token")).toBe(t);
  });
});
