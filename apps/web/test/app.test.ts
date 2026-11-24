import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { id } from "../src/i18n/id";
import { FakeSocket, memoryKV, mkState, mount, q, text } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function submitName(root: HTMLElement, name: string): void {
  const input = q<HTMLInputElement>(root, "input#nama");
  input.value = name;
  q<HTMLFormElement>(root, "form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

describe("beranda dan membuat room", () => {
  it("nama terlalu pendek ditolak dengan pesan Indonesia dan tidak mengirim apa pun", () => {
    const h = mount("/");
    submitName(h.root, "A");
    expect(text(q(h.root, "#nama-bantuan"))).toBe(id.name.tooShort);
    expect(h.sockets).toHaveLength(0);
  });

  it("nama valid: menyambung lalu mengirim create_room dengan token perangkat; beralih ke ruang tunggu dan tautan /g/KODE", () => {
    const kv = memoryKV();
    const h = mount("/", kv);
    submitName(h.root, "  Andi  ");
    const s = h.sock();
    s.open();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ type: "create_room", name: "Andi" });
    expect(String(s.sent[0]!.token)).toMatch(/^[0-9a-f]{32}$/);
    expect(kv.data.get("gmers.name")).toBe("Andi");
    s.receive(mkState({ phase: "lobby", seats: [{ name: "Andi" }, null, null, null], groupId: "KODE23" }));
    expect(window.location.pathname).toBe("/g/KODE23");
    expect(text(h.root)).toContain(id.lobby.title);
    expect(text(q(h.root, '[data-testid="share-url"]'))).toBe("https://gmers.test/g/KODE23");
    const wa = q<HTMLAnchorElement>(h.root, "a.wa");
    expect(wa.href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(wa.href.split("text=")[1]!)).toContain("https://gmers.test/g/KODE23");
  });

  it("tombol Salin menyalin tautan dan memberi tahu", async () => {
    const h = mount("/");
    submitName(h.root, "Andi");
    h.sock().open();
    h.sock().receive(mkState({ phase: "lobby", seats: [{ name: "Andi" }, null, null, null], groupId: "KODE23" }));
    q<HTMLButtonElement>(h.root, "button.btn:not(.primary):not(.link)").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.copied).toEqual(["https://gmers.test/g/KODE23"]);
    expect(text(h.root)).toContain(id.lobby.copied);
  });
});

describe("ruang tunggu", () => {
  const lobby = (you: number, seats = [{ name: "Andi" }, { name: "Budi" }, null, null] as Parameters<typeof mkState>[0]["seats"]) =>
    mkState({ phase: "lobby", you, seats, groupId: "KODE23" });

  it("pemilik: tombol Mulai nonaktif bila sendirian, aktif bila ada 2 pemain, dan mengirim start", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(lobby(0, [{ name: "Andi" }, null, null, null]));
    const start = (): HTMLButtonElement => q<HTMLButtonElement>(h.root, "button.primary.big");
    expect(start().disabled).toBe(true);
    expect(text(h.root)).toContain(id.lobby.needMore);
    h.sock().receive(lobby(0));
    expect(start().disabled).toBe(false);
    start().click();
    expect(h.sock().sent.at(-1)).toEqual({ type: "start" });
  });

  it("bukan pemilik: tidak ada tombol Mulai, ada pesan menunggu; status Siap/Terputus tampil", () => {
    const h = mount("/g/KODE23");
    h.sock().open();
    h.sock().receive(lobby(1, [{ name: "Andi" }, { name: "Budi", connected: true }, { name: "Citra", connected: false }, null]));
    expect(h.root.querySelector("button.primary.big")).toBeNull();
    expect(text(h.root)).toContain(id.lobby.waitHost("Andi"));
    expect(text(h.root)).toContain(id.lobby.offline);
    expect(h.root.querySelectorAll("li.seat.empty")).toHaveLength(1);
  });
});

describe("masuk lewat tautan", () => {
  it("mengirim open_link; kelompok sedang main dan pemain asing: pesan jelas, tanpa formulir", () => {
    const h = mount("/g/KODE23");
    const s = h.sock();
    s.open();
    expect(s.sent[0]).toMatchObject({ type: "open_link", groupId: "KODE23" });
    expect(text(h.root)).toContain(id.link.opening);
    s.receive({ type: "group_info", groupId: "KODE23", phase: "playing", players: 3, maxSeats: 4, isMember: false });
    expect(text(h.root)).toContain(id.link.playing);
    expect(h.root.querySelector("main form")).toBeNull();
  });

  it("room penuh: pesan penuh", () => {
    const h = mount("/g/KODE23");
    h.sock().open();
    h.sock().receive({ type: "group_info", groupId: "KODE23", phase: "lobby", players: 4, maxSeats: 4, isMember: false });
    expect(text(h.root)).toContain(id.link.full);
  });

  it("pemain baru mengisi nama lalu mengirim join; nama terisi dari penyimpanan", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Budi" }));
    h.sock().open();
    h.sock().receive({ type: "group_info", groupId: "KODE23", phase: "lobby", players: 1, maxSeats: 4, isMember: false });
    expect(q<HTMLInputElement>(h.root, "input#nama").value).toBe("Budi");
    submitName(h.root, "Budi Setiawan");
    expect(h.sock().sent.at(-1)).toMatchObject({ type: "join", groupId: "KODE23", name: "Budi Setiawan" });
  });

  it("anggota yang kembali: join otomatis tanpa formulir", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Budi" }));
    h.sock().open();
    h.sock().receive({ type: "group_info", groupId: "KODE23", phase: "playing", players: 3, maxSeats: 4, isMember: true });
    expect(h.sock().sent.at(-1)).toMatchObject({ type: "join", groupId: "KODE23", name: "Budi" });
  });

  it("kode tak dikenal dan alamat sembarang menampilkan halaman tidak ditemukan yang ramah", () => {
    const h = mount("/g/TIDAKADA");
    h.sock().open();
    h.sock().receive({ type: "error", code: "ROOM_NOT_FOUND", message: "x" });
    expect(text(h.root)).toContain(id.notFound.title);
    expect(text(h.root)).toContain(id.notFound.linkBody);
    const h2 = mount("/halaman/ngawur");
    expect(text(h2.root)).toContain(id.notFound.body);
    expect(h2.sockets).toHaveLength(0);
  });

  it("halaman privasi tampil dengan penanda DRAF", () => {
    const h = mount("/privasi");
    expect(text(h.root)).toContain(id.privacy.title);
    expect(text(q(h.root, ".draft"))).toBe(id.privacy.draft);
  });
});

describe("meja Gaple: hanya langkah sah yang bisa dikirim", () => {
  const playing = (moves: Parameters<typeof mkState>[0]["moves"], extra: Partial<Parameters<typeof mkState>[0]> = {}) =>
    mkState({
      phase: "playing",
      groupId: "KODE23",
      hand: [[1, 2], [3, 4], [6, 6], [0, 5]],
      board: [[2, 3]],
      ends: { left: 2, right: 3 },
      moves,
      ...extra,
    });

  function setup(state: ReturnType<typeof mkState>) {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(state);
    return h;
  }
  const btn = (h: ReturnType<typeof setup>, key: string): HTMLButtonElement => q<HTMLButtonElement>(h.root, `[data-card="${key}"]`);

  it("kartu sah menyala, kartu lain diredupkan dan tidak mengirim apa pun saat diketuk", () => {
    const h = setup(playing([{ type: "play", card: [1, 2], end: "left" }, { type: "play", card: [3, 4], end: "right" }]));
    expect(btn(h, "1|2").disabled).toBe(false);
    expect(btn(h, "3|4").disabled).toBe(false);
    expect(btn(h, "6|6").disabled).toBe(true);
    expect(btn(h, "0|5").classList.contains("off")).toBe(true);
    const before = h.sock().sent.length;
    btn(h, "6|6").click();
    btn(h, "0|5").click();
    expect(h.sock().sent).toHaveLength(before);
  });

  it("satu ujung: ketukan langsung mengirim play dengan ujung itu", () => {
    const h = setup(playing([{ type: "play", card: [1, 2], end: "left" }]));
    btn(h, "1|2").click();
    expect(h.sock().sent.at(-1)).toEqual({ type: "play", card: [1, 2], end: "left" });
  });

  it("cocok di kedua ujung: tampil pilihan ujung; memilih mengirim ujung itu; Batal menutup", () => {
    const h = setup(playing([{ type: "play", card: [3, 4], end: "left" }, { type: "play", card: [3, 4], end: "right" }]));
    const before = h.sock().sent.length;
    btn(h, "3|4").click();
    expect(h.sock().sent).toHaveLength(before);
    const picker = q(h.root, '[data-testid="end-picker"]');
    expect(text(picker)).toContain(id.table.atLeft(2));
    expect(text(picker)).toContain(id.table.atRight(3));
    q<HTMLButtonElement>(picker, '[data-end="right"]').click();
    expect(h.sock().sent.at(-1)).toEqual({ type: "play", card: [3, 4], end: "right" });
    expect(h.root.querySelector('[data-testid="end-picker"]')).toBeNull();

    btn(h, "3|4").click();
    q<HTMLButtonElement>(h.root, '[data-testid="end-picker"] .btn:not(.primary)').click();
    expect(h.root.querySelector('[data-testid="end-picker"]')).toBeNull();
  });

  it("Lewat aktif hanya bila tidak ada langkah sah selain lewat", () => {
    const withMoves = setup(playing([{ type: "play", card: [1, 2], end: "left" }]));
    expect(q<HTMLButtonElement>(withMoves.root, '[data-testid="pass"]').disabled).toBe(true);
    q<HTMLButtonElement>(withMoves.root, '[data-testid="pass"]').click();
    expect(withMoves.sock().sent.some((m) => m.type === "pass")).toBe(false);

    const onlyPass = setup(playing([{ type: "pass" }]));
    const pass = q<HTMLButtonElement>(onlyPass.root, '[data-testid="pass"]');
    expect(pass.disabled).toBe(false);
    expect(text(onlyPass.root)).toContain(id.table.passHint);
    pass.click();
    expect(onlyPass.sock().sent.at(-1)).toEqual({ type: "pass" });
    expect(onlyPass.root.querySelectorAll(".card-btn.ok")).toHaveLength(0);
  });

  it("bukan giliranmu: semua kartu nonaktif walau server (salah) mengirim langkah; Lewat nonaktif", () => {
    const h = setup(playing([{ type: "play", card: [1, 2], end: "left" }], { turn: 1 }));
    expect(h.root.querySelectorAll(".card-btn:not(:disabled)")).toHaveLength(0);
    expect(q<HTMLButtonElement>(h.root, '[data-testid="pass"]').disabled).toBe(true);
    expect(text(h.root)).toContain(id.table.turnOf("Budi"));
  });

  it("ujung kiri dan kanan, jumlah kartu lawan, dan status koneksi tampil", () => {
    const h = setup(
      playing([{ type: "pass" }], { seats: [{ name: "Andi" }, { name: "Budi", cardsLeft: 5, connected: false }, null, null] }),
    );
    expect(text(q(h.root, '[data-testid="end-left"]'))).toBe("2");
    expect(text(q(h.root, '[data-testid="end-right"]'))).toBe("3");
    const budi = q(h.root, '.pl[data-seat="1"]');
    expect(text(budi)).toContain(id.table.cardsLeft(5));
    expect(q(budi, ".dot").getAttribute("aria-label")).toBe(id.lobby.offline);
    expect(h.root.querySelectorAll('[data-testid="hand"] .domino')).toHaveLength(4);
  });

  it("indikator giliran dan sisa waktu dihitung dari jam server", () => {
    const now = Date.now();
    const h = setup(playing([{ type: "pass" }], { now, deadline: now + 42_000 }));
    expect(text(q(h.root, '[data-testid="turn-text"]'))).toBe(id.table.yourTurn);
    expect(text(q(h.root, '[data-testid="timer"]'))).toBe(id.table.secondsLeft(42));
    vi.advanceTimersByTime(10_000);
    expect(text(q(h.root, '[data-testid="timer"]'))).toBe(id.table.secondsLeft(32));
  });
});

describe("hasil game dan rematch", () => {
  it("peringkat 1..n dengan sisa titik dan tombol Main lagi mengirim rematch", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(
      mkState({
        phase: "finished",
        groupId: "KODE23",
        you: 1,
        seats: [{ name: "Andi" }, { name: "Budi" }, { name: "Citra" }, null],
        result: {
          reason: "out",
          winner: 2,
          ranking: [
            { seat: 2, rank: 1, points: 0, cardsLeft: 0 },
            { seat: 0, rank: 2, points: 7, cardsLeft: 2 },
            { seat: 1, rank: 3, points: 12, cardsLeft: 3 },
          ],
        },
      }),
    );
    const rows = [...h.root.querySelectorAll('[data-testid="ranking"] li')].map((li) => text(li));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Citra");
    expect(rows[1]).toContain(id.result.points(7));
    expect(rows[2]).toContain(`Budi (${id.lobby.you})`);
    expect(text(h.root)).toContain(id.result.winner("Citra"));
    q<HTMLButtonElement>(h.root, '[data-testid="rematch"]').click();
    expect(h.sock().sent.at(-1)).toEqual({ type: "rematch" });
  });
});

describe("sambung ulang otomatis", () => {
  it("putus di tengah game: banner muncul, kartu tetap tampil dan tak bisa dikirim; sambung kembali mengirim join dengan token yang sama", () => {
    const kv = memoryKV({ "gmers.name": "Andi" });
    const h = mount("/g/KODE23", kv);
    const s1 = h.sock();
    s1.open();
    s1.receive({ type: "group_info", groupId: "KODE23", phase: "playing", players: 2, maxSeats: 4, isMember: true });
    const token = s1.sent.find((m) => m.type === "open_link")!.token;
    s1.receive(
      mkState({ phase: "playing", groupId: "KODE23", hand: [[1, 2], [3, 4]], board: [[2, 3]], ends: { left: 2, right: 3 }, moves: [{ type: "play", card: [1, 2], end: "left" }] }),
    );
    expect(q<HTMLButtonElement>(h.root, '[data-card="1|2"]').disabled).toBe(false);

    s1.drop();
    expect(text(q(h.root, '[data-testid="banner"]'))).toBe(id.conn.reconnecting);
    expect(h.root.querySelectorAll('[data-testid="hand"] .domino')).toHaveLength(2);
    const sentBefore = s1.sent.length;
    // ketukan saat terputus tidak mengirim apa pun
    h.root.querySelector<HTMLButtonElement>('[data-card="1|2"]')!.click();
    expect(s1.sent).toHaveLength(sentBefore);
    expect(q<HTMLButtonElement>(h.root, '[data-card="1|2"]').disabled).toBe(true);

    vi.advanceTimersByTime(600);
    expect(h.sockets).toHaveLength(2);
    const s2 = h.sock();
    s2.open();
    expect(s2.sent[0]).toMatchObject({ type: "join", groupId: "KODE23", name: "Andi", token });
    expect(h.root.querySelector('[data-testid="banner"]')!.hasAttribute("hidden")).toBe(true);
  });

  it("gagal berulang: jeda naik bertahap (backoff) dan berhenti di 5 detik", () => {
    const h = mount("/g/KODE23");
    h.sock().open();
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      h.sock().drop();
      const n = h.sockets.length;
      let waited = 0;
      while (h.sockets.length === n && waited < 6000) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      delays.push(waited);
    }
    expect(delays.slice(0, 4)).toEqual([500, 1000, 2000, 4000]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(5000);
  });

  it("event 'online' langsung mencoba menyambung tanpa menunggu jeda", () => {
    const h = mount("/g/KODE23");
    h.sock().open();
    h.sock().drop();
    expect(h.sockets).toHaveLength(1);
    window.dispatchEvent(new Event("online"));
    expect(h.sockets).toHaveLength(2);
  });

  it("tab lain mengambil alih (REPLACED): berhenti menyambung dan menampilkan penjelasan", () => {
    const h = mount("/g/KODE23");
    h.sock().open();
    h.sock().receive(mkState({ phase: "lobby", groupId: "KODE23" }));
    h.sock().receive({ type: "error", code: "REPLACED", message: "x" });
    expect(text(q(h.root, '[data-testid="banner"]'))).toContain(id.conn.replaced);
    vi.advanceTimersByTime(10_000);
    expect(h.sockets).toHaveLength(1);
  });
});

describe("chat sebagai tab", () => {
  function inRoom() {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(mkState({ phase: "lobby", groupId: "KODE23" }));
    return h;
  }
  const openChat = (h: ReturnType<typeof inRoom>): void => q<HTMLButtonElement>(h.root, '[data-testid="tab-chat"]').click();
  const send = (h: ReturnType<typeof inRoom>, t: string): void => {
    q<HTMLInputElement>(h.root, '[data-testid="chat-input"]').value = t;
    q<HTMLFormElement>(h.root, ".chat-form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  };

  it("pesan masuk saat di tab lain menambah penanda pada tab Chat; membuka tab menghapusnya", () => {
    const h = inRoom();
    expect(h.root.querySelector('[data-testid="chat-badge"]')).toBeNull();
    h.sock().receive({ type: "chat", seat: 1, name: "Budi", text: "halo", ts: 1 });
    h.sock().receive({ type: "chat", seat: 1, name: "Budi", text: "ayo mulai", ts: 2 });
    const badge = q(h.root, '[data-testid="chat-badge"]');
    expect(text(badge)).toBe("2");
    expect(q(h.root, '[data-testid="tab-chat"]').getAttribute("aria-label")).toContain(id.chat.tabUnread(2));
    openChat(h);
    expect(h.root.querySelector('[data-testid="chat-badge"]')).toBeNull();
    expect(text(q(h.root, '[data-testid="chat-log"]'))).toContain("halo");
    expect(text(q(h.root, ".chat-head"))).toContain(id.chat.groupTitle("KODE23"));
    // pesan masuk saat tab Chat terbuka tidak menambah penanda
    h.sock().receive({ type: "chat", seat: 1, name: "Budi", text: "lagi", ts: 3 });
    expect(h.root.querySelector('[data-testid="chat-badge"]')).toBeNull();
  });

  it("HTML dalam pesan ditampilkan sebagai teks dan tidak pernah dieksekusi", () => {
    const h = inRoom();
    openChat(h);
    const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    h.sock().receive({ type: "chat", seat: 1, name: "<b>Budi</b>", text: evil, ts: 1 });
    const log = q(h.root, '[data-testid="chat-log"]');
    expect(log.querySelector("img, script, b")).toBeNull();
    expect(log.textContent).toContain(evil);
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it("mengirim pesan yang sudah dibersihkan; pesan kosong tidak dikirim; laju dibatasi 5 per 10 detik", () => {
    const h = inRoom();
    openChat(h);
    send(h, "   ");
    expect(h.sock().sent.some((m) => m.type === "chat")).toBe(false);
    send(h, "  halo\u0000   semua ");
    expect(h.sock().sent.at(-1)).toEqual({ type: "chat", text: "halo semua" });
    expect(q<HTMLInputElement>(h.root, '[data-testid="chat-input"]').value).toBe("");
    for (let i = 0; i < 4; i++) send(h, `p${i}`);
    expect(h.sock().sent.filter((m) => m.type === "chat")).toHaveLength(5);
    send(h, "keenam");
    expect(h.sock().sent.filter((m) => m.type === "chat")).toHaveLength(5);
    expect(text(q(h.root, ".chat-view .hint"))).toBe(id.chat.tooFast);
  });

  it("tanpa room: tab Chat menjelaskan bahwa chat aktif setelah masuk room", () => {
    const h = mount("/");
    q<HTMLButtonElement>(h.root, '[data-testid="tab-chat"]').click();
    expect(text(h.root)).toContain(id.chat.noRoomTitle);
  });
});

describe("tab navigasi", () => {
  it("empat tab (Games, Room, Chat, Profil); Games aktif di beranda dan menandai halaman aktif", () => {
    const h = mount("/");
    const tabs = [...h.root.querySelectorAll(".tabs .tab")].map((t) => text(t));
    expect(tabs).toEqual([id.tabs.games, id.tabs.room, id.tabs.chat, id.tabs.profile]);
    expect(q(h.root, '[data-testid="tab-games"]').getAttribute("aria-current")).toBe("page");
    expect(q(h.root, '[data-testid="tab-room"]').hasAttribute("aria-current")).toBe(false);
    expect(h.root.querySelector("nav")!.getAttribute("aria-label")).toBe(id.tabs.label);
  });

  it("tab Games: Gaple aktif, Ludo dan Remi 'Segera', aturan singkat", () => {
    const h = mount("/");
    expect(text(h.root)).toContain(id.games.gaple.name);
    expect([...h.root.querySelectorAll(".game-card.soon")].map((c) => text(c))).toEqual([expect.stringContaining(id.games.soon), expect.stringContaining(id.games.soon)]);
    expect(h.root.querySelectorAll(".rules li")).toHaveLength(id.games.rules.length);
  });

  it("tab Room tanpa room: pesan kosong; tempel tautan atau kode membuka kelompok", () => {
    const h = mount("/");
    q<HTMLButtonElement>(h.root, '[data-testid="tab-room"]').click();
    expect(text(h.root)).toContain(id.roomTab.emptyTitle);
    const input = q<HTMLInputElement>(h.root, "input#tempel");
    input.value = "bukan tautan!";
    q<HTMLFormElement>(h.root, "form.panel").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(text(h.root)).toContain(id.roomTab.pasteBad);
    expect(h.sockets).toHaveLength(0);
    input.value = "https://gmers.test/g/abc234";
    q<HTMLFormElement>(h.root, "form.panel").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(window.location.pathname).toBe("/g/ABC234");
    h.sock().open();
    expect(h.sock().sent[0]).toMatchObject({ type: "open_link", groupId: "ABC234" });
  });

  it("setelah masuk room, tab beralih ke Room; tab Games menawarkan Kembali ke room", () => {
    const h = mount("/");
    submitName(h.root, "Andi");
    h.sock().open();
    h.sock().receive(mkState({ phase: "lobby", seats: [{ name: "Andi" }, null, null, null], groupId: "KODE23" }));
    expect(q(h.root, '[data-testid="tab-room"]').getAttribute("aria-current")).toBe("page");
    q<HTMLButtonElement>(h.root, '[data-testid="tab-games"]').click();
    expect(text(h.root)).toContain(id.games.inRoom("KODE23"));
    q<HTMLButtonElement>(h.root, '[data-testid="back-to-room"]').click();
    expect(text(h.root)).toContain(id.lobby.title);
  });

  it("tab Profil: simpan nama, ganti tema, bisukan suara, buka kebijakan privasi", () => {
    const kv = memoryKV({ "gmers.name": "Andi" });
    const h = mount("/", kv);
    q<HTMLButtonElement>(h.root, '[data-testid="tab-profile"]').click();
    const input = q<HTMLInputElement>(h.root, "input#nama");
    expect(input.value).toBe("Andi");
    input.value = "A";
    q<HTMLFormElement>(h.root, "form.form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(text(q(h.root, "#nama-bantuan"))).toBe(id.name.tooShort);
    q<HTMLInputElement>(h.root, "input#nama").value = "Andi Baru";
    q<HTMLFormElement>(h.root, "form.form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(kv.data.get("gmers.name")).toBe("Andi Baru");

    q<HTMLButtonElement>(h.root, '[data-theme-mode="dark"]').click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(kv.data.get("gmers.theme")).toBe("dark");
    q<HTMLButtonElement>(h.root, '[data-theme-mode="auto"]').click();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

    q<HTMLButtonElement>(h.root, '[data-sound="off"]').click();
    expect(h.sound.enabled).toBe(false);
    q<HTMLButtonElement>(h.root, '[data-sound="on"]').click();
    expect(h.sound.enabled).toBe(true);

    q<HTMLButtonElement>(h.root, ".panel button.btn:not(.primary)").click();
    expect(text(h.root)).toContain(id.privacy.title);
    expect(window.location.pathname).toBe("/privasi");
  });
});

describe("suara dan sundulan", () => {
  function playing(extra: Partial<Parameters<typeof mkState>[0]> = {}) {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(mkState({ phase: "playing", groupId: "KODE23", hand: [[1, 2], [3, 4]], board: [[2, 3]], ends: { left: 2, right: 3 }, moves: [], turn: 1, ...extra }));
    return h;
  }
  const next = (over: Partial<Parameters<typeof mkState>[0]> & { moveCount: number }) => {
    const s = mkState({ phase: "playing", groupId: "KODE23", hand: [[1, 2], [3, 4]], ...over });
    s.game!.moveCount = over.moveCount;
    return s;
  };

  it("kartu dipasang: bunyi 'place' dan catatan langkah; kartu baru beranimasi di sisi yang benar", () => {
    const h = playing();
    h.sock().receive(next({ moveCount: 1, turn: 0, board: [[2, 3], [3, 5]], ends: { left: 2, right: 5 }, moves: [{ type: "pass" }] }));
    expect(h.sound.played).toContain("place");
    expect(text(q(h.root, '[data-testid="lastmove"]'))).toBe(id.table.lastPlay("Budi", "3|5", "right"));
    const placed = [...h.root.querySelectorAll(".placed")];
    expect(placed.map((p) => p.classList.contains("pop"))).toEqual([false, true]);
    vi.advanceTimersByTime(300);
    expect(h.sound.played).toContain("turn"); // sekarang giliranku
  });

  it("langkah di kiri, membuka, dan lewat dijelaskan dan berbunyi sesuai", () => {
    const h = playing();
    h.sock().receive(next({ moveCount: 1, turn: 0, board: [[1, 2], [2, 3]], ends: { left: 1, right: 3 }, moves: [] }));
    expect(text(q(h.root, '[data-testid="lastmove"]'))).toBe(id.table.lastPlay("Budi", "1|2", "left"));
    expect([...h.root.querySelectorAll(".placed")].map((p) => p.classList.contains("pop"))).toEqual([true, false]);
    h.sound.played.length = 0;
    h.sock().receive(next({ moveCount: 2, turn: 1, board: [[1, 2], [2, 3]], ends: { left: 1, right: 3 }, moves: [] }));
    expect(text(q(h.root, '[data-testid="lastmove"]'))).toBe(id.table.lastPass("Andi"));
    expect(h.sound.played).toEqual(["pass"]);
  });

  it("game baru berbunyi 'start'; hasil berbunyi menang atau kalah", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(mkState({ phase: "lobby", groupId: "KODE23" }));
    h.sock().receive(mkState({ phase: "playing", groupId: "KODE23", turn: 1 }));
    expect(h.sound.played).toContain("start");
    const result = (winner: number) => ({ reason: "out" as const, winner, ranking: [{ seat: winner, rank: 1, points: 0, cardsLeft: 0 }, { seat: 1 - winner, rank: 2, points: 5, cardsLeft: 1 }] });
    const fin = mkState({ phase: "finished", groupId: "KODE23", result: result(0) });
    h.sock().receive(fin);
    vi.advanceTimersByTime(400);
    expect(h.sound.played).toContain("win");
    expect(text(h.root)).toContain(id.result.youWon);

    const h2 = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h2.sock().open();
    h2.sock().receive(mkState({ phase: "playing", groupId: "KODE23", turn: 1 }));
    h2.sock().receive(mkState({ phase: "finished", groupId: "KODE23", result: result(1) }));
    vi.advanceTimersByTime(400);
    expect(h2.sound.played).toContain("lose");
  });

  it("sambung ulang (state pertama) tidak membunyikan 'start' atau 'place'", () => {
    const h = playing({ turn: 0, moves: [{ type: "pass" }] });
    expect(h.sound.played.filter((n) => n === "start" || n === "place")).toEqual([]);
  });

  it("chat dari teman berbunyi; chat sendiri tidak", () => {
    const h = playing();
    h.sock().receive({ type: "chat", seat: 1, name: "Budi", text: "woi", ts: 1 });
    h.sock().receive({ type: "chat", seat: 0, name: "Andi", text: "iya", ts: 2 });
    expect(h.sound.played.filter((n) => n === "chat")).toHaveLength(1);
  });

  it("tombol Colek muncul saat menunggu teman, mengirim nudge, lalu masuk jeda tunggu", () => {
    const h = playing({ turn: 1 });
    const btn = q<HTMLButtonElement>(h.root, '[data-testid="nudge"]');
    expect(text(btn)).toBe(id.table.nudge("Budi"));
    btn.click();
    expect(h.sock().sent.at(-1)).toEqual({ type: "nudge" });
    h.sock().receive({ type: "nudge_ack", seat: 1, name: "Budi" });
    expect(text(q(h.root, '[data-testid="nudge"]'))).toBe(id.table.nudgeWait);
    expect(q<HTMLButtonElement>(h.root, '[data-testid="nudge"]').disabled).toBe(true);
    expect(h.sound.played).toContain("nudge");
    const sentBefore = h.sock().sent.length;
    q<HTMLButtonElement>(h.root, '[data-testid="nudge"]').click();
    expect(h.sock().sent).toHaveLength(sentBefore);
    vi.advanceTimersByTime(10_500);
    expect(q<HTMLButtonElement>(h.root, '[data-testid="nudge"]').disabled).toBe(false);
  });

  it("tidak ada Colek pada giliran sendiri atau saat teman terputus", () => {
    const mine = playing({ turn: 0, moves: [{ type: "pass" }] });
    expect(mine.root.querySelector('[data-testid="nudge"]')).toBeNull();
    const off = playing({ turn: 1, seats: [{ name: "Andi" }, { name: "Budi", connected: false }, null, null] });
    expect(off.root.querySelector('[data-testid="nudge"]')).toBeNull();
  });

  it("menerima sundulan: bunyi, getar, dan pemberitahuan", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const h = playing({ turn: 0, moves: [{ type: "pass" }] });
    h.sock().receive({ type: "nudge", fromSeat: 1, fromName: "Budi" });
    expect(h.sound.played).toContain("nudge");
    expect(vibrate).toHaveBeenCalled();
    expect(text(q(h.root, ".toast"))).toBe(id.table.nudged("Budi"));
  });

  it("gestur pertama membuka kunci audio; bilah waktu mengecil mengikuti sisa waktu", () => {
    const now = Date.now();
    const h = playing({ turn: 1, now, deadline: now + 60_000 });
    document.dispatchEvent(new Event("pointerdown"));
    expect(h.sound.unlocked).toBeGreaterThan(0);
    const fill = q(h.root, "#timefill");
    vi.advanceTimersByTime(250);
    const w0 = parseInt(fill.style.width, 10);
    vi.advanceTimersByTime(30_000);
    const w1 = parseInt(fill.style.width, 10);
    expect(w0).toBeGreaterThan(90);
    expect(w1).toBeLessThan(60);
    expect(w1).toBeGreaterThan(40);
  });
});

it("semua socket uji adalah FakeSocket (tidak ada jaringan nyata)", () => {
  expect(new FakeSocket().readyState).toBe(0);
});
