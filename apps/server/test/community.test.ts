import { afterEach, describe, expect, it } from "vitest";
import { startServer, type GmersServer } from "../src/server";
import { FakeClock, testConfig, tok } from "./support";
import { Community, MemoryCommunityLog, checkText } from "../src/community";

const servers: GmersServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function boot() {
  const server = await startServer(testConfig());
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const call = async (method: string, path: string, body?: unknown, session?: string | null) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(session ? { authorization: `Bearer ${session}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const mk = async (username: string, i: number): Promise<string> => ((await call("POST", "/api/register", { username, password: "rahasia123", name: username, token: tok(i) })).json.session as string);
  return { server, call, mk };
}

describe("validasi teks feed", () => {
  it("menolak kosong, terlalu panjang, tautan, dan karakter kontrol", () => {
    expect(checkText("   ", 10)).toMatchObject({ ok: false, code: "EMPTY" });
    expect(checkText("x".repeat(11), 10)).toMatchObject({ ok: false, code: "TOO_LONG" });
    expect(checkText("lihat https://contoh.id", 50)).toMatchObject({ ok: false, code: "NO_LINKS" });
    expect(checkText("www.contoh.id", 50)).toMatchObject({ ok: false, code: "NO_LINKS" });
    expect(checkText("a\u0007b", 50)).toMatchObject({ ok: false, code: "BAD_TEXT" });
    expect(checkText("  halo\r\ndunia ", 50)).toEqual({ ok: true, text: "halo\ndunia" });
  });
});

describe("Community (unit)", () => {
  function make() {
    const clock = new FakeClock();
    const blocked = new Set<string>();
    const follows = new Set<string>();
    const log = new MemoryCommunityLog();
    const names: Record<string, { username: string; name: string }> = { a: { username: "a", name: "A" }, b: { username: "b", name: "B" }, c: { username: "c", name: "C" } };
    const deps = { log, clock, profileOf: (id: string) => names[id] ?? null, isBlocked: (x: string, y: string) => blocked.has(`${x}|${y}`) || blocked.has(`${y}|${x}`), follows: (x: string, y: string) => follows.has(`${x}>${y}`) };
    return { clock, blocked, follows, log, deps, c: new Community(deps) };
  }

  it("kiriman, suka, simpan, balas; suka dan simpan idempoten; urutan terbaru dulu", () => {
    const { c, clock } = make();
    const p1 = c.post("a", "pertama", null);
    clock.advance(1000);
    const p2 = c.post("b", "kedua", "gaple");
    expect(p1.ok && p2.ok).toBe(true);
    const id2 = (p2 as { id: string }).id;
    c.like("a", id2, true);
    c.like("a", id2, true);
    c.save("a", id2, true);
    expect(c.reply("a", id2, "mantap")).toMatchObject({ ok: true });
    const f = c.feed("a", "untukmu", null, null).items;
    expect(f.map((i) => i.text)).toEqual(["kedua", "pertama"]);
    expect(f[0]).toMatchObject({ likes: 1, replies: 1, liked: true, saved: true, mine: false, comm: "gaple" });
    expect(c.feed("a", "tersimpan", null, null).items.map((i) => i.text)).toEqual(["kedua"]);
    expect(c.feed("a", "untukmu", "gaple", null).items).toHaveLength(1);
    c.like("a", id2, false);
    expect(c.feed("a", "untukmu", null, null).items[0]?.likes).toBe(0);
  });

  it("Mengikuti hanya penulis yang diikuti dan diri sendiri", () => {
    const { c, follows } = make();
    c.post("a", "dari a", null);
    c.post("b", "dari b", null);
    c.post("c", "dari c", null);
    follows.add("a>b");
    expect(c.feed("a", "mengikuti", null, null).items.map((i) => i.text).sort()).toEqual(["dari a", "dari b"]);
  });

  it("blokir menyembunyikan kiriman di kedua arah, termasuk balasan dan saran", () => {
    const { c, blocked } = make();
    const p = c.post("b", "dari b", null) as { id: string };
    c.reply("c", p.id, "balasan c");
    blocked.add("a|b");
    expect(c.feed("a", "untukmu", null, null).items).toHaveLength(0);
    expect(c.feed("b", "untukmu", null, null).items.map((i) => i.text)).toEqual(["dari b"]);
    expect(c.like("a", p.id, true)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(c.suggestions("a")).toEqual([{ username: "c", name: "C" }].filter(() => false));
    blocked.clear();
    blocked.add("b|c");
    expect(c.replies("b", p.id)?.replies).toHaveLength(0);
  });

  it("sembunyikan hanya untuk diri sendiri; hapus hanya milik sendiri", () => {
    const { c } = make();
    const p = c.post("a", "tulisan a", null) as { id: string };
    expect(c.hide("b", p.id)).toMatchObject({ ok: true });
    expect(c.feed("b", "untukmu", null, null).items).toHaveLength(0);
    expect(c.feed("c", "untukmu", null, null).items).toHaveLength(1);
    expect(c.remove("b", p.id)).toMatchObject({ ok: false });
    expect(c.remove("a", p.id)).toMatchObject({ ok: true });
    expect(c.feed("c", "untukmu", null, null).items).toHaveLength(0);
  });

  it("batas harian kiriman dan komunitas tidak dikenal", () => {
    const { c, clock } = make();
    for (let i = 0; i < c.limits.postsPerDay; i++) expect(c.post("a", `p${i}`, null)).toMatchObject({ ok: true });
    expect(c.post("a", "lagi", null)).toMatchObject({ ok: false, code: "RATE_LIMIT" });
    expect(c.post("b", "x", "tidak-ada")).toMatchObject({ ok: false, code: "BAD_COMMUNITY" });
    clock.advance(24 * 3_600_000);
    expect(c.post("a", "besok", null)).toMatchObject({ ok: true });
  });

  it("pemulihan dari log dan hapus akun (purge) menghapus kiriman dan suka", () => {
    const { c, deps } = make();
    const p = c.post("a", "milik a", null) as { id: string };
    c.like("b", p.id, true);
    const again = new Community(deps);
    expect(again.feed("b", "untukmu", null, null).items[0]).toMatchObject({ text: "milik a", likes: 1 });
    again.purge("a");
    expect(again.feed("b", "untukmu", null, null).items).toHaveLength(0);
    expect(new Community(deps).feed("b", "untukmu", null, null).items).toHaveLength(0);
  });

  it("saran 'Kenalan hari ini': penulis yang belum diikuti, tanpa diri sendiri, maksimal 3", () => {
    const { c, follows } = make();
    c.post("b", "x", null);
    c.post("c", "y", null);
    c.post("a", "z", null);
    follows.add("a>b");
    expect(c.suggestions("a")).toEqual([{ username: "c", name: "C" }]);
  });
});

describe("API Komunitas", () => {
  it("butuh sesi; kirim, umpan, suka, simpan, balas, hapus lewat HTTP", async () => {
    const { call, mk } = await boot();
    expect((await call("GET", "/api/feed")).status).toBe(401);
    const a = await mk("andi", 1);
    const b = await mk("budi", 2);
    const post = await call("POST", "/api/posts", { text: "Ada yang mau main Gaple malam ini?", comm: "gaple" }, a);
    expect(post.status).toBe(200);
    const id = post.json.id as string;
    expect((await call("POST", "/api/posts", { text: "buka http://spam.example" }, a)).status).toBe(400);
    const feed = await call("GET", "/api/feed?tab=untukmu", undefined, b);
    expect(feed.json.items).toHaveLength(1);
    expect(feed.json.items[0].author).toEqual({ username: "andi", name: "andi" });
    expect(feed.json.suggestions).toEqual([{ username: "andi", name: "andi" }]);
    expect((await call("POST", `/api/posts/${id}/like`, { on: true }, b)).json.likes).toBe(1);
    expect((await call("POST", `/api/posts/${id}/save`, { on: true }, b)).status).toBe(200);
    expect((await call("GET", "/api/feed?tab=tersimpan", undefined, b)).json.items).toHaveLength(1);
    expect((await call("POST", `/api/posts/${id}/replies`, { text: "Ikut!" }, b)).status).toBe(200);
    const detail = await call("GET", `/api/posts/${id}`, undefined, a);
    expect(detail.json.replies.map((r: { text: string }) => r.text)).toEqual(["Ikut!"]);
    expect((await call("DELETE", `/api/posts/${id}`, undefined, b)).status).toBe(404);
    expect((await call("DELETE", `/api/posts/${id}`, undefined, a)).status).toBe(200);
    expect((await call("GET", "/api/feed?tab=untukmu", undefined, b)).json.items).toHaveLength(0);
    expect((await call("GET", "/api/feed?tab=aneh", undefined, b)).status).toBe(400);
  });

  it("pengguna yang memblokir tidak melihat kiriman pemblokir, dan laporan kiriman tercatat", async () => {
    const { call, mk, server } = await boot();
    const a = await mk("andi", 1);
    const b = await mk("budi", 2);
    const id = (await call("POST", "/api/posts", { text: "halo semua" }, a)).json.id as string;
    await call("POST", "/api/block", { username: "andi", on: true }, b);
    expect((await call("GET", "/api/feed", undefined, b)).json.items).toHaveLength(0);
    expect((await call("POST", "/api/report", { kind: "post", target: id, reason: "spam" }, b)).status).toBe(200);
    expect(server.social.reports.some((r) => r.kind === "post" && r.target === id)).toBe(true);
  });

  it("menghapus akun menghapus kirimannya", async () => {
    const { call, mk } = await boot();
    const a = await mk("andi", 1);
    const b = await mk("budi", 2);
    await call("POST", "/api/posts", { text: "sebelum hapus" }, a);
    expect((await call("DELETE", "/api/me", { password: "rahasia123" }, a)).status).toBe(200);
    expect((await call("GET", "/api/feed", undefined, b)).json.items).toHaveLength(0);
  });
});

describe("API Toko (simulasi)", () => {
  it("klaim harian sekali, beli, saldo tak boleh negatif, pasang, dan tidak bisa beli dua kali", async () => {
    const { call, mk } = await boot();
    const a = await mk("andi", 1);
    expect((await call("GET", "/api/shop")).status).toBe(401);
    let s = (await call("GET", "/api/shop", undefined, a)).json;
    expect(s).toMatchObject({ koin: 0, canClaim: true, simulation: true });
    expect((await call("POST", "/api/shop/buy", { item: "dadu_kayu_jati" }, a)).status).toBe(402);
    expect((await call("POST", "/api/shop/claim", {}, a)).status).toBe(200);
    expect((await call("POST", "/api/shop/claim", {}, a)).status).toBe(409);
    expect((await call("POST", "/api/shop/buy", { item: "dadu_kayu_jati" }, a)).status).toBe(402); // 50 < 80
    s = (await call("GET", "/api/shop", undefined, a)).json;
    expect(s).toMatchObject({ koin: 50, canClaim: false });
  });

  it("alur lengkap dengan saldo cukup", async () => {
    const { call, mk, server } = await boot();
    const a = await mk("andi", 1);
    const me = server.accounts.idOfSession(a) as string;
    server.ledger.post([{ accountId: me, currency: "koin", delta: 200, reason: "uji", ref: "seed" }]);
    const buy = await call("POST", "/api/shop/buy", { item: "dadu_kayu_jati" }, a);
    expect(buy.status).toBe(200);
    expect(buy.json.wallet.koin).toBe(120);
    expect((await call("POST", "/api/shop/buy", { item: "dadu_kayu_jati" }, a)).status).toBe(409);
    expect((await call("POST", "/api/shop/equip", { item: "dadu_neon" }, a)).status).toBe(409); // belum dimiliki
    expect((await call("POST", "/api/shop/equip", { item: "dadu_kayu_jati" }, a)).status).toBe(200);
    const s = (await call("GET", "/api/shop", undefined, a)).json;
    expect(s.equipped.dadu).toBe("dadu_kayu_jati");
    expect(s.items.find((i: { id: string }) => i.id === "dadu_kayu_jati")).toMatchObject({ owned: true, equipped: true });
    expect(s.items.find((i: { id: string }) => i.id === "dadu_klasik")).toMatchObject({ owned: true, equipped: false });
    expect((await call("POST", "/api/shop/buy", { item: "tidak-ada" }, a)).status).toBe(404);
  });
});
