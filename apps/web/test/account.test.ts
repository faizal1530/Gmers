import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { id } from "../src/i18n/id";
import { acct, fakeFetch, memoryKV, mkState, mount, q, text } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
});

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};
const tab = (h: ReturnType<typeof mount>, name: string): void => q<HTMLButtonElement>(h.root, `[data-testid="tab-${name}"]`).click();
const fill = (h: ReturnType<typeof mount>, sel: string, v: string): void => void (q<HTMLInputElement>(h.root, sel).value = v);
const submit = (el: Element): void => void el.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
const accountForm = (h: ReturnType<typeof mount>): HTMLFormElement => q<HTMLInputElement>(h.root, "#akun-user").closest("form") as HTMLFormElement;

describe("pendaftaran", () => {
  it("tamu melihat panel akun dengan tab Daftar dan Masuk; kolom kata sandi bertipe password", () => {
    const h = mount("/");
    tab(h, "profile");
    expect(text(q(h.root, '[data-testid="account-panel"]'))).toContain(id.account.guestIntro);
    expect(q<HTMLInputElement>(h.root, "#akun-pass").type).toBe("password");
    expect(q<HTMLInputElement>(h.root, "#akun-pass").getAttribute("autocomplete")).toBe("new-password");
    q<HTMLButtonElement>(h.root, '[data-mode="login"]').click();
    expect(q<HTMLInputElement>(h.root, "#akun-pass").getAttribute("autocomplete")).toBe("current-password");
    expect(text(q(h.root, '[data-testid="account-submit"]'))).toBe(id.account.login);
  });

  it("daftar berhasil: mengirim token perangkat dan nama, menyimpan sesi, tampil 'Masuk sebagai', tanpa muat ulang bila identitas sama", async () => {
    const kv = memoryKV({ "gmers.name": "Andi" });
    const f = fakeFetch({ "POST /api/register": (b) => ({ json: { session: "sesi-andi", account: acct({ token: b.token }) } }) });
    const h = mount("/", kv, { fetch: f.fn });
    tab(h, "profile");
    fill(h, "#akun-user", "andi");
    fill(h, "#akun-pass", "rahasia123");
    submit(accountForm(h));
    await flush();
    expect(f.calls[0]).toMatchObject({ route: "POST /api/register", body: { username: "andi", password: "rahasia123", name: "Andi" } });
    expect(String(f.calls[0]!.body.token)).toMatch(/^[0-9a-f]{32}$/);
    expect(kv.data.get("gmers.session")).toBe("sesi-andi");
    expect(text(q(h.root, '[data-testid="account-user"]'))).toBe(id.account.loggedAs("andi"));
    expect(text(q(h.root, ".toast"))).toBe(id.account.created);
    expect(h.reloads.n).toBe(0);
  });

  it("galat server ditampilkan di formulir (nama pengguna dipakai) dan tombol aktif lagi", async () => {
    const f = fakeFetch({ "POST /api/register": () => ({ status: 409, json: { code: "USERNAME_TAKEN", message: "Nama pengguna itu sudah dipakai." } }) });
    const h = mount("/", memoryKV(), { fetch: f.fn });
    tab(h, "profile");
    fill(h, "#akun-user", "andi");
    fill(h, "#akun-pass", "rahasia123");
    submit(accountForm(h));
    expect(q<HTMLButtonElement>(h.root, '[data-testid="account-submit"]').disabled).toBe(true);
    await flush();
    expect(text(accountForm(h).querySelector(".hint.bad") as Element)).toBe("Nama pengguna itu sudah dipakai.");
    expect(q<HTMLButtonElement>(h.root, '[data-testid="account-submit"]').disabled).toBe(false);
    expect(h.root.querySelector('[data-testid="account-user"]')).toBeNull();
  });

  it("jaringan putus saat mendaftar: pesan ramah, bukan galat mentah", async () => {
    const f = fakeFetch({ "POST /api/register": () => ({ fail: true }) });
    const h = mount("/", memoryKV(), { fetch: f.fn });
    tab(h, "profile");
    fill(h, "#akun-user", "andi");
    fill(h, "#akun-pass", "rahasia123");
    submit(accountForm(h));
    await flush();
    expect(text(accountForm(h).querySelector(".hint.bad") as Element)).toBe(id.account.network);
  });

  it("identitas room berganti (token sudah terikat akun lain) dan sedang terhubung: halaman dimuat ulang", async () => {
    const f = fakeFetch({ "POST /api/register": () => ({ json: { session: "s1", account: acct({ token: "token-baru-dari-server-0001" }) } }) });
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }), { fetch: f.fn });
    h.sock().open();
    h.sock().receive(mkState({ phase: "lobby", groupId: "KODE23" }));
    tab(h, "profile");
    fill(h, "#akun-user", "andi");
    fill(h, "#akun-pass", "rahasia123");
    submit(accountForm(h));
    await flush();
    expect(h.reloads.n).toBe(1);
  });
});

describe("masuk dan data yang dipertahankan", () => {
  it("masuk menerapkan nama, tema, suara, dan daftar room dari server; daftar room muncul di Chat", async () => {
    const kv = memoryKV();
    const f = fakeFetch({
      "POST /api/login": () => ({
        json: { session: "sesi-andi", account: acct({ prefs: { theme: "dark", sound: false }, groups: [{ groupId: "ROOM11", ts: Date.now() - 1000 }, { groupId: "ROOM22", ts: Date.now() - 5000 }] }) },
      }),
    });
    const h = mount("/", kv, { fetch: f.fn });
    tab(h, "profile");
    q<HTMLButtonElement>(h.root, '[data-mode="login"]').click();
    fill(h, "#akun-user", "andi");
    fill(h, "#akun-pass", "rahasia123");
    submit(accountForm(h));
    await flush();
    expect(kv.data.get("gmers.name")).toBe("Andi");
    expect(kv.data.get("gmers.token")).toBe("token-akun-andi-0000000001");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(h.sound.enabled).toBe(false);
    tab(h, "chat");
    const rows = [...h.root.querySelectorAll('[data-testid="convo"]')].map((r) => r.getAttribute("data-group"));
    expect(rows).toEqual(["ROOM11", "ROOM22"]);
    expect(h.root.querySelector('[data-testid="signup-banner"]')).toBeNull(); // sudah punya akun
  });

  it("kata sandi salah: pesan dari server, tetap tamu", async () => {
    const f = fakeFetch({ "POST /api/login": () => ({ status: 401, json: { code: "BAD_CREDENTIALS", message: "Nama pengguna atau kata sandi salah." } }) });
    const kv = memoryKV();
    const h = mount("/", kv, { fetch: f.fn });
    tab(h, "profile");
    q<HTMLButtonElement>(h.root, '[data-mode="login"]').click();
    fill(h, "#akun-user", "andi");
    fill(h, "#akun-pass", "salah-salah");
    submit(accountForm(h));
    await flush();
    expect(text(accountForm(h).querySelector(".hint.bad") as Element)).toBe("Nama pengguna atau kata sandi salah.");
    expect(kv.data.get("gmers.session") ?? "").toBe("");
  });

  it("masuk dari perangkat lain dengan identitas berbeda dan sedang terhubung: dimuat ulang agar kursi akun dipakai", async () => {
    const f = fakeFetch({ "POST /api/login": () => ({ json: { session: "s", account: acct() } }) });
    const h = mount("/g/KODE23", memoryKV(), { fetch: f.fn });
    h.sock().open();
    h.sock().receive(mkState({ phase: "lobby", groupId: "KODE23" }));
    tab(h, "profile");
    q<HTMLButtonElement>(h.root, '[data-mode="login"]').click();
    fill(h, "#akun-user", "andi");
    fill(h, "#akun-pass", "rahasia123");
    submit(accountForm(h));
    await flush();
    expect(h.reloads.n).toBe(1);
  });
});

describe("tetap masuk sampai memilih keluar (seperti WhatsApp)", () => {
  const withSession = () => memoryKV({ "gmers.session": "sesi-andi", "gmers.account": JSON.stringify({ username: "andi", name: "Andi" }), "gmers.token": "token-akun-andi-0000000001", "gmers.name": "Andi" });

  it("membuka aplikasi dengan sesi tersimpan: memeriksa server dengan Bearer, langsung dikenali tanpa formulir masuk", async () => {
    const f = fakeFetch({ "GET /api/me": () => ({ json: { account: acct({ prefs: { theme: "light" } }) } }) });
    const h = mount("/", withSession(), { fetch: f.fn });
    await flush();
    expect(f.calls[0]).toMatchObject({ route: "GET /api/me", headers: { authorization: "Bearer sesi-andi" } });
    tab(h, "profile");
    expect(text(q(h.root, '[data-testid="account-user"]'))).toBe(id.account.loggedAs("andi"));
    expect(h.root.querySelector("#akun-user")).toBeNull();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("sesi di tautan room: koneksi room baru dibuka setelah akun dipulihkan, memakai identitas akun", async () => {
    const f = fakeFetch({ "GET /api/me": () => ({ json: { account: acct() } }) });
    const h = mount("/g/KODE23", withSession(), { fetch: f.fn });
    await flush();
    h.sock().open();
    expect(h.sock().sent[0]).toMatchObject({ type: "open_link", groupId: "KODE23", token: "token-akun-andi-0000000001" });
  });

  it("server tidak terjangkau (jaringan putus atau 5xx): tetap dianggap masuk, sesi TIDAK dihapus", async () => {
    for (const res of [{ fail: true }, { status: 503, json: { code: "X", message: "x" } }]) {
      const kv = withSession();
      const f = fakeFetch({ "GET /api/me": () => res });
      const h = mount("/", kv, { fetch: f.fn });
      await flush();
      tab(h, "profile");
      expect(text(q(h.root, '[data-testid="account-user"]'))).toBe(id.account.loggedAs("andi"));
      expect(kv.data.get("gmers.session")).toBe("sesi-andi");
    }
  });

  it("hanya bila server menyatakan sesi dicabut (401) pengguna menjadi tamu", async () => {
    const kv = withSession();
    const f = fakeFetch({ "GET /api/me": () => ({ status: 401, json: { code: "UNAUTHORIZED", message: "Silakan masuk lagi." } }) });
    const h = mount("/", kv, { fetch: f.fn });
    await flush();
    tab(h, "profile");
    expect(h.root.querySelector("#akun-user")).not.toBeNull();
    expect(kv.data.get("gmers.session")).toBe("");
  });

  it("tidak ada kedaluwarsa di klien: sesi tetap dipakai berbulan-bulan kemudian", async () => {
    const f = fakeFetch({ "GET /api/me": () => ({ json: { account: acct() } }) });
    const kv = withSession();
    mount("/", kv, { fetch: f.fn });
    vi.setSystemTime(Date.now() + 400 * 86_400_000);
    const f2 = fakeFetch({ "GET /api/me": () => ({ json: { account: acct() } }) });
    mount("/", kv, { fetch: f2.fn });
    await flush();
    expect(f2.calls[0]!.headers.authorization).toBe("Bearer sesi-andi");
  });

  it("keluar: harus dikonfirmasi; lalu sesi, riwayat chat lokal, dan identitas dibersihkan dan halaman dimuat ulang", async () => {
    const kv = withSession();
    kv.data.set("gmers.chats.v1", JSON.stringify([{ groupId: "ROOM11", me: -1, members: [], lastTs: 1, unread: 0, msgs: [] }]));
    const f = fakeFetch({ "GET /api/me": () => ({ json: { account: acct() } }), "POST /api/logout": () => ({ json: { ok: true } }) });
    const h = mount("/", kv, { fetch: f.fn });
    await flush();
    tab(h, "profile");
    q<HTMLButtonElement>(h.root, '[data-testid="logout"]').click();
    expect(f.calls.some((c) => c.route === "POST /api/logout")).toBe(false); // belum, menunggu konfirmasi
    q<HTMLButtonElement>(h.root, '[data-testid="logout-yes"]').click();
    await flush();
    expect(f.calls.some((c) => c.route === "POST /api/logout" && c.headers.authorization === "Bearer sesi-andi")).toBe(true);
    expect(kv.data.get("gmers.session")).toBe("");
    expect(kv.data.get("gmers.token")).not.toBe("token-akun-andi-0000000001");
    expect(JSON.parse(kv.data.get("gmers.chats.v1") ?? "[]")).toEqual([]);
    expect(h.reloads.n).toBe(1);
  });
});

describe("kelola akun", () => {
  const withSession = () => memoryKV({ "gmers.session": "sesi-andi", "gmers.account": JSON.stringify({ username: "andi", name: "Andi" }), "gmers.token": "token-akun-andi-0000000001", "gmers.name": "Andi" });
  async function logged(routes: Parameters<typeof fakeFetch>[0] = {}) {
    const f = fakeFetch({ "GET /api/me": () => ({ json: { account: acct() } }), ...routes });
    const h = mount("/", withSession(), { fetch: f.fn });
    await flush();
    tab(h, "profile");
    return { h, f };
  }

  it("ubah kata sandi: cek panjang di klien, galat server, lalu berhasil", async () => {
    const { h, f } = await logged({
      "POST /api/me/password": (b) => (b.oldPassword === "benar-lama" ? { json: { ok: true } } : { status: 401, json: { code: "BAD_CREDENTIALS", message: "Kata sandi lama salah." } }),
    });
    const form = q<HTMLInputElement>(h.root, "#pw-lama").closest("form") as HTMLFormElement;
    fill(h, "#pw-lama", "benar-lama");
    fill(h, "#pw-baru", "pendek");
    submit(form);
    await flush();
    expect(text(form.querySelector(".hint.bad") as Element)).toBe(id.account.pwShort);
    expect(f.calls.some((c) => c.route === "POST /api/me/password")).toBe(false);
    fill(h, "#pw-lama", "salah-lama");
    fill(h, "#pw-baru", "kata-baru-123");
    submit(form);
    await flush();
    expect(text(form.querySelector(".hint.bad") as Element)).toBe("Kata sandi lama salah.");
    fill(h, "#pw-lama", "benar-lama");
    submit(form);
    await flush();
    expect(text(form.querySelector(".hint") as Element)).not.toBe("");
    expect(f.calls.at(-1)).toMatchObject({ route: "POST /api/me/password", body: { oldPassword: "benar-lama", newPassword: "kata-baru-123" } });
    expect(q<HTMLInputElement>(h.root, "#pw-baru").value).toBe("");
  });

  it("hapus akun: kata sandi salah ditolak; benar menghapus, membersihkan perangkat, memuat ulang", async () => {
    const { h, f } = await logged({
      "DELETE /api/me": (b) => (b.password === "benar" ? { json: { ok: true } } : { status: 401, json: { code: "BAD_CREDENTIALS", message: "Kata sandi salah." } }),
    });
    const form = q<HTMLInputElement>(h.root, "#pw-hapus").closest("form") as HTMLFormElement;
    fill(h, "#pw-hapus", "salah");
    submit(form);
    await flush();
    expect(text(form.querySelector(".hint.bad") as Element)).toBe("Kata sandi salah.");
    expect(h.reloads.n).toBe(0);
    fill(h, "#pw-hapus", "benar");
    submit(form);
    await flush();
    expect(f.calls.at(-1)).toMatchObject({ route: "DELETE /api/me", body: { password: "benar" } });
    expect(h.kv.data.get("gmers.session")).toBe("");
    expect(h.reloads.n).toBe(1);
  });

  it("tema, suara, dan nama disinkronkan ke server saat masuk", async () => {
    const { h, f } = await logged({ "PUT /api/me": () => ({ json: { account: acct() } }) });
    q<HTMLButtonElement>(h.root, '[data-theme-mode="dark"]').click();
    q<HTMLButtonElement>(h.root, '[data-sound="off"]').click();
    const nameForm = q<HTMLInputElement>(h.root, "input#nama").closest("form") as HTMLFormElement;
    fill(h, "input#nama", "Andi Baru");
    submit(nameForm);
    await flush();
    const puts = f.calls.filter((c) => c.route === "PUT /api/me").map((c) => c.body);
    expect(puts).toEqual([{ prefs: { theme: "dark" } }, { prefs: { sound: false } }, { name: "Andi Baru" }]);
  });

  it("tamu tidak memanggil server saat mengubah tema, suara, atau nama", async () => {
    const f = fakeFetch({});
    const h = mount("/", memoryKV({ "gmers.name": "Andi" }), { fetch: f.fn });
    tab(h, "profile");
    q<HTMLButtonElement>(h.root, '[data-theme-mode="dark"]').click();
    q<HTMLButtonElement>(h.root, '[data-sound="off"]').click();
    await flush();
    expect(f.calls).toEqual([]);
  });
});

describe("ajakan mendaftar di Chat", () => {
  it("tamu yang sudah punya percakapan melihat spanduk Daftar; tombolnya membuka Profil", () => {
    const h = mount("/g/KODE23", memoryKV({ "gmers.name": "Andi" }));
    h.sock().open();
    h.sock().receive(mkState({ phase: "lobby", groupId: "KODE23" }));
    tab(h, "chat");
    expect(text(q(h.root, '[data-testid="signup-banner"]'))).toContain(id.account.bannerText);
    q<HTMLButtonElement>(h.root, '[data-testid="signup-banner"] button').click();
    expect(q(h.root, '[data-testid="tab-profile"]').getAttribute("aria-current")).toBe("page");
  });

  it("tanpa percakapan tidak ada spanduk", () => {
    const h = mount("/");
    tab(h, "chat");
    expect(h.root.querySelector('[data-testid="signup-banner"]')).toBeNull();
  });
});
