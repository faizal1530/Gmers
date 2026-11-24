import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { id } from "../src/i18n/id";
import { acct, fakeFetch, memoryKV, mkState, mount, q, text } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const SESSION = "a".repeat(64);
const flush = async (): Promise<void> => void (await vi.advanceTimersByTimeAsync(0));
const tab = (h: ReturnType<typeof mount>, name: string): void => q<HTMLButtonElement>(h.root, `[data-testid="tab-${name}"]`).click();

const wallet = (over: Record<string, unknown> = {}) => ({ trofi: 120, bintang: 35, koin: 0, kelas: "Jago", kelasIndex: 1, next: { name: "Pro", min: 300 }, ...over });
const board = {
  rows: [
    { rank: 1, name: "Budi", kelas: "Pro", trofi: 340, isYou: false },
    { rank: 2, name: "Andi", kelas: "Jago", trofi: 120, isYou: true },
  ],
  you: { rank: 2, trofi: 120, kelas: "Jago" },
};

async function loggedIn(path = "/", routes: Parameters<typeof fakeFetch>[0] = {}, w = wallet()) {
  const kv = memoryKV({ "gmers.session": SESSION, "gmers.account": JSON.stringify({ username: "andi", name: "Andi" }), "gmers.token": "token-akun-andi-0000000001", "gmers.name": "Andi" });
  const f = fakeFetch({
    "GET /api/me": () => ({ json: { account: acct(), wallet: w } }),
    "GET /api/leaderboard": () => ({ json: board }),
    ...routes,
  });
  const h = mount(path, kv, { fetch: f.fn });
  await flush();
  return { h, f, kv };
}

describe("Ranked lawan acak di tab Games", () => {
  it("tamu: kartu menjelaskan perlu akun dan mengarahkan ke Profil; tidak ada tombol cari lawan", () => {
    const h = mount("/");
    const card = q(h.root, '[data-testid="ranked-card"]');
    expect(text(card)).toContain(id.ranked.need);
    expect(h.root.querySelector('[data-testid="find-ludo"]')).toBeNull();
    q<HTMLButtonElement>(card, "button").click();
    expect(q(h.root, '[data-testid="tab-profile"]').getAttribute("aria-current")).toBe("page");
  });

  it("sudah masuk: cari lawan menyambung, mengirim auth lalu queue_ranked setelah auth_ok; menampilkan status dan bisa dibatalkan", async () => {
    const { h } = await loggedIn();
    q<HTMLButtonElement>(h.root, '[data-testid="find-ludo"]').click();
    expect(text(q(h.root, '[data-testid="queue-waiting"]'))).toContain(id.ranked.searching);
    h.sock().open();
    expect(h.sock().sent[0]).toEqual({ type: "auth", session: SESSION });
    expect(h.sock().sent.some((m) => m.type === "queue_ranked")).toBe(false); // menunggu auth_ok
    h.sock().receive({ type: "auth_ok", username: "andi", name: "Andi" });
    expect(h.sock().sent.at(-1)).toEqual({ type: "queue_ranked", game: "ludo" });
    h.sock().receive({ type: "queue", state: "waiting", game: "ludo", since: 1 });
    vi.advanceTimersByTime(3000);
    expect(text(q(h.root, '[data-testid="queue-waiting"]'))).toMatch(/Ludo · [3-4] dtk/);
    q<HTMLButtonElement>(h.root, '[data-testid="queue-cancel"]').click();
    expect(h.sock().sent.at(-1)).toEqual({ type: "cancel_queue" });
    expect(h.root.querySelector('[data-testid="queue-waiting"]')).toBeNull();
    expect(h.root.querySelector('[data-testid="find-gaple"]')).not.toBeNull();
  });

  it("lawan ditemukan: pemberitahuan, lalu state room Ranked membawa ke tab Room", async () => {
    const { h } = await loggedIn();
    q<HTMLButtonElement>(h.root, '[data-testid="find-gaple"]').click();
    h.sock().open();
    h.sock().receive({ type: "auth_ok", username: "andi", name: "Andi" });
    h.sock().receive({ type: "match_found", groupId: "RANK1X" });
    expect(text(q(h.root, ".toast"))).toBe(id.ranked.found);
    h.sock().receive(mkState({ phase: "playing", groupId: "RANK1X", ranked: true, seats: [{ name: "Andi", registered: true }, { name: "Budi", registered: true }, null, null] }));
    expect(q(h.root, '[data-testid="tab-room"]').getAttribute("aria-current")).toBe("page");
    expect(window.location.pathname).toBe("/g/RANK1X");
  });

  it("koneksi (ulang) mengirim auth lebih dulu agar status antrean dipulihkan", async () => {
    const { h } = await loggedIn("/g/KODE23");
    h.sock().open();
    expect(h.sock().sent.map((m) => m.type).slice(0, 2)).toEqual(["auth", "open_link"]);
  });
});

describe("dompet, kelas, dan papan peringkat", () => {
  it("Profil menampilkan kelas, Trofi, Bintang, dan sisa Trofi ke kelas berikutnya dengan bilah kemajuan", async () => {
    const { h } = await loggedIn();
    tab(h, "profile");
    const w = q(h.root, '[data-testid="wallet"]');
    expect(text(q(w, '[data-testid="wallet-trofi"]'))).toBe("120 Trofi");
    expect(text(q(w, '[data-testid="wallet-bintang"]'))).toBe("35 Bintang");
    expect(q(w, ".kls").getAttribute("data-kelas")).toBe("Jago");
    expect(text(w)).toContain(id.ranked.toNext(180, "Pro"));
    expect(q(w, '[role="progressbar"]').getAttribute("aria-valuenow")).toBe("10"); // (120-100)/(300-100)
  });

  it("kelas tertinggi tidak punya target berikutnya; tamu melihat ajakan daftar", async () => {
    const { h } = await loggedIn("/", {}, wallet({ trofi: 1200, kelas: "Raja", kelasIndex: 4, next: null }));
    tab(h, "profile");
    expect(text(q(h.root, '[data-testid="wallet"]'))).toContain(id.ranked.topClass);
    const g = mount("/");
    tab(g, "profile");
    expect(text(q(g.root, '[data-testid="wallet"]'))).toContain(id.ranked.guestNote);
  });

  it("papan peringkat di tab Games: urut, menandai kamu, dan menyebut peringkatmu", async () => {
    const { h } = await loggedIn();
    tab(h, "games");
    await flush();
    const rows = [...h.root.querySelectorAll('[data-testid="leaderboard"] .brow')];
    expect(rows).toHaveLength(2);
    expect(text(rows[0] as Element)).toContain("Budi");
    expect(rows[1]!.classList.contains("you")).toBe(true);
    expect(text(rows[1] as Element)).toContain(`Andi (${id.lobby.you})`);
    expect(text(q(h.root, '[data-testid="leaderboard"]'))).toContain(id.ranked.boardYou(2));
  });

  it("papan kosong menjelaskan; tamu tidak melihat papan", async () => {
    const { h } = await loggedIn("/", { "GET /api/leaderboard": () => ({ json: { rows: [], you: { rank: null, trofi: 0, kelas: "Pemula" } } }) });
    tab(h, "games");
    await flush();
    expect(text(q(h.root, '[data-testid="leaderboard"]'))).toContain(id.ranked.boardEmpty);
    const g = mount("/");
    expect(g.root.querySelector('[data-testid="leaderboard"]')).toBeNull();
  });
});

describe("Ranked di ruang tunggu dan hasil", () => {
  const lobby = (you: number, regs: boolean[], ranked = false) =>
    mkState({ phase: "lobby", groupId: "KODE23", you, ranked, seats: regs.map((r, i) => ({ name: ["Andi", "Budi", "Citra", "Dewi"][i] as string, registered: r })) });

  it("pemilik: pilih Ranked mengirim set_ranked; dinonaktifkan dengan penjelasan bila ada pemain tanpa akun", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(lobby(0, [true, true]));
    q<HTMLButtonElement>(h.root, '[data-ranked="on"]').click();
    expect(h.sock().sent.at(-1)).toEqual({ type: "set_ranked", on: true });
    h.sock().receive(lobby(0, [true, false]));
    expect(q<HTMLButtonElement>(h.root, '[data-ranked="on"]').disabled).toBe(true);
    expect(text(q(h.root, '[data-testid="ranked-pick"]'))).toContain(id.ranked.needAccounts);
  });

  it("bukan pemilik hanya melihat mode; room Ranked menandai mode terpilih", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Budi" }));
    h.sock().open();
    h.sock().receive(lobby(1, [true, true], true));
    expect(h.root.querySelector("[data-ranked]")).toBeNull();
    expect(text(q(h.root, '[data-testid="ranked-label"]'))).toBe(id.ranked.rankedOn);
  });

  const finished = (ranked: boolean, rewards: object[]) =>
    mkState({
      phase: "finished",
      groupId: "KODE23",
      ranked,
      you: 0,
      seats: [{ name: "Andi", registered: true }, { name: "Budi", registered: true }],
      result: { reason: "out", winner: 0, ranking: [{ seat: 0, rank: 1, points: 0, cardsLeft: 0 }, { seat: 1, rank: 2, points: 8, cardsLeft: 2 }], rewards } as never,
    });

  it("hasil Ranked: Trofi dan Bintang per pemain, panel 'Hasilmu', dan ajakan naik kelas", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(
      finished(true, [
        { seat: 0, trofi: 12, bintang: 5, trofiTotal: 105, kelas: "Jago", kelasUp: "Jago" },
        { seat: 1, trofi: -3, bintang: 5, trofiTotal: 40, kelas: "Pemula", kelasUp: null },
      ]),
    );
    const mine = q(h.root, '[data-testid="my-reward"]');
    expect(text(mine)).toContain(id.ranked.rewardTrofi(12));
    expect(text(mine)).toContain(id.ranked.rewardBintang(5));
    expect(text(q(h.root, '[data-testid="class-up"]'))).toBe(id.ranked.classUp("Jago"));
    const chips = [...h.root.querySelectorAll('[data-testid="reward-chip"]')].map((c) => text(c));
    expect(chips).toEqual([id.ranked.rewardTrofi(12), id.ranked.rewardTrofi(-3)]);
  });

  it("game santai: hanya Bintang (tanpa Trofi dan tanpa chip Trofi); tanpa hadiah: tidak ada panel", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(finished(false, [{ seat: 0, trofi: 0, bintang: 5, trofiTotal: 0, kelas: "Pemula", kelasUp: null }]));
    expect(text(q(h.root, '[data-testid="my-reward"]'))).toContain(id.ranked.rewardBintang(5));
    expect(text(q(h.root, '[data-testid="my-reward"]'))).not.toContain("Trofi");
    expect(h.root.querySelectorAll('[data-testid="reward-chip"]')).toHaveLength(0);
    const g = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    g.sock().open();
    g.sock().receive(finished(false, []));
    expect(g.root.querySelector('[data-testid="my-reward"]')).toBeNull();
  });

  it("selesai Ranked memperbarui dompet di Profil tanpa menunggu server", async () => {
    const { h, f } = await loggedIn("/g/KODE23");
    h.sock().open();
    h.sock().receive(mkState({ phase: "playing", groupId: "KODE23", ranked: true, hand: [[1, 2]], moves: [], turn: 1, seats: [{ name: "Andi", registered: true }, { name: "Budi", registered: true }] }));
    h.sock().receive(finished(true, [{ seat: 0, trofi: 12, bintang: 5, trofiTotal: 132, kelas: "Jago", kelasUp: null }, { seat: 1, trofi: 0, bintang: 5, trofiTotal: 0, kelas: "Pemula", kelasUp: null }]));
    await flush();
    tab(h, "profile");
    expect(text(q(h.root, '[data-testid="wallet-trofi"]'))).toBe("132 Trofi");
    expect(text(q(h.root, '[data-testid="wallet-bintang"]'))).toBe("40 Bintang");
    expect(f.calls.filter((c) => c.route === "GET /api/leaderboard").length).toBeGreaterThan(1); // papan disegarkan
  });
});
