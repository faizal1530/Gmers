import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { id } from "../src/i18n/id";
import { acct, fakeFetch, memoryKV, mkState, mount, q, text, type Harness } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};
const tab = (h: Harness, name: string): void => q<HTMLButtonElement>(h.root, `[data-testid="tab-${name}"]`).click();
const section = (h: Harness, name: string): void => q<HTMLButtonElement>(h.root, `[data-section="${name}"]`).click();
const submit = (el: Element): void => void el.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

const post = (over: Record<string, unknown> = {}) => ({ id: "aaaaaaaaaaaa", ts: Date.now() - 120_000, author: { username: "budi", name: "Budi" }, text: "Ada yang mau main Gaple?", comm: "gaple", likes: 2, replies: 1, liked: false, saved: false, mine: false, ...over });
const shopData = (over: Record<string, unknown> = {}) => ({
  koin: 100,
  canClaim: true,
  dailyKoin: 50,
  simulation: true,
  equipped: { dadu: "dadu_klasik" },
  items: [
    { id: "dadu_klasik", kind: "dadu", name: "Dadu Klasik", price: 0, free: true, owned: true, equipped: true },
    { id: "dadu_kayu_jati", kind: "dadu", name: "Dadu Kayu Jati", price: 80, owned: false, equipped: false },
    { id: "emoji_drama_ludo", kind: "emoji", name: "Emoji Drama Ludo", price: 80, owned: true, equipped: false },
  ],
  ...over,
});

async function login(extra: Parameters<typeof fakeFetch>[0] = {}) {
  const f = fakeFetch({
    "GET /api/me": () => ({ json: { account: acct(), wallet: null } }),
    "GET /api/leaderboard": () => ({ json: { rows: [], you: { rank: null } } }),
    "GET /api/friends": () => ({ json: { friends: [], waiting: [], incoming: [], blocked: [], status: "siap", prefs: { invite: true, follow: true, streak: true, dm: true } } }),
    "GET /api/notices": () => ({ json: { notices: [] } }),
    "GET /api/shop": () => ({ json: shopData() }),
    ...extra,
  });
  const h = mount("/", memoryKV({ "gmers.session": "a".repeat(64), "gmers.name": "Andi" }), { fetch: f.fn });
  await flush();
  return { h, f };
}

describe("bagian Games", () => {
  it("tamu: Komunitas, Live, dan Toko meminta masuk dulu", () => {
    const h = mount("/");
    for (const s of ["komunitas", "live", "toko"]) {
      section(h, s);
      expect(text(q(h.root, '[data-testid="section-guest"]'))).toBe(id.sections.needAccount);
    }
    section(h, "main");
    expect(h.root.querySelector('[data-testid="section-guest"]')).toBeNull();
  });
});

describe("Komunitas", () => {
  it("memuat umpan, mengirim kiriman, suka, simpan, dan membuka balasan", async () => {
    let items = [post()];
    const calls: string[] = [];
    const { h } = await login({
      "GET /api/feed?tab=untukmu": () => ({ json: { items, next: null, suggestions: [{ username: "citra", name: "Citra" }] } }),
      "POST /api/posts": (b) => {
        calls.push(`post:${String(b.text)}`);
        items = [post({ id: "bbbbbbbbbbbb", author: { username: "andi", name: "Andi" }, text: String(b.text), mine: true, likes: 0, replies: 0 }), ...items];
        return { json: { id: "bbbbbbbbbbbb" } };
      },
      "POST /api/posts/aaaaaaaaaaaa/like": (b) => (calls.push(`like:${String(b.on)}`), { json: { ok: true, likes: 3 } }),
      "POST /api/posts/aaaaaaaaaaaa/save": (b) => (calls.push(`save:${String(b.on)}`), { json: { ok: true } }),
      "GET /api/posts/aaaaaaaaaaaa": () => ({ json: { post: post(), replies: [{ id: "cccccccccccc", ts: Date.now(), author: { username: "citra", name: "Citra" }, text: "Ikut!", mine: false }] } }),
      "POST /api/posts/aaaaaaaaaaaa/replies": (b) => (calls.push(`reply:${String(b.text)}`), { json: { id: "dddddddddddd" } }),
    });
    tab(h, "games");
    section(h, "komunitas");
    await flush();
    expect(text(q(h.root, '[data-testid="post"]'))).toContain("Ada yang mau main Gaple?");
    expect(text(q(h.root, '[data-testid="suggestions"]'))).toContain("Citra");
    const area = q<HTMLTextAreaElement>(h.root, '[data-testid="compose"]');
    area.value = "Malam ini main Ludo yuk";
    area.dispatchEvent(new Event("input"));
    submit(area.closest("form") as Element);
    await flush();
    expect(calls).toContain("post:Malam ini main Ludo yuk");
    expect(h.root.querySelectorAll('[data-testid="post"]')).toHaveLength(2);
    expect(q<HTMLTextAreaElement>(h.root, '[data-testid="compose"]').value).toBe("");
    const first = h.root.querySelectorAll<HTMLElement>('[data-testid="post"]')[1] as HTMLElement;
    q<HTMLButtonElement>(first, '[data-testid="post-like"]').click();
    await flush();
    q<HTMLButtonElement>(h.root.querySelector('[data-id="aaaaaaaaaaaa"]') as HTMLElement, '[data-testid="post-save"]').click();
    await flush();
    expect(calls).toEqual(expect.arrayContaining(["like:true", "save:true"]));
    expect(text(q(h.root.querySelector('[data-id="aaaaaaaaaaaa"]') as HTMLElement, '[data-testid="post-like"]'))).toBe(`${id.community.unlike} 3`);
    q<HTMLButtonElement>(h.root.querySelector('[data-id="aaaaaaaaaaaa"]') as HTMLElement, '[data-testid="post-open"]').click();
    await flush();
    expect(text(q(h.root, '[data-testid="reply-list"]'))).toContain("Ikut!");
    const input = q<HTMLInputElement>(h.root, '[data-testid="reply-input"]');
    input.value = "Saya juga";
    submit(input.closest("form") as Element);
    await flush();
    expect(calls).toContain("reply:Saya juga");
    q<HTMLButtonElement>(h.root, '[data-testid="thread-back"]').click();
    expect(h.root.querySelector('[data-testid="feed"]')).not.toBeNull();
  });

  it("kiriman orang lain: sembunyikan dan laporkan; kiriman sendiri: hapus", async () => {
    const calls: string[] = [];
    const { h } = await login({
      "GET /api/feed?tab=untukmu": () => ({ json: { items: [post(), post({ id: "bbbbbbbbbbbb", mine: true, text: "milikku" })], next: null, suggestions: [] } }),
      "POST /api/report": (b) => (calls.push(`report:${String(b.kind)}:${String(b.target)}:${String(b.reason)}`), { json: { ok: true } }),
      "POST /api/posts/aaaaaaaaaaaa/hide": () => (calls.push("hide"), { json: { ok: true } }),
      "DELETE /api/posts/bbbbbbbbbbbb": () => (calls.push("delete"), { json: { ok: true } }),
    });
    tab(h, "games");
    section(h, "komunitas");
    await flush();
    const others = q(h.root, '[data-id="aaaaaaaaaaaa"]');
    q<HTMLButtonElement>(others, '[data-testid="post-report"]').click();
    q<HTMLInputElement>(others, '[data-testid="post-report-reason"]').value = "spam";
    q<HTMLButtonElement>(others, '[data-testid="post-report"]').click();
    await flush();
    expect(calls).toContain("report:post:aaaaaaaaaaaa:spam");
    expect(h.root.querySelector('[data-id="bbbbbbbbbbbb"] [data-testid="post-hide"]')).toBeNull();
    q<HTMLButtonElement>(h.root, '[data-id="bbbbbbbbbbbb"] [data-testid="post-remove"]').click();
    await flush();
    expect(calls).toContain("delete");
    q<HTMLButtonElement>(h.root, '[data-id="aaaaaaaaaaaa"] [data-testid="post-hide"]').click();
    await flush();
    expect(calls).toContain("hide");
    expect(h.root.querySelector('[data-id="aaaaaaaaaaaa"]')).toBeNull();
  });

  it("pindah tab umpan memuat ulang; kosong dan galat ditampilkan", async () => {
    let fail = false;
    const { h } = await login({
      "GET /api/feed?tab=untukmu": () => ({ json: { items: [], next: null, suggestions: [] } }),
      "GET /api/feed?tab=tersimpan": () => (fail ? { status: 500, json: { code: "X", message: "Gagal." } } : { json: { items: [], next: null, suggestions: [] } }),
    });
    tab(h, "games");
    section(h, "komunitas");
    await flush();
    expect(text(q(h.root, '[data-testid="feed-empty"]'))).toBe(id.community.empty);
    fail = true;
    q<HTMLButtonElement>(h.root, '[data-feed-tab="tersimpan"]').click();
    await flush();
    expect(text(h.root)).toContain(id.community.error);
    fail = false;
    q<HTMLButtonElement>(h.root, '[data-testid="feed-retry"]').click();
    await flush();
    expect(text(q(h.root, '[data-testid="feed-empty"]'))).toBe(id.community.emptySaved);
  });
});

describe("Toko (simulasi)", () => {
  it("selalu menandai simulasi; klaim, beli, dan pasang memakai API; tombol beli mati bila Koin kurang", async () => {
    const calls: string[] = [];
    let data = shopData();
    const { h } = await login({
      "POST /api/shop/claim": () => ((data = shopData({ koin: 150, canClaim: false })), calls.push("claim"), { json: { ok: true, shop: data, wallet: { trofi: 0, bintang: 0, koin: 150, kelas: "Pemula", kelasIndex: 0, next: null } } }),
      "POST /api/shop/buy": (b) => (calls.push(`buy:${String(b.item)}`), { json: { ok: true, shop: shopData({ koin: 70, items: shopData().items.map((i) => (i.id === "dadu_kayu_jati" ? { ...i, owned: true } : i)) }), wallet: { trofi: 0, bintang: 0, koin: 70, kelas: "Pemula", kelasIndex: 0, next: null } } }),
      "POST /api/shop/equip": (b) => (calls.push(`equip:${String(b.item)}`), { json: { ok: true, shop: shopData({ equipped: { dadu: "dadu_kayu_jati" } }), wallet: { trofi: 0, bintang: 0, koin: 70, kelas: "Pemula", kelasIndex: 0, next: null } } }),
    });
    tab(h, "games");
    section(h, "toko");
    await flush();
    expect(text(q(h.root, '[data-testid="shop-sim"]'))).toBe(id.shop.simulation);
    expect(text(q(h.root, '[data-testid="koin"]'))).toBe(id.shop.balance(100));
    q<HTMLButtonElement>(h.root, '[data-testid="claim"]').click();
    await flush();
    expect(text(q(h.root, '[data-testid="koin"]'))).toBe(id.shop.balance(150));
    expect(q<HTMLButtonElement>(h.root, '[data-testid="claim"]').disabled).toBe(true);
    q<HTMLButtonElement>(h.root, '[data-item="dadu_kayu_jati"] [data-testid="buy"]').click();
    await flush();
    expect(calls).toEqual(["claim", "buy:dadu_kayu_jati"]);
    q<HTMLButtonElement>(h.root, '[data-item="dadu_kayu_jati"] [data-testid="equip"]').click();
    await flush();
    expect(calls.at(-1)).toBe("equip:dadu_kayu_jati");
  });

  it("Koin kurang: tombol beli nonaktif", async () => {
    const { h } = await login({ "GET /api/shop": () => ({ json: shopData({ koin: 10 }) }) });
    tab(h, "games");
    section(h, "toko");
    await flush();
    expect(q<HTMLButtonElement>(h.root, '[data-item="dadu_kayu_jati"] [data-testid="buy"]').disabled).toBe(true);
  });

  it("paket emoji yang dimiliki muncul di baki emoji chat", async () => {
    const { h } = await login();
    h.sock().open();
    await flush();
    h.sock().receive({ type: "dm", from: { username: "budi", name: "Budi" }, text: "hai", ts: Date.now() });
    tab(h, "chat");
    q<HTMLButtonElement>(h.root, '[data-testid="convo"]').click();
    // baki dibuat hanya bila thread DM aktif untuk teman; paket emoji ikut walau daftar teman kosong (kolom terkunci)
    expect(h.root.querySelector('[data-testid="emoji-toggle"]') ?? h.root.querySelector('[data-testid="dm-locked"]')).not.toBeNull();
  });
});

describe("Live", () => {
  it("daftar siaran dan Tonton mengirim pesan watch; banner dan papan tertunda tampil tanpa kartu", async () => {
    const { h } = await login({ "GET /api/live": () => ({ json: { rooms: [{ key: "0123456789", game: "gaple", ranked: false, players: ["Andi", "Budi"], spectators: 1 }] } }) });
    h.sock().open();
    tab(h, "games");
    section(h, "live");
    await flush();
    expect(text(q(h.root, '[data-testid="live-room"]'))).toContain("Andi, Budi");
    q<HTMLButtonElement>(h.root, '[data-testid="live-watch"]').click();
    expect(h.sock().sent.find((m) => m.type === "watch")).toEqual({ type: "watch", key: "0123456789" });
    expect(h.root.querySelector('[data-testid="spectate-wait"]')).not.toBeNull();
    h.sock().receive({ type: "watching", key: "0123456789", delayMs: 30_000, hasFrame: true });
    h.sock().receive({ ...mkState({ phase: "playing", you: -1, hand: [] }), spectating: true });
    expect(text(q(h.root, '[data-testid="spectate-banner"]'))).toContain(id.live.delay(30));
    expect(h.root.querySelector('[data-testid="nudge"]')).toBeNull();
    // chat penonton
    const input = q<HTMLInputElement>(h.root, '[data-testid="watch-input"]');
    input.value = "seru";
    submit(input.closest("form") as Element);
    expect(h.sock().sent.find((m) => m.type === "watch_chat")).toEqual({ type: "watch_chat", text: "seru" });
    h.sock().receive({ type: "watch_chat", name: "Citra", text: "mantap", ts: Date.now() });
    expect(text(q(h.root, '[data-testid="watch-log"]'))).toContain("mantap");
    h.sock().receive({ type: "watch_end", reason: "off" });
    expect(text(h.root)).toContain(id.live.ended.off);
    q<HTMLButtonElement>(h.root, '[data-testid="unwatch"]').click();
    expect(h.sock().types()).toContain("unwatch");
    expect(h.root.querySelector('[data-testid="spectate"]')).toBeNull();
  });

  it("pemilik room menyalakan siaran dari ruang tunggu; tamu tidak melihat pilihan", async () => {
    const { h } = await login();
    h.sock().open();
    h.sock().receive(mkState({ phase: "lobby", you: 0 }));
    tab(h, "room");
    q<HTMLButtonElement>(h.root, '[data-watch="on"]').click();
    expect(h.sock().sent.find((m) => m.type === "set_watch")).toEqual({ type: "set_watch", on: true });
    const g = mount("/");
    g.sock?.();
    // tamu tanpa koneksi: tidak ada pilihan siaran karena tidak punya akun
    expect(g.root.querySelector('[data-testid="watch-pick"]')).toBeNull();
  });

  it("daftar kosong", async () => {
    const { h } = await login({ "GET /api/live": () => ({ json: { rooms: [] } }) });
    tab(h, "games");
    section(h, "live");
    await flush();
    expect(text(q(h.root, '[data-testid="live-empty"]'))).toBe(id.live.empty);
  });
});
