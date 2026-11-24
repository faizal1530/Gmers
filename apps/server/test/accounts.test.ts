import { describe, expect, it } from "vitest";
import { AccountService, MemoryAccountLog, isAuthError, type AuthError, type AuthResult } from "../src/accounts";
import { RoomService, hashToken } from "../src/service";
import { MemoryRoomLog } from "../src/store";
import { FakeClock, FakeConn, testConfig, tok } from "./support";

const DAY = 86_400_000;

function make(over: Parameters<typeof testConfig>[0] = {}) {
  const clock = new FakeClock();
  const log = new MemoryAccountLog();
  const cfg = testConfig(over);
  const svc = new AccountService(cfg, log, clock);
  return { svc, clock, log, cfg, reopen: () => new AccountService(cfg, log, clock) };
}

const ok = <T>(r: T): Exclude<T, AuthError> => {
  if (isAuthError(r)) throw new Error(`galat: ${r.code}`);
  return r as Exclude<T, AuthError>;
};

async function reg(svc: AccountService, username = "andi", password = "rahasia123", token = tok(1), name = "Andi"): Promise<AuthResult> {
  return ok(await svc.register({ username, password, name, token })) as AuthResult;
}

describe("pendaftaran", () => {
  it("membuat akun, mengembalikan sesi, dan memakai token perangkat tamu sebagai identitas room", async () => {
    const { svc } = make();
    const r = await reg(svc);
    expect(r.session).toMatch(/^[0-9a-f]{64}$/);
    expect(r.account).toMatchObject({ username: "andi", name: "Andi", token: tok(1), prefs: {}, groups: [] });
    expect(svc.me(r.session)?.username).toBe("andi");
    expect(svc.count).toBe(1);
  });

  it("nama pengguna unik tanpa membedakan huruf besar/kecil", async () => {
    const { svc } = make();
    await reg(svc, "Andi");
    const dup = await svc.register({ username: "ANDI", password: "rahasia123", name: "X Y", token: tok(2) });
    expect(dup).toMatchObject({ status: 409, code: "USERNAME_TAKEN" });
  });

  it("token yang sudah terikat akun lain diganti token baru (dua akun tidak berbagi identitas room)", async () => {
    const { svc } = make();
    const a = await reg(svc, "andi", "rahasia123", tok(1));
    const b = await reg(svc, "budi", "rahasia123", tok(1), "Budi");
    expect(a.account.token).toBe(tok(1));
    expect(b.account.token).not.toBe(tok(1));
    expect(b.account.token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("kata sandi tidak pernah tersimpan polos di log", async () => {
    const { svc, log } = make();
    await reg(svc, "andi", "kata-sandi-unik-98765");
    expect(JSON.stringify(log.readAll())).not.toContain("kata-sandi-unik-98765");
  });

  it("pendaftaran dibatasi per menit (tanpa membaca IP)", async () => {
    const { svc, clock } = make({ registerBurst: 3 });
    for (let i = 0; i < 3; i++) await reg(svc, `user${i}`, "rahasia123", tok(10 + i));
    expect(await svc.register({ username: "user9", password: "rahasia123", name: "Sembilan", token: tok(99) })).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    clock.advance(61_000);
    expect(isAuthError(await svc.register({ username: "user9", password: "rahasia123", name: "Sembilan", token: tok(99) }))).toBe(false);
  });
});

describe("masuk", () => {
  it("berhasil dengan kata sandi benar (nama pengguna tak membedakan huruf besar/kecil); salah memberi pesan yang sama untuk akun yang tak ada", async () => {
    const { svc } = make();
    await reg(svc);
    const good = ok(await svc.login({ username: "ANDI", password: "rahasia123" }));
    expect(good.account.token).toBe(tok(1));
    const wrong = await svc.login({ username: "andi", password: "salah-salah" });
    const none = await svc.login({ username: "tidak-ada", password: "salah-salah" });
    expect(wrong).toMatchObject({ status: 401, code: "BAD_CREDENTIALS" });
    expect(none).toEqual(wrong);
  });

  it("dikunci setelah 5 percobaan gagal; terbuka setelah jeda; berhasil mereset hitungan", async () => {
    const { svc, clock } = make({ loginMaxFails: 5, loginLockMs: 600_000 });
    await reg(svc);
    for (let i = 0; i < 4; i++) await svc.login({ username: "andi", password: "salah" });
    expect(isAuthError(await svc.login({ username: "andi", password: "rahasia123" }))).toBe(false); // masih boleh, hitungan direset
    for (let i = 0; i < 5; i++) await svc.login({ username: "andi", password: "salah" });
    expect(await svc.login({ username: "andi", password: "rahasia123" })).toMatchObject({ status: 429, code: "LOCKED" });
    clock.advance(601_000);
    expect(isAuthError(await svc.login({ username: "andi", password: "rahasia123" }))).toBe(false);
  });
});

describe("sesi permanen seperti WhatsApp", () => {
  it("tidak pernah kedaluwarsa sendiri: tetap sah setelah bertahun-tahun, dan setelah server dimulai ulang dari log", async () => {
    const { svc, clock, reopen } = make();
    const r = await reg(svc);
    clock.advance(5 * 365 * DAY);
    expect(svc.me(r.session)?.username).toBe("andi");
    const again = reopen();
    expect(again.me(r.session)?.username).toBe("andi");
  });

  it("hanya berakhir saat keluar (dan itu bertahan setelah restart); sesi perangkat lain tidak ikut", async () => {
    const { svc, reopen } = make();
    const a = await reg(svc);
    const b = ok(await svc.login({ username: "andi", password: "rahasia123" }));
    svc.logout(a.session);
    expect(svc.me(a.session)).toBeNull();
    expect(svc.me(b.session)).not.toBeNull();
    const again = reopen();
    expect(again.me(a.session)).toBeNull();
    expect(again.me(b.session)).not.toBeNull();
  });

  it("masa berlaku opsional lewat konfigurasi (sessionTtlMs)", async () => {
    const { svc, clock } = make({ sessionTtlMs: 10 * DAY });
    const r = await reg(svc);
    clock.advance(9 * DAY);
    expect(svc.me(r.session)).not.toBeNull();
    clock.advance(2 * DAY);
    expect(svc.me(r.session)).toBeNull();
  });

  it("sesi tidak dikenal atau kosong ditolak", () => {
    const { svc } = make();
    expect(svc.me(null)).toBeNull();
    expect(svc.me("bukan-sesi")).toBeNull();
  });
});

describe("profil, kata sandi, hapus akun", () => {
  it("profil dan pengaturan tersimpan dan pulih setelah restart", async () => {
    const { svc, reopen } = make();
    const r = await reg(svc);
    ok(svc.updateProfile(r.session, { name: "Andi Baru", prefs: { theme: "dark" } }));
    ok(svc.updateProfile(r.session, { prefs: { sound: false } }));
    const me = reopen().me(r.session);
    expect(me).toMatchObject({ name: "Andi Baru", prefs: { theme: "dark", sound: false } });
    expect(svc.updateProfile("sesi-palsu", { name: "Xx" })).toMatchObject({ status: 401 });
  });

  it("ganti kata sandi: lama harus benar; kata sandi baru berlaku; sesi lain dicabut, sesi ini tetap", async () => {
    const { svc, reopen } = make();
    const a = await reg(svc);
    const b = ok(await svc.login({ username: "andi", password: "rahasia123" }));
    expect(await svc.changePassword(a.session, "salah-lama", "kata-baru-123")).toMatchObject({ status: 401 });
    ok(await svc.changePassword(a.session, "rahasia123", "kata-baru-123"));
    expect(svc.me(a.session)).not.toBeNull();
    expect(svc.me(b.session)).toBeNull();
    const again = reopen();
    expect(isAuthError(await again.login({ username: "andi", password: "rahasia123" }))).toBe(true);
    expect(isAuthError(await again.login({ username: "andi", password: "kata-baru-123" }))).toBe(false);
  });

  it("hapus akun butuh kata sandi; setelah itu akun hilang, nama pengguna bebas lagi, dan tetap hilang setelah restart", async () => {
    const { svc, reopen } = make();
    const r = await reg(svc);
    expect(await svc.deleteAccount(r.session, "salah")).toMatchObject({ status: 401 });
    expect(svc.count).toBe(1);
    ok(await svc.deleteAccount(r.session, "rahasia123"));
    expect(svc.me(r.session)).toBeNull();
    const again = reopen();
    expect(again.count).toBe(0);
    expect(isAuthError(await again.login({ username: "andi", password: "rahasia123" }))).toBe(true);
    expect(isAuthError(await again.register({ username: "andi", password: "rahasia123", name: "Andi", token: tok(5) }))).toBe(false);
  });

  it("reset oleh admin: kata sandi baru, semua sesi dicabut, kunci dibuka", async () => {
    const { svc } = make({ loginMaxFails: 2 });
    const r = await reg(svc);
    await svc.login({ username: "andi", password: "x" });
    await svc.login({ username: "andi", password: "x" });
    ok(await svc.adminReset("ANDI", "kata-admin-123"));
    expect(svc.me(r.session)).toBeNull();
    expect(isAuthError(await svc.login({ username: "andi", password: "kata-admin-123" }))).toBe(false);
    expect(await svc.adminReset("tidak-ada", "kata-admin-123")).toMatchObject({ status: 404 });
  });
});

describe("daftar room akun (data yang dipertahankan di server)", () => {
  it("noteGroup mengingat room per akun: terbaru di atas, tanpa duplikat, maksimal 50, dan pulih setelah restart", async () => {
    const { svc, clock, reopen } = make();
    const r = await reg(svc);
    const h = hashToken(tok(1), svc.constructor === AccountService ? testConfig().hashSalt : "");
    svc.noteGroup(h, "AAA111");
    clock.advance(1000);
    svc.noteGroup(h, "BBB222");
    clock.advance(1000);
    svc.noteGroup(h, "AAA111");
    svc.noteGroup(hashToken("perangkat-lain-yang-tak-terdaftar", testConfig().hashSalt), "ZZZ999");
    expect(svc.me(r.session)?.groups.map((g) => g.groupId)).toEqual(["AAA111", "BBB222"]);
    for (let i = 0; i < 60; i++) {
      clock.advance(10);
      svc.noteGroup(h, `G${String(i).padStart(5, "0")}`);
    }
    expect(svc.me(r.session)?.groups).toHaveLength(50);
    expect(reopen().me(r.session)?.groups).toHaveLength(50);
  });

  it("tamu yang sudah duduk di sebuah room lalu mendaftar: room itu ikut tercatat di akunnya", async () => {
    const clock = new FakeClock();
    const cfg = testConfig();
    const rooms = new RoomService(cfg, { clock, log: new MemoryRoomLog(), newSeed: () => "s" });
    rooms.start();
    const accounts = new AccountService(cfg, new MemoryAccountLog(), clock, (h) => rooms.groupsOf(h));
    const phone = new FakeConn();
    rooms.handle(phone, { type: "create_room", name: "Andi", token: tok(1) });
    const groupId = phone.state().room.groupId;
    const r = ok(await accounts.register({ username: "andi", password: "rahasia123", name: "Andi", token: tok(1) }));
    expect(r.account.groups.map((g) => g.groupId)).toEqual([groupId]);
  });

  it("terhubung ke layanan room: duduk di kelompok mencatatnya, dan akun yang sama di perangkat lain mendapat kursi yang sama", async () => {
    const clock = new FakeClock();
    const cfg = testConfig();
    const accounts = new AccountService(cfg, new MemoryAccountLog(), clock);
    const rooms = new RoomService(cfg, { clock, log: new MemoryRoomLog(), onSeat: (h, g) => accounts.noteGroup(h, g), newSeed: () => "s" });
    rooms.start();
    const reg1 = ok(await accounts.register({ username: "andi", password: "rahasia123", name: "Andi", token: tok(1) }));

    const phone = new FakeConn();
    rooms.handle(phone, { type: "create_room", name: "Andi", token: reg1.account.token });
    const groupId = phone.state().room.groupId;
    expect(accounts.me(reg1.session)?.groups.map((g) => g.groupId)).toEqual([groupId]);

    // masuk dari perangkat lain: token akun yang sama => kursi yang sama (sambung ulang), bukan pemain baru
    const login = ok(await accounts.login({ username: "andi", password: "rahasia123" }));
    const laptop = new FakeConn();
    rooms.handle(laptop, { type: "join", groupId, name: "Andi", token: login.account.token });
    expect(laptop.state().you.seat).toBe(0);
    expect(laptop.state().room.seats.filter(Boolean)).toHaveLength(1);
  });
});
