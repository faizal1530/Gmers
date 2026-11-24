import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LudoView } from "@gmers/server/protocol";
import { id } from "../src/i18n/id";
import { describeLudoMove } from "../src/app";
import { pawnPoint } from "../src/views/ludo";
import { memoryKV, mkState, mount, q, text } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const lv = (over: Partial<LudoView> = {}): LudoView => ({
  dice: null,
  lastRoll: null,
  lastCapture: [],
  players: [
    { seat: 0, start: 0, pawns: [-1, -1, -1, -1] },
    { seat: 1, start: 13, pawns: [-1, -1, -1, -1] },
  ],
  ...over,
});

function room(opts: Parameters<typeof mkState>[0] = {}) {
  const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
  h.sock().open();
  h.sock().receive(mkState({ phase: "playing", gameId: "ludo", groupId: "KODE23", turn: 0, ludo: lv(), moves: [{ type: "roll" }], ...opts }));
  return h;
}

describe("geometri papan Ludo", () => {
  it("52 petak jalur berurutan bersebelahan dan tidak ada yang kembar; titik awal 4 kursi di tempat yang benar", () => {
    const pts = Array.from({ length: 52 }, (_, i) => pawnPoint(0, 0, i, 0));
    // progress 0..50 untuk kursi 0 mencakup 51 petak; petak ke-52 = start-1 (kursi 1 start 13 dst. menutupnya)
    expect(new Set(pts.slice(0, 51).map((p) => p.join(","))).size).toBe(51);
    let diagonals = 0;
    for (let i = 1; i < 51; i++) {
      const [x1, y1] = pts[i - 1] as [number, number];
      const [x2, y2] = pts[i] as [number, number];
      const dx = Math.abs(x1 - x2);
      const dy = Math.abs(y1 - y2);
      expect(Math.max(dx, dy)).toBe(10); // tetangga: tepat satu petak (U = 10)
      if (dx === 10 && dy === 10) diagonals++; // di sudut papan klasik jalur melangkah diagonal
    }
    expect(diagonals).toBe(4); // tepat empat sudut: (6,5)->(5,6), (5,8)->(6,9), (8,9)->(9,8), (9,6)->(8,5)
    const cell = (slot: number): [number, number] => pawnPoint(slot, slot * 13, 0, 0);
    expect(cell(0)).toEqual([15, 65]); // (baris 6, kolom 1)
    expect(cell(1)).toEqual([85, 15]); // (1, 8)
    expect(cell(2)).toEqual([135, 85]); // (8, 13)
    expect(cell(3)).toEqual([65, 135]); // (13, 6)
  });

  it("lorong rumah menyambung dari petak terakhir jalur ke pusat; tiap kursi masuk dari sisinya", () => {
    for (let slot = 0; slot < 4; slot++) {
      const start = slot * 13;
      const last = pawnPoint(slot, start, 50, 0);
      const first = pawnPoint(slot, start, 51, 0);
      expect(Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1])).toBe(10);
      for (let p = 52; p <= 55; p++) {
        const a = pawnPoint(slot, start, p - 1, 0);
        const b = pawnPoint(slot, start, p, 0);
        expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBe(10);
      }
      const end = pawnPoint(slot, start, 55, 0);
      const home = pawnPoint(slot, start, 56, 0);
      expect(Math.abs(end[0] - home[0]) + Math.abs(end[1] - home[1])).toBe(10);
    }
  });

  it("kandang: empat slot berbeda di sudut kursi masing-masing", () => {
    for (let slot = 0; slot < 4; slot++) {
      const pts = [0, 1, 2, 3].map((p) => pawnPoint(slot, slot * 13, -1, p).join(","));
      expect(new Set(pts).size).toBe(4);
    }
    expect(pawnPoint(0, 0, -1, 0)[0]).toBeLessThan(60); // kiri atas
    expect(pawnPoint(2, 26, -1, 0)[0]).toBeGreaterThan(90); // kanan bawah
  });
});

describe("tampilan Ludo di klien", () => {
  it("giliranmu: tombol Lempar dadu aktif dan mengirim roll; papan dan 8 bidak tampil", () => {
    const h = room();
    const roll = q<HTMLButtonElement>(h.root, '[data-testid="roll"]');
    expect(roll.disabled).toBe(false);
    expect(text(q(h.root, '[data-testid="ludo-hint"]'))).toBe(id.ludo.yourRoll);
    expect(h.root.querySelectorAll(".pawn")).toHaveLength(8);
    expect(h.root.querySelectorAll(".pawn.ok")).toHaveLength(0);
    roll.click();
    expect(h.sock().sent.at(-1)).toEqual({ type: "roll" });
  });

  it("bukan giliranmu: tombol nonaktif, tidak ada bidak yang bisa diketuk, tidak mengirim apa pun", () => {
    const h = room({ turn: 1, moves: [] });
    const roll = q<HTMLButtonElement>(h.root, '[data-testid="roll"]');
    expect(roll.disabled).toBe(true);
    const before = h.sock().sent.length;
    roll.click();
    expect(h.sock().sent).toHaveLength(before);
    expect(text(q(h.root, '[data-testid="ludo-hint"]'))).toBe(id.ludo.waitRoll("Budi"));
  });

  it("setelah lempar: hanya bidak yang boleh jalan menyala dan bisa diketuk (papan dan daftar tombol); mengirim pick", () => {
    const h = room({
      moves: [{ type: "pick", pawn: 1 }, { type: "pick", pawn: 3 }],
      ludo: lv({ dice: 4, lastRoll: { seat: 0, value: 4 }, players: [{ seat: 0, start: 0, pawns: [-1, 10, 56, 20] }, { seat: 1, start: 13, pawns: [-1, -1, -1, -1] }] }),
    });
    const ok = [...h.root.querySelectorAll(".pawn.ok")].map((g) => g.getAttribute("data-pawn"));
    expect(ok).toEqual(["1", "3"]);
    expect(h.root.querySelectorAll('.pawn[data-seat="1"].ok')).toHaveLength(0); // bidak lawan tak pernah bisa diketuk
    expect(q(h.root, ".pawn.ok").getAttribute("role")).toBe("button");
    expect(q(h.root, '.pawn[data-pawn="0"][data-seat="0"]').getAttribute("role")).toBe("img");
    expect(q<HTMLButtonElement>(h.root, '[data-testid="roll"]').disabled).toBe(true); // sudah melempar
    expect(text(q(h.root, '[data-testid="ludo-hint"]'))).toBe(id.ludo.pickPawn);
    expect(q(h.root, '[data-testid="ludo-board"]').querySelector('.pawn[data-pawn="2"]')!.getAttribute("aria-label")).toContain(id.ludo.pawnHome);

    q(h.root, '.pawn[data-pawn="3"][data-seat="0"]').dispatchEvent(new Event("click", { bubbles: true }));
    expect(h.sock().sent.at(-1)).toEqual({ type: "pick", pawn: 3 });
    q<HTMLButtonElement>(h.root, '[data-pawn-pick="1"]').click();
    expect(h.sock().sent.at(-1)).toEqual({ type: "pick", pawn: 1 });
    // bidak yang tidak sah tidak bisa dipilih lewat daftar tombol
    expect(h.root.querySelector('[data-pawn-pick="0"]')).toBeNull();
    expect(h.root.querySelector('[data-pawn-pick="2"]')).toBeNull();
  });

  it("papan bisa dioperasikan dengan papan ketik (Enter dan spasi pada bidak yang menyala)", () => {
    const h = room({ moves: [{ type: "pick", pawn: 0 }], ludo: lv({ dice: 6, lastRoll: { seat: 0, value: 6 } }) });
    const g = q(h.root, ".pawn.ok");
    expect(g.getAttribute("tabindex")).toBe("0");
    g.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    g.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(h.sock().sent.filter((m) => m.type === "pick")).toHaveLength(2);
  });

  it("terputus: tidak ada yang bisa dikirim walau masih terlihat", () => {
    const h = room({ moves: [{ type: "pick", pawn: 0 }], ludo: lv({ dice: 6, lastRoll: { seat: 0, value: 6 } }) });
    (h.sock() as unknown as { drop(): void }).drop();
    expect(h.root.querySelectorAll(".pawn.ok")).toHaveLength(0);
    expect(q<HTMLButtonElement>(h.root, '[data-testid="roll"]').disabled).toBe(true);
  });

  it("dadu menampilkan angka terakhir dengan label untuk pembaca layar", () => {
    const h = room({ ludo: lv({ lastRoll: { seat: 1, value: 5 } }), turn: 1, moves: [] });
    expect(q(h.root, ".die").getAttribute("aria-label")).toBe(id.ludo.diceLabel(5));
    expect(q(h.root, ".die").querySelectorAll(".pip.on")).toHaveLength(5);
  });

  it("bilah giliran dan tombol Colek juga ada di Ludo", () => {
    const h = room({ turn: 1, moves: [] });
    expect(text(q(h.root, '[data-testid="turn-text"]'))).toBe(id.table.turnOf("Budi"));
    q<HTMLButtonElement>(h.root, '[data-testid="nudge"]').click();
    expect(h.sock().sent.at(-1)).toEqual({ type: "nudge" });
  });

  it("hasil Ludo: pemenang, peringkat, dan 'N dari 4 bidak sampai rumah'", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(
      mkState({
        phase: "finished",
        gameId: "ludo",
        groupId: "KODE23",
        ludo: lv(),
        result: { reason: "home", winner: 1, ranking: [{ seat: 1, rank: 1, points: 224, cardsLeft: 0 }, { seat: 0, rank: 2, points: 90, cardsLeft: 3 }] },
      }),
    );
    expect(text(h.root)).toContain(id.result.reasonHome);
    const rows = [...h.root.querySelectorAll('[data-testid="ranking"] li')].map((r) => text(r));
    expect(rows[0]).toContain(id.ludo.homeCount(4));
    expect(rows[1]).toContain(id.ludo.homeCount(1));
  });
});

describe("langkah dan suara Ludo", () => {
  const before = (dice: number | null, pawns: number[] = [-1, -1, -1, -1]) =>
    mkState({ phase: "playing", gameId: "ludo", groupId: "KODE23", turn: 0, moves: [], ludo: lv({ dice, players: [{ seat: 0, start: 0, pawns }, { seat: 1, start: 13, pawns: [-1, -1, -1, -1] }] }) });
  const after = (over: { turn: number; dice: number | null; pawns?: number[]; roll?: number; capture?: boolean; moveCount: number }) => {
    const st = mkState({
      phase: "playing",
      gameId: "ludo",
      groupId: "KODE23",
      turn: over.turn,
      moves: [],
      ludo: lv({
        dice: over.dice,
        lastRoll: over.roll ? { seat: 0, value: over.roll } : null,
        lastCapture: over.capture ? [{ seat: 1, pawn: 0 }] : [],
        players: [{ seat: 0, start: 0, pawns: over.pawns ?? [-1, -1, -1, -1] }, { seat: 1, start: 13, pawns: [-1, -1, -1, -1] }],
      }),
    });
    st.game!.moveCount = over.moveCount;
    return st;
  };

  it("selisih state: lemparan, lemparan tanpa langkah, bidak digerakkan, bidak dimakan", () => {
    const a = before(null);
    const roll = describeLudoMove(a, after({ turn: 0, dice: 4, roll: 4, moveCount: 1, pawns: [10, -1, -1, -1] }));
    expect(roll).toEqual({ text: id.ludo.rolled("Andi", 4), sound: "dice" });
    const stuck = describeLudoMove(a, after({ turn: 1, dice: null, roll: 3, moveCount: 1 }));
    expect(stuck?.text).toBe(`${id.ludo.rolled("Andi", 3)} · ${id.ludo.noMove}`);
    const picked = before(4, [10, -1, -1, -1]);
    picked.game!.moveCount = 1;
    expect(describeLudoMove(picked, after({ turn: 1, dice: null, pawns: [14, -1, -1, -1], moveCount: 2 }))).toEqual({ text: id.ludo.moved("Andi", 1), sound: "place" });
    expect(describeLudoMove(picked, after({ turn: 0, dice: null, pawns: [14, -1, -1, -1], capture: true, moveCount: 2 }))).toEqual({ text: id.ludo.captured("Andi"), sound: "capture" });
    expect(describeLudoMove(a, a)).toBeNull();
  });

  it("alur nyata: lemparan berbunyi 'dice', gerakan 'place', memakan 'capture', dan catatan langkah tampil", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(before(null));
    h.sock().receive(after({ turn: 0, dice: 4, roll: 4, moveCount: 1, pawns: [10, -1, -1, -1] }));
    expect(h.sound.played).toContain("dice");
    expect(text(q(h.root, '[data-testid="lastmove"]'))).toBe(id.ludo.rolled("Andi", 4));
    h.sock().receive(after({ turn: 0, dice: null, roll: 4, moveCount: 2, pawns: [14, -1, -1, -1], capture: true }));
    expect(h.sound.played).toContain("capture");
    expect(text(q(h.root, '[data-testid="lastmove"]'))).toBe(id.ludo.captured("Andi"));
  });
});

describe("memilih dan membuat game", () => {
  it("tab Games: tombol Buat room Ludo mengirim create_room dengan game ludo; Gaple tetap default", () => {
    const h = mount("/", memoryKV({ "gmers.name": "Andi" }));
    q<HTMLButtonElement>(h.root, '[data-testid="create-ludo"]').click();
    h.sock().open();
    expect(h.sock().sent[0]).toMatchObject({ type: "create_room", name: "Andi", game: "ludo" });

    const g = mount("/", memoryKV({ "gmers.name": "Budi" }));
    q<HTMLFormElement>(g.root, "form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    g.sock().open();
    expect(g.sock().sent[0]).toMatchObject({ type: "create_room", name: "Budi", game: "gaple" });
  });

  it("nama terlalu pendek: tombol Ludo juga menolak dengan pesan dan tidak menyambung", () => {
    const h = mount("/", memoryKV());
    q<HTMLInputElement>(h.root, "input#nama").value = "A";
    q<HTMLButtonElement>(h.root, '[data-testid="create-ludo"]').click();
    expect(text(q(h.root, "#nama-bantuan"))).toBe(id.name.tooShort);
    expect(h.sockets).toHaveLength(0);
  });

  it("ruang tunggu: pemilik memilih game (set_game); tamu hanya melihat game terpilih", () => {
    const host = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    host.sock().open();
    host.sock().receive(mkState({ phase: "lobby", groupId: "KODE23", gameId: "gaple" }));
    expect(q(host.root, '[data-game="gaple"]').getAttribute("aria-checked")).toBe("true");
    q<HTMLButtonElement>(host.root, '[data-game="ludo"]').click();
    expect(host.sock().sent.at(-1)).toEqual({ type: "set_game", game: "ludo" });

    const guest = mount("/g/KODE23", memoryKV({ "gmers.name": "Budi" }));
    guest.sock().open();
    guest.sock().receive(mkState({ phase: "lobby", groupId: "KODE23", gameId: "ludo", you: 1 }));
    expect(guest.root.querySelector("[data-game]")).toBeNull();
    expect(text(q(guest.root, '[data-testid="game-label"]'))).toContain(id.gamePick.ludo);
  });
});
