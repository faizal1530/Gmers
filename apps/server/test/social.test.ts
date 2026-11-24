import { describe, expect, it } from "vitest";
import { MemorySocialLog, Social, streakDay } from "../src/social";
import { FakeClock } from "./support";

const at = (date: string, hhmm: string): number => Date.parse(`${date}T${hhmm}:00+07:00`);

function make(start = at("2026-11-23", "10:00")) {
  const clock = new FakeClock();
  clock.t = start;
  const log = new MemorySocialLog();
  const social = new Social(log, clock);
  return { social, clock, log, reopen: () => new Social(log, clock) };
}

describe("pertemanan (spek 6)", () => {
  it("saling mengikuti = teman; satu arah bukan teman; berhenti mengikuti memutus", () => {
    const { social: s } = make();
    s.follow("a", "b", true);
    expect(s.areFriends("a", "b")).toBe(false);
    s.follow("b", "a", true);
    expect(s.areFriends("a", "b")).toBe(true);
    expect(s.areFriends("b", "a")).toBe(true);
    s.follow("a", "b", false);
    expect(s.areFriends("a", "b")).toBe(false);
  });

  it("saling menyimpan kontak = teman; campuran ikuti dan simpan kontak dua arah tidak cukup; dihitung ulang tiap perubahan", () => {
    const { social: s } = make();
    s.saveContact("a", "b", true);
    s.follow("b", "a", true);
    expect(s.areFriends("a", "b")).toBe(false); // a menyimpan kontak b, b mengikuti a: tidak saling
    s.saveContact("b", "a", true);
    expect(s.areFriends("a", "b")).toBe(true);
    s.follow("a", "b", true);
    s.follow("b", "a", true);
    s.saveContact("a", "b", false); // masih teman lewat saling ikuti
    expect(s.areFriends("a", "b")).toBe(true);
    s.follow("a", "b", false);
    expect(s.areFriends("a", "b")).toBe(false); // tidak ada syarat yang terpenuhi
  });

  it("tidak bisa berteman dengan diri sendiri", () => {
    const { social: s } = make();
    expect(s.follow("a", "a", true)).toBe(false);
    expect(s.areFriends("a", "a")).toBe(false);
  });

  it("blokir memutus pertemanan dan semua kontak di kedua arah, mencegah ikuti ulang, dan membuka blokir tidak memulihkan", () => {
    const { social: s } = make();
    s.follow("a", "b", true);
    s.follow("b", "a", true);
    s.saveContact("a", "b", true);
    s.block("a", "b", true);
    expect(s.areFriends("a", "b")).toBe(false);
    expect(s.relation("a", "b")).toMatchObject({ iFollow: false, followsMe: false, iSaved: false, savedMe: false, iBlocked: true });
    expect(s.follow("b", "a", true)).toBe(false); // diblokir tidak bisa mengikuti
    expect(s.follow("a", "b", true)).toBe(false); // pemblokir pun tidak sampai membuka blokir
    expect(s.isBlocked("b", "a")).toBe(true);
    s.block("a", "b", false);
    expect(s.areFriends("a", "b")).toBe(false);
    expect(s.follow("a", "b", true)).toBe(true);
  });

  it("daftar hubungan: teman, menunggu saling, masuk (belum dibalas), diblokir", () => {
    const { social: s } = make();
    s.follow("me", "teman", true);
    s.follow("teman", "me", true);
    s.follow("me", "tunggu", true); // saya mengikuti, belum dibalas
    s.follow("masuk", "me", true); // dia mengikuti saya
    s.saveContact("kontak", "me", true);
    s.block("me", "musuh", true);
    s.follow("lain", "lain2", true);
    const r = s.related("me");
    expect(r.friends).toEqual(["teman"]);
    expect(r.waiting).toEqual(["tunggu"]);
    expect(r.incoming.sort()).toEqual(["kontak", "masuk"]);
    expect(r.blocked).toEqual(["musuh"]);
    // yang memblokir saya tidak tampil sama sekali
    s.block("x", "me", true);
    expect([...r.friends, ...s.related("me").waiting, ...s.related("me").incoming]).not.toContain("x");
  });

  it("laporan tersimpan (dipotong 300 karakter) dan status serta preferensi notifikasi bertahan setelah restart", () => {
    const { social: s, reopen } = make();
    const rep = s.report("a", "user", "b", "x".repeat(500));
    expect(rep.reason).toHaveLength(300);
    expect(s.reports).toHaveLength(1);
    expect(s.status("a")).toBe("siap");
    s.setStatus("a", "dnd");
    s.setPrefs("a", { streak: false });
    s.follow("a", "b", true);
    const again = reopen();
    expect(again.status("a")).toBe("dnd");
    expect(again.prefsOf("a")).toEqual({ invite: true, follow: true, streak: false, dm: true });
    expect(again.reports).toHaveLength(1);
    expect(again.relation("a", "b").iFollow).toBe(true);
  });

  it("purge menghapus semua hubungan sebuah akun", () => {
    const { social: s } = make();
    s.follow("a", "b", true);
    s.follow("b", "a", true);
    s.purge("a");
    expect(s.areFriends("a", "b")).toBe(false);
    expect(s.related("b").friends).toEqual([]);
  });
});

describe("streak (spek 8)", () => {
  function friends(s: Social): void {
    s.follow("a", "b", true);
    s.follow("b", "a", true);
  }
  const play = (s: Social, date: string, hhmm = "20:00"): void => s.recordGame(["a", "b"], at(date, hhmm));

  it("hari streak 03.00 sampai 03.00 WIB", () => {
    expect(streakDay(at("2026-11-24", "02:59"))).toBe(streakDay(at("2026-11-23", "12:00")));
    expect(streakDay(at("2026-11-24", "03:00"))).toBe(streakDay(at("2026-11-23", "12:00")) + 1);
  });

  it("hanya antar teman; hanya pasangan yang berteman di antara peserta game; satu hari dihitung sekali", () => {
    const { social: s } = make();
    s.recordGame(["a", "b"], at("2026-11-23", "20:00")); // belum berteman
    expect(s.streak("a", "b", at("2026-11-23", "21:00")).count).toBe(0);
    friends(s);
    s.follow("a", "c", true);
    s.follow("c", "a", true); // a-c teman, b-c bukan
    s.recordGame(["a", "b", "c"], at("2026-11-23", "20:00"));
    s.recordGame(["a", "b", "c"], at("2026-11-23", "21:00")); // rematch hari yang sama
    expect(s.streak("a", "b", at("2026-11-23", "22:00"))).toMatchObject({ count: 1, doneToday: true });
    expect(s.streak("a", "c", at("2026-11-23", "22:00")).count).toBe(1);
    expect(s.streak("b", "c", at("2026-11-23", "22:00")).count).toBe(0);
  });

  it("hari berturut-turut menambah hitungan; hari ini yang belum dimainkan belum memutus", () => {
    const { social: s } = make();
    friends(s);
    play(s, "2026-11-23");
    play(s, "2026-11-24");
    play(s, "2026-11-25");
    expect(s.streak("a", "b", at("2026-11-25", "22:00"))).toMatchObject({ count: 3, doneToday: true });
    const morning = s.streak("a", "b", at("2026-11-26", "09:00"));
    expect(morning).toMatchObject({ count: 3, doneToday: false });
  });

  it("game lewat tengah malam tetap dihitung untuk hari streak yang sama sampai 03.00", () => {
    const { social: s } = make();
    friends(s);
    play(s, "2026-11-23", "23:30");
    play(s, "2026-11-24", "01:30"); // hari streak yang sama (belum 03.00)
    expect(s.streak("a", "b", at("2026-11-24", "02:00")).count).toBe(1);
    play(s, "2026-11-24", "03:30"); // hari streak berikutnya
    expect(s.streak("a", "b", at("2026-11-24", "04:00")).count).toBe(2);
  });

  it("pembeku mingguan menutup satu hari yang terlewat; dua hari terlewat tanpa pembeku memutus; pembeku baru tiap Senin", () => {
    const { social: s } = make();
    friends(s);
    // Senin 23 Nov, Selasa 24, (Rabu 25 terlewat), Kamis 26
    play(s, "2026-11-23");
    play(s, "2026-11-24");
    play(s, "2026-11-26");
    expect(s.streak("a", "b", at("2026-11-26", "22:00"))).toMatchObject({ count: 3, freezes: 0 }); // Rabu ditutup pembeku
    // Jumat 27 dan Sabtu 28 terlewat: pembeku habis, putus
    expect(s.streak("a", "b", at("2026-11-29", "10:00")).count).toBe(0);
    // Senin 30 Nov mendapat pembeku baru, dan main lagi memulai dari 1
    play(s, "2026-11-30");
    expect(s.streak("a", "b", at("2026-11-30", "22:00"))).toMatchObject({ count: 1, doneToday: true });
  });

  it("tabung pembeku maksimal 2", () => {
    const { social: s } = make();
    friends(s);
    play(s, "2026-11-23");
    for (const d of ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08"]) play(s, d);
    const info = s.streak("a", "b", at("2026-12-08", "22:00"));
    expect(info.count).toBe(16);
    expect(info.freezes).toBeLessThanOrEqual(2);
    expect(info.freezes).toBe(2); // tiga Senin berlalu tanpa dipakai, tabung penuh di 2
  });

  it("streak dan teman pulih setelah restart dari log", () => {
    const { social: s, reopen } = make();
    friends(s);
    play(s, "2026-11-23");
    play(s, "2026-11-24");
    expect(reopen().streak("a", "b", at("2026-11-24", "22:00")).count).toBe(2);
  });
});
