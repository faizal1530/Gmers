import { describe, expect, it } from "vitest";
import { ChatStore, MAX_CONVOS, MAX_MSGS, kindOf, otherMember } from "../src/chatstore";
import { dayLabel, listTime } from "../src/views/chathub";
import { id } from "../src/i18n/id";
import { memoryKV } from "./helpers";

const m = (seat: number, name: string) => ({ seat, name });
const msg = (text: string, ts: number, mine = false) => ({ kind: "msg" as const, seat: 1, name: "Budi", text, ts, mine });

describe("penyimpanan riwayat chat (hanya di perangkat)", () => {
  it("room berdua = chat biasa, selain itu grup; lawan bicara dikenali dari kursi saya", () => {
    const s = new ChatStore(memoryKV(), () => 1000);
    const two = s.ensure("AAA111", 0, [m(0, "Andi"), m(1, "Budi")]);
    const three = s.ensure("BBB222", 2, [m(0, "Andi"), m(1, "Budi"), m(2, "Citra")]);
    const solo = s.ensure("CCC333", 0, [m(0, "Andi")]);
    expect(kindOf(two)).toBe("direct");
    expect(otherMember(two)?.name).toBe("Budi");
    expect(kindOf(three)).toBe("group");
    expect(kindOf(solo)).toBe("group");
  });

  it("pesan, belum dibaca (tidak dihitung untuk pesan sendiri atau sistem), ditandai dibaca, urut terbaru", () => {
    const s = new ChatStore(memoryKV(), () => 1000);
    s.ensure("AAA111", 0, [m(0, "Andi"), m(1, "Budi")]);
    s.ensure("BBB222", 0, [m(0, "Andi"), m(1, "Citra")]);
    s.add("AAA111", msg("satu", 2000), true);
    s.add("AAA111", msg("saya", 2500, true), true);
    s.add("AAA111", { kind: "sys", seat: -1, name: "", text: "x", ts: 2600, mine: false }, true);
    s.add("BBB222", msg("dua", 3000), true);
    expect(s.get("AAA111")?.unread).toBe(1);
    expect(s.totalUnread()).toBe(2);
    expect(s.list().map((c) => c.groupId)).toEqual(["BBB222", "AAA111"]);
    expect(s.markRead("AAA111")).toBe(true);
    expect(s.markRead("AAA111")).toBe(false);
    expect(s.totalUnread()).toBe(1);
  });

  it("tersimpan dan terbaca kembali; data rusak diabaikan; clear menghapus", () => {
    const kv = memoryKV();
    const a = new ChatStore(kv, () => 1000);
    a.ensure("AAA111", 0, [m(0, "Andi"), m(1, "Budi")]);
    a.add("AAA111", msg("halo", 2000), true);
    const b = new ChatStore(kv, () => 1000);
    expect(b.get("AAA111")?.msgs[0]?.text).toBe("halo");
    expect(b.get("AAA111")?.unread).toBe(1);
    kv.data.set("gmers.chats.v1", "{bukan json");
    expect(new ChatStore(kv).list()).toEqual([]);
    kv.data.set("gmers.chats.v1", JSON.stringify([{ groupId: 5 }, "x"]));
    expect(new ChatStore(kv).list()).toEqual([]);
    b.clear();
    expect(new ChatStore(kv).list()).toEqual([]);
  });

  it("dibatasi: paling banyak MAX_MSGS pesan per percakapan dan MAX_CONVOS percakapan", () => {
    const s = new ChatStore(memoryKV(), () => 1000);
    s.ensure("AAA111", 0, [m(0, "Andi"), m(1, "Budi")]);
    for (let i = 0; i < MAX_MSGS + 20; i++) s.add("AAA111", msg(`p${i}`, 2000 + i), false);
    const c = s.get("AAA111")!;
    expect(c.msgs).toHaveLength(MAX_MSGS);
    expect(c.msgs[0]?.text).toBe("p20");
    let t = 1000;
    const s2 = new ChatStore(memoryKV(), () => t++);
    for (let i = 0; i < MAX_CONVOS + 5; i++) s2.ensure(`G${String(i).padStart(5, "0")}`, 0, [m(0, "Andi")]);
    expect(s2.list()).toHaveLength(MAX_CONVOS);
    expect(s2.get("G00000")).toBeNull(); // yang terlama dibuang
  });
});

describe("label waktu ala WhatsApp", () => {
  const at = (y: number, mo: number, d: number, hh: number, mm: number): number => new Date(y, mo - 1, d, hh, mm).getTime();
  const now = at(2026, 11, 24, 15, 30);

  it("hari ini = jam; kemarin; nama hari dalam seminggu; selain itu tanggal", () => {
    expect(listTime(at(2026, 11, 24, 9, 5), now)).toBe("09.05");
    expect(listTime(at(2026, 11, 23, 23, 59), now)).toBe(id.chat.yesterday);
    expect(listTime(at(2026, 11, 21, 10, 0), now)).toBe("Sabtu");
    expect(listTime(at(2026, 11, 10, 10, 0), now)).toBe("10 Nov");
  });

  it("pemisah hari: Hari ini, Kemarin, tanggal lengkap", () => {
    expect(dayLabel(at(2026, 11, 24, 0, 1), now)).toBe(id.chat.today);
    expect(dayLabel(at(2026, 11, 23, 12, 0), now)).toBe(id.chat.yesterday);
    expect(dayLabel(at(2026, 10, 3, 12, 0), now)).toBe("3 Okt 2026");
  });
});
