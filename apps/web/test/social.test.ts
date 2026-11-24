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
const submit = (el: Element): void => void el.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

const friendsData = (over: Record<string, unknown> = {}) => ({
  friends: [{ username: "budi", name: "Budi", kelas: "Perunggu", online: true, status: "siap", streak: { count: 3, doneToday: true } }],
  waiting: [{ username: "citra", name: "Citra" }],
  incoming: [{ username: "dewi", name: "Dewi" }],
  blocked: [],
  status: "siap",
  prefs: { invite: true, follow: true, streak: true, dm: true },
  ...over,
});

async function login(extra: Parameters<typeof fakeFetch>[0] = {}, data = friendsData()) {
  const f = fakeFetch({
    "GET /api/me": () => ({ json: { account: acct(), wallet: null } }),
    "GET /api/leaderboard": () => ({ json: { rows: [], you: { rank: null } } }),
    "GET /api/friends": () => ({ json: data }),
    "GET /api/notices": () => ({ json: { notices: [] } }),
    ...extra,
  });
  const kv = memoryKV({ "gmers.session": "a".repeat(64), "gmers.name": "Andi" });
  const h = mount("/", kv, { fetch: f.fn });
  await flush();
  return { h, f };
}

async function openFriends(h: Harness): Promise<void> {
  await flush();
  tab(h, "chat");
  q<HTMLButtonElement>(h.root, '[data-testid="open-friends"]').click();
  await flush();
}

describe("daftar teman", () => {
  it("tamu diminta daftar dulu", () => {
    const h = mount("/");
    tab(h, "chat");
    q<HTMLButtonElement>(h.root, '[data-testid="open-friends"]').click();
    expect(text(h.root)).toContain(id.friends.needAccount);
  });

  it("menampilkan teman (online, streak), menunggu saling, dan yang mengikuti", async () => {
    const { h } = await login();
    await openFriends(h);
    const row = q(h.root, '[data-testid="friend"][data-username="budi"]');
    expect(text(row)).toContain("Budi");
    expect(text(row)).toContain("@budi");
    expect(text(q(row, '[data-testid="streak"]'))).toContain("3");
    expect(text(q(h.root, '[data-testid="waiting-list"]'))).toContain("Citra");
    expect(text(q(h.root, '[data-testid="incoming-list"]'))).toContain("Dewi");
  });

  it("kosong: menampilkan penjelasan", async () => {
    const { h } = await login({}, friendsData({ friends: [], waiting: [], incoming: [] }));
    await openFriends(h);
    expect(text(q(h.root, '[data-testid="friends-empty"]'))).toBe(id.friends.empty);
  });

  it("galat muat: tombol coba lagi", async () => {
    let fail = true;
    const { h } = await login({ "GET /api/friends": () => (fail ? { status: 500, json: { code: "X", message: "Gagal." } } : { json: friendsData() }) });
    await openFriends(h);
    expect(text(h.root)).toContain(id.friends.error);
    fail = false;
    q<HTMLButtonElement>(h.root, '[data-testid="friends-retry"]').click();
    await flush();
    expect(h.root.querySelector('[data-testid="friend"]')).not.toBeNull();
  });
});

describe("cari dan atur hubungan", () => {
  it("cari nama pengguna persis, ikuti, dan simpan kontak memanggil API", async () => {
    const card = { username: "eko", name: "Eko", kelas: "Perunggu", relation: { iFollow: false, followsMe: false, iSaved: false, savedMe: false, friend: false, iBlocked: false } };
    const calls: string[] = [];
    const { h } = await login({
      "GET /api/users?username=eko": () => ({ json: { user: card } }),
      "POST /api/follow": (b) => {
        calls.push(`follow:${String(b.on)}`);
        return { json: { relation: { ...card.relation, iFollow: true } } };
      },
    });
    await openFriends(h);
    q<HTMLInputElement>(h.root, '[data-testid="friend-search"]').value = "@Eko".toLowerCase();
    submit(q<HTMLInputElement>(h.root, '[data-testid="friend-search"]').closest("form") as Element);
    await flush();
    expect(text(q(h.root, '[data-testid="usercard"]'))).toContain("Eko");
    q<HTMLButtonElement>(h.root, '[data-testid="rel-follow"]').click();
    await flush();
    expect(calls).toEqual(["follow:true"]);
    expect(text(q(h.root, '[data-testid="rel-follow"]'))).toBe(id.friends.unfollow);
  });

  it("nama tidak ditemukan dan akun sendiri ditolak di klien", async () => {
    const { h } = await login({ "GET /api/users?username=zzz": () => ({ status: 404, json: { code: "NOT_FOUND", message: "Pengguna tidak ditemukan." } }) });
    await openFriends(h);
    const input = q<HTMLInputElement>(h.root, '[data-testid="friend-search"]');
    input.value = "zzz";
    submit(input.closest("form") as Element);
    await flush();
    expect(text(q(h.root, '[data-testid="search-error"]'))).toBe(id.friends.notFound);
    q<HTMLInputElement>(h.root, '[data-testid="friend-search"]').value = "andi";
    submit(q<HTMLInputElement>(h.root, '[data-testid="friend-search"]').closest("form") as Element);
    await flush();
    expect(text(q(h.root, '[data-testid="search-error"]'))).toBe(id.friends.yourself);
  });

  it("status dan preferensi notifikasi tersimpan lewat API", async () => {
    const seen: string[] = [];
    const { h } = await login({
      "PUT /api/status": (b) => {
        seen.push(`status:${String(b.status)}`);
        return { json: { status: b.status } };
      },
      "PUT /api/notif-prefs": (b) => {
        seen.push(`prefs:${JSON.stringify(b)}`);
        return { json: { prefs: { invite: true, follow: true, streak: true, dm: false } } };
      },
    });
    await openFriends(h);
    q<HTMLButtonElement>(h.root, '[data-status="sibuk"]').click();
    await flush();
    expect(q(h.root, '[data-status="sibuk"]').getAttribute("aria-checked")).toBe("true");
    const cb = q<HTMLInputElement>(h.root, '[data-pref="dm"]');
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));
    await flush();
    expect(seen).toEqual(["status:sibuk", 'prefs:{"dm":false}']);
  });
});

describe("chat 1-1 dan ajakan", () => {
  async function toDm(h: Harness): Promise<void> {
    await openFriends(h);
    q<HTMLButtonElement>(h.root, '[data-testid="friend-chat"]').click();
    await flush();
  }

  it("kirim pesan ke teman lewat WebSocket dan tampil sebagai pesan saya", async () => {
    const { h } = await login();
    h.sock().open();
    await toDm(h);
    const input = q<HTMLInputElement>(h.root, '[data-testid="chat-input"]');
    input.value = "halo budi";
    submit(input.closest("form") as Element);
    expect(h.sock().sent.find((m) => m.type === "dm_send")).toEqual({ type: "dm_send", to: "budi", text: "halo budi" });
    expect(text(q(h.root, '[data-testid="chat-log"]'))).toContain("halo budi");
    expect(q(h.root, ".bub.mine")).toBeTruthy();
  });

  it("pesan masuk dari teman muncul di daftar chat dengan penanda belum dibaca, lalu terbaca saat dibuka", async () => {
    const { h } = await login();
    h.sock().open();
    await flush();
    h.sock().receive({ type: "dm", from: { username: "budi", name: "Budi" }, text: "ayo main", ts: Date.now() });
    expect(h.sound.played).toContain("chat");
    tab(h, "chat");
    const row = q(h.root, '[data-testid="convo"][data-group="@budi"]');
    expect(text(row)).toContain("ayo main");
    expect(text(q(row, '[data-testid="convo-unread"]'))).toBe("1");
    row.click();
    expect(h.root.querySelector('[data-testid="convo-unread"]')).toBeNull();
  });

  it("bukan teman lagi: kolom tulis dikunci dengan pesan", async () => {
    let data = friendsData();
    const { h } = await login({ "GET /api/friends": () => ({ json: data }) });
    h.sock().open();
    await flush();
    h.sock().receive({ type: "dm", from: { username: "budi", name: "Budi" }, text: "hai", ts: Date.now() });
    data = friendsData({ friends: [] });
    await openFriends(h); // memuat ulang: budi bukan teman
    q<HTMLButtonElement>(h.root, '[data-testid="friends-back"]').click();
    q<HTMLButtonElement>(h.root, '[data-testid="convo"]').click();
    expect(text(q(h.root, '[data-testid="dm-locked"]'))).toBe(id.dm.notFriends);
    expect(h.root.querySelector('[data-testid="chat-input"]')).toBeNull();
  });

  it("ajak main tanpa room membuka peringatan; di ruang tunggu mengirim invite_send dengan game room", async () => {
    const { h } = await login();
    h.sock().open();
    await openFriends(h);
    q<HTMLButtonElement>(h.root, '[data-testid="friend-invite"]').click();
    expect(h.sock().types()).not.toContain("invite_send");
    expect(text(q(h.root, ".toast"))).toBe(id.friends.needRoom);
    h.sock().receive(mkState({ phase: "lobby", gameId: "ludo" }));
    tab(h, "chat");
    q<HTMLButtonElement>(h.root, '[data-testid="open-friends"]').click();
    await flush();
    q<HTMLButtonElement>(h.root, '[data-testid="friend-invite"]').click();
    expect(h.sock().sent.find((m) => m.type === "invite_send")).toEqual({ type: "invite_send", to: "budi", game: "ludo" });
  });

  it("ajakan masuk: kartu dengan Gabung/Nanti/Lagi sibuk; Gabung membalas dan membuka room", async () => {
    const { h } = await login();
    h.sock().open();
    await flush();
    h.sock().receive({ type: "invite", id: "0123456789ab", from: { username: "budi", name: "Budi" }, game: "ludo", groupId: "QWERTY", expiresAt: Date.now() + 600_000, silent: false });
    expect(h.sound.played).toContain("nudge");
    tab(h, "chat");
    q<HTMLButtonElement>(h.root, '[data-testid="convo"]').click();
    const card = q(h.root, '[data-testid="invite-card"]');
    expect(text(card)).toContain(id.dm.inviteIn("Budi", id.games.ludo.name));
    q<HTMLButtonElement>(card, '[data-testid="invite-join"]').click();
    expect(h.sock().sent.find((m) => m.type === "invite_reply")).toEqual({ type: "invite_reply", id: "0123456789ab", reply: "join" });
    expect(h.sock().sent.some((m) => m.type === "open_link" && m.groupId === "QWERTY")).toBe(true);
  });

  it("ajakan senyap tanpa bunyi; kedaluwarsa tanpa tombol; jawaban 'sibuk' tercatat", async () => {
    const { h } = await login();
    h.sock().open();
    await flush();
    h.sock().receive({ type: "invite", id: "0123456789ab", from: { username: "budi", name: "Budi" }, game: "gaple", groupId: "QWERTY", expiresAt: Date.now() - 1000, silent: true });
    expect(h.sound.played).not.toContain("nudge");
    tab(h, "chat");
    q<HTMLButtonElement>(h.root, '[data-testid="convo"]').click();
    expect(h.root.querySelector('[data-testid="invite-join"]')).toBeNull();
    expect(text(q(h.root, '[data-testid="invite-status"]'))).toBe(id.dm.expired);
  });

  it("hasil ajakan keluar: terkirim lalu dijawab teman", async () => {
    const { h } = await login();
    h.sock().open();
    await flush();
    h.sock().receive(mkState({ phase: "lobby" }));
    h.sock().receive({ type: "invite_result", id: "0123456789ab", to: { username: "budi", name: "Budi" }, reply: "sent" });
    tab(h, "chat");
    q<HTMLButtonElement>(h.root, '[data-group="@budi"]').click();
    expect(text(q(h.root, '[data-testid="invite-status"]'))).toBe(id.dm.result.sent);
    h.sock().receive({ type: "invite_result", id: "0123456789ab", to: { username: "budi", name: "Budi" }, reply: "busy" });
    expect(text(q(h.root, '[data-testid="invite-status"]'))).toBe(id.dm.result.busy);
  });
});

describe("pemberitahuan", () => {
  it("notice dari server muncul di pusat pemberitahuan dan bisa ditandai dibaca", async () => {
    let read = 0;
    const { h } = await login({ "POST /api/notices/read": () => (read++, { json: { ok: true } }) });
    h.sock().open();
    await openFriends(h);
    h.sock().receive({ type: "notice", id: "n1", kind: "follow", text: "Budi mengikutimu", ts: Date.now() });
    expect(text(q(h.root, '[data-testid="notices"]'))).toContain("Budi mengikutimu");
    q<HTMLButtonElement>(h.root, '[data-testid="notices-read"]').click();
    await flush();
    expect(read).toBe(1);
    expect(h.root.querySelector('[data-testid="notices-read"]')).toBeNull();
  });
});
