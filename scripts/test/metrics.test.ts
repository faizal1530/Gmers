import { describe, expect, it } from "vitest";
import { computeReport, formatTable, parseCsv, parseEvents, resultsToCsv, wibDayLabel, wibDayNumber } from "../lib/metrics";

const HEADER = "ts_utc,ts_wib,group_id,room_id,device_id,event,game_no,detail";

interface Ev {
  at: string; // ISO UTC
  g: string;
  room?: string;
  dev?: string;
  event: string;
  game?: number;
  detail?: string;
}

const csv = (events: Ev[]): string =>
  `${[HEADER, ...events.map((e) => [e.at, "x", e.g, e.room ?? `${e.g}-r1`, e.dev ?? "", e.event, e.game ?? "", e.detail ?? ""].map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(","))].join("\n")}\n`;

/** game_finished dengan n pemain (perangkat d1..dn). */
const fin = (at: string, g: string, n: number, game = 1, room?: string): Ev => ({
  at,
  g,
  room,
  event: "game_finished",
  game,
  detail: `reason=out;players=${n};ranking=${Array.from({ length: n }, (_, i) => i).join(">")};devices=${Array.from({ length: n }, (_, i) => `${g}d${i + 1}`).join("|")}`,
});

const report = (events: Ev[]) => computeReport(parseEvents(csv(events)));
const one = (events: Ev[], g: string) => report(events).results.find((r) => r.groupId === g)!;

describe("hari kalender WIB", () => {
  it("23.59 WIB dan 00.01 WIB berbeda hari; 00.00 WIB adalah awal hari baru", () => {
    const a = Date.parse("2026-11-23T16:59:00Z"); // 23.59 WIB 23 Nov
    const b = Date.parse("2026-11-23T17:01:00Z"); // 00.01 WIB 24 Nov
    expect(wibDayLabel(wibDayNumber(a))).toBe("2026-11-23");
    expect(wibDayLabel(wibDayNumber(b))).toBe("2026-11-24");
    expect(wibDayNumber(Date.parse("2026-11-23T17:00:00Z"))).toBe(wibDayNumber(b));
    expect(wibDayNumber(Date.parse("2026-11-23T16:59:59.999Z"))).toBe(wibDayNumber(a));
    // 23.59 UTC masih hari yang sama di UTC tetapi sudah 06.59 WIB hari berikutnya
    expect(wibDayLabel(wibDayNumber(Date.parse("2026-11-23T23:59:00Z")))).toBe("2026-11-24");
  });
});

describe("kelompok aktif", () => {
  it("rematch di hari yang sama tidak menambah hitungan (tidak aktif)", () => {
    const r = one([fin("2026-11-23T03:00:00Z", "G1", 3, 1), fin("2026-11-23T03:20:00Z", "G1", 3, 2), fin("2026-11-23T03:40:00Z", "G1", 4, 3)], "G1");
    expect(r.active).toBe(false);
    expect(r.qualifyingDays).toEqual(["2026-11-23"]);
    expect(r.gamesFinished).toBe(3);
  });

  it("dua hari WIB berbeda dalam jendela 14 hari: aktif", () => {
    const r = one([fin("2026-11-23T03:00:00Z", "G1", 3), fin("2026-11-26T03:00:00Z", "G1", 4)], "G1");
    expect(r.active).toBe(true);
    expect(r.qualifyingDays).toEqual(["2026-11-23", "2026-11-26"]);
  });

  it("batas tengah malam WIB: 23.59 dan 00.01 adalah dua hari (aktif)", () => {
    expect(one([fin("2026-11-23T16:59:00Z", "G1", 3), fin("2026-11-23T17:01:00Z", "G1", 3)], "G1").active).toBe(true);
  });

  it("dua game sebelum dan sesudah 00.00 UTC tetapi di hari WIB yang sama: tidak aktif", () => {
    // 20.00 WIB dan 23.30 WIB di hari yang sama (13.00Z dan 16.30Z)
    expect(one([fin("2026-11-23T13:00:00Z", "G1", 3), fin("2026-11-23T16:30:00Z", "G1", 3)], "G1").active).toBe(false);
  });

  it("hanya 2 pemain: tidak dihitung walau di dua hari", () => {
    const r = one([fin("2026-11-23T03:00:00Z", "G1", 2), fin("2026-11-24T03:00:00Z", "G1", 2)], "G1");
    expect(r.active).toBe(false);
    expect(r.qualifyingDays).toEqual([]);
    expect(r.gamesFinished).toBe(2);
  });

  it("satu hari 3 pemain + satu hari 2 pemain: tidak aktif", () => {
    expect(one([fin("2026-11-23T03:00:00Z", "G1", 3), fin("2026-11-24T03:00:00Z", "G1", 2)], "G1").active).toBe(false);
  });

  it("jendela 14 hari: hari ke-14 (selisih 13) masih aktif; selisih 14 hari terlewat", () => {
    expect(one([fin("2026-11-01T03:00:00Z", "G1", 3), fin("2026-11-14T03:00:00Z", "G1", 3)], "G1").active).toBe(true);
    expect(one([fin("2026-11-01T03:00:00Z", "G2", 3), fin("2026-11-15T03:00:00Z", "G2", 3)], "G2").active).toBe(false);
    expect(one([fin("2026-11-01T03:00:00Z", "G3", 3), fin("2026-11-16T03:00:00Z", "G3", 3)], "G3").active).toBe(false);
  });

  it("jendela bergeser: hari pertama terlalu jauh, tetapi dua hari berikutnya dekat: aktif", () => {
    const r = one([fin("2026-11-01T03:00:00Z", "G1", 3), fin("2026-11-20T03:00:00Z", "G1", 3), fin("2026-11-22T03:00:00Z", "G1", 3)], "G1");
    expect(r.active).toBe(true);
  });

  it("opsi --window mengubah jendela", () => {
    const events = parseEvents(csv([fin("2026-11-01T03:00:00Z", "G1", 3), fin("2026-11-04T03:00:00Z", "G1", 3)]));
    expect(computeReport(events, { windowDays: 3, minPlayers: 3, replayDays: 7 }).results[0]!.active).toBe(false);
    expect(computeReport(events, { windowDays: 4, minPlayers: 3, replayDays: 7 }).results[0]!.active).toBe(true);
  });

  it("kelompok dipisah per group_id dan sesi room berbeda tetap satu kelompok", () => {
    const r = report([
      fin("2026-11-23T03:00:00Z", "GA", 3, 1, "GA"),
      fin("2026-11-25T03:00:00Z", "GA", 3, 1, "GA-sesi2"),
      fin("2026-11-23T03:00:00Z", "GB", 4, 1),
    ]);
    expect(r.summary.groups).toBe(2);
    expect(r.results.find((x) => x.groupId === "GA")!.active).toBe(true);
    expect(r.results.find((x) => x.groupId === "GB")!.active).toBe(false);
    expect(r.summary.active).toBe(1);
  });

  it("jumlah pemain dihitung dari perangkat berbeda (perangkat yang sama dua kali tidak menggandakan)", () => {
    const dup: Ev = { at: "2026-11-23T03:00:00Z", g: "G1", event: "game_finished", game: 1, detail: "reason=out;players=3;ranking=0>1>2;devices=aa|aa|bb" };
    expect(one([dup, { ...dup, at: "2026-11-24T03:00:00Z" }], "G1").active).toBe(false);
  });
});

describe("metrik lain", () => {
  const events: Ev[] = [
    { at: "2026-11-23T01:00:00Z", g: "G1", event: "group_created", dev: "g1host" },
    { at: "2026-11-23T01:01:00Z", g: "G1", event: "player_joined", dev: "g1host" },
    { at: "2026-11-23T01:02:00Z", g: "G1", event: "invite_link_opened", dev: "p2" },
    { at: "2026-11-23T01:02:30Z", g: "G1", event: "invite_link_opened", dev: "p3" },
    { at: "2026-11-23T01:02:40Z", g: "G1", event: "invite_link_opened", dev: "p4" },
    { at: "2026-11-23T01:03:00Z", g: "G1", event: "player_joined", dev: "p2" },
    { at: "2026-11-23T01:04:00Z", g: "G1", event: "player_joined", dev: "p3" },
    fin("2026-11-23T02:00:00Z", "G1", 3),
    fin("2026-11-29T03:00:00Z", "G1", 3, 1, "G1-sesi2"), // hari ke-7 setelah game pertama (23 -> 29 WIB = 6 hari)
    { at: "2026-11-23T01:00:00Z", g: "G2", event: "group_created", dev: "g2host" },
    { at: "2026-11-23T01:02:00Z", g: "G2", event: "invite_link_opened", dev: "q2" },
    fin("2026-11-23T02:00:00Z", "G2", 2),
    fin("2026-11-23T05:00:00Z", "G2", 2, 2),
    { at: "2026-11-23T01:00:00Z", g: "G3", event: "group_created", dev: "g3host" },
    { at: "2026-11-23T01:02:00Z", g: "G3", event: "invite_link_opened", dev: "r2" },
  ];

  it("konversi tautan -> masuk, game pertama selesai, dan main lagi dalam 7 hari (hari berbeda)", () => {
    const r = report(events);
    const g1 = r.results.find((x) => x.groupId === "G1")!;
    expect(g1).toMatchObject({ linksOpened: 3, joinedFromLink: 2, finishedFirstSession: true, playedAgainWithin7d: true, active: true });
    const g2 = r.results.find((x) => x.groupId === "G2")!;
    expect(g2).toMatchObject({ linksOpened: 1, joinedFromLink: 0, finishedFirstSession: true, playedAgainWithin7d: false, active: false });
    const g3 = r.results.find((x) => x.groupId === "G3")!;
    expect(g3.finishedFirstSession).toBe(false);
    expect(r.summary).toMatchObject({ groups: 3, active: 1, finishedFirstSession: 2, linksOpened: 5, joinedFromLink: 2, playedAgain: 1 });
    expect(r.summary.linkConversion).toBeCloseTo(0.4);
    expect(r.summary.playedAgainRate).toBeCloseTo(0.5);
  });

  it("main lagi: rematch di hari yang sama tidak dihitung; hari ke-8 tidak dihitung", () => {
    expect(one([fin("2026-11-23T02:00:00Z", "G1", 3), fin("2026-11-23T03:00:00Z", "G1", 3, 2)], "G1").playedAgainWithin7d).toBe(false);
    expect(one([fin("2026-11-23T02:00:00Z", "G1", 3), fin("2026-11-30T03:00:00Z", "G1", 3)], "G1").playedAgainWithin7d).toBe(true);
    expect(one([fin("2026-11-23T02:00:00Z", "G1", 3), fin("2026-12-01T03:00:00Z", "G1", 3)], "G1").playedAgainWithin7d).toBe(false);
  });

  it("tabel ringkas dan CSV hasil memuat ringkasan yang benar", () => {
    const r = report(events);
    const table = formatTable(r);
    expect(table).toContain("Kelompok AKTIF");
    expect(table).toContain("1 dari 3");
    expect(table).toContain("2 dari 5 (40%)");
    const out = resultsToCsv(r).trim().split("\n");
    expect(out[0]).toBe("group_id,games_finished,qualifying_days,active,finished_first_session,first_game_day_wib,links_opened,joined_from_link,played_again_7d");
    expect(out).toHaveLength(4);
    expect(out[1]).toMatch(/^G1,2,2026-11-23\|2026-11-29,ya,ya,2026-11-23,3,2,ya$/);
  });

  it("tanpa data: tidak membagi dengan nol", () => {
    const r = computeReport([]);
    expect(r.summary).toMatchObject({ groups: 0, active: 0, linkConversion: null, playedAgainRate: null });
    expect(formatTable(r)).toContain("n/a");
  });
});

describe("CSV", () => {
  it("parser: kutip, koma, baris baru di dalam sel, CRLF, baris kosong", () => {
    expect(parseCsv('a,"b,c","d ""x"""\r\n\r\n1,2,3\n')).toEqual([["a", "b,c", 'd "x"'], ["1", "2", "3"]]);
    expect(parseCsv('a,"baris1\nbaris2",c')).toEqual([["a", "baris1\nbaris2", "c"]]);
  });
  it("header salah ditolak; baris rusak dilewati", () => {
    expect(() => parseEvents("a,b,c\n1,2,3\n")).toThrow(/Header CSV/);
    const ok = parseEvents(`${HEADER}\nbukan-tanggal,x,G,R,d,game_finished,1,\n2026-11-23T03:00:00Z,x,G,R,d,message_sent,,\n`);
    expect(ok).toHaveLength(1);
    expect(ok[0]!.event).toBe("message_sent");
  });
  it("BOM di awal berkas diabaikan", () => {
    expect(parseEvents(`\uFEFF${HEADER}\n2026-11-23T03:00:00Z,x,G,R,d,message_sent,,\n`)).toHaveLength(1);
  });
});
