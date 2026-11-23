/** Penghitung metrik MVP dari CSV peristiwa. Murni (tanpa I/O) agar mudah diuji. */

export const EXPECTED_HEADER = ["ts_utc", "ts_wib", "group_id", "room_id", "device_id", "event", "game_no", "detail"];

export interface EventRow {
  tsUtc: number;
  groupId: string;
  roomId: string;
  deviceId: string;
  event: string;
  gameNo: number | null;
  detail: string;
}

/** Parser CSV (RFC 4180): sel berkutip, koma dan baris baru di dalam kutip, kutip ganda. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

export function parseEvents(csv: string): EventRow[] {
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  const header = rows[0];
  if (!header || EXPECTED_HEADER.some((h, i) => header[i] !== h)) {
    throw new Error(`Header CSV tidak sesuai. Diharapkan: ${EXPECTED_HEADER.join(",")}`);
  }
  const out: EventRow[] = [];
  for (const r of rows.slice(1)) {
    const ts = Date.parse(r[0] ?? "");
    if (Number.isNaN(ts) || r.length < EXPECTED_HEADER.length) continue; // baris rusak dilewati
    out.push({
      tsUtc: ts,
      groupId: r[2] as string,
      roomId: r[3] as string,
      deviceId: r[4] as string,
      event: r[5] as string,
      gameNo: r[6] ? Number(r[6]) : null,
      detail: r[7] as string,
    });
  }
  return out;
}

const DAY_MS = 86_400_000;
const WIB_MS = 7 * 3_600_000;

/** Nomor hari kalender WIB (hari sejak epoch di zona UTC+7). 23.59 dan 00.01 WIB jatuh pada hari berbeda. */
export function wibDayNumber(tsUtc: number): number {
  return Math.floor((tsUtc + WIB_MS) / DAY_MS);
}

export function wibDayLabel(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function parseDetail(detail: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of detail.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

export interface Options {
  /** Panjang jendela dalam hari kalender WIB (inklusif). Dua hari sah harus berjarak <= windowDays - 1. */
  windowDays: number;
  /** Minimal pemain berbeda dalam satu game agar dihitung. */
  minPlayers: number;
  /** Batas hari untuk "main lagi". */
  replayDays: number;
}

export const DEFAULT_OPTIONS: Options = { windowDays: 14, minPlayers: 3, replayDays: 7 };

export interface GroupResult {
  groupId: string;
  gamesFinished: number;
  /** Hari WIB (YYYY-MM-DD) dengan minimal satu game selesai berpemain >= minPlayers. */
  qualifyingDays: string[];
  active: boolean;
  finishedFirstSession: boolean;
  firstGameDay: string;
  linksOpened: number;
  joinedFromLink: number;
  playedAgainWithin7d: boolean;
}

export interface Summary {
  groups: number;
  active: number;
  finishedFirstSession: number;
  linksOpened: number;
  joinedFromLink: number;
  linkConversion: number | null;
  withFinishedGame: number;
  playedAgain: number;
  playedAgainRate: number | null;
}

export interface Report {
  options: Options;
  results: GroupResult[];
  summary: Summary;
}

/** Jumlah pemain dan perangkat sebuah game_finished dari kolom detail. */
function gamePlayers(detail: string): { players: number; devices: Set<string> } {
  const d = parseDetail(detail);
  const devices = new Set((d.devices ?? "").split("|").filter(Boolean));
  const players = devices.size > 0 ? devices.size : Number(d.players ?? 0);
  return { players: Number.isFinite(players) ? players : 0, devices };
}

export function computeReport(events: EventRow[], options: Options = DEFAULT_OPTIONS): Report {
  const groups = new Map<string, EventRow[]>();
  for (const e of events) {
    if (!e.groupId) continue;
    const list = groups.get(e.groupId) ?? [];
    list.push(e);
    groups.set(e.groupId, list);
  }

  const results: GroupResult[] = [];
  for (const [groupId, list] of groups) {
    list.sort((a, b) => a.tsUtc - b.tsUtc);
    const finished = list.filter((e) => e.event === "game_finished");
    const finishedDays = [...new Set(finished.map((e) => wibDayNumber(e.tsUtc)))].sort((a, b) => a - b);
    const qualifying = [
      ...new Set(finished.filter((e) => gamePlayers(e.detail).players >= options.minPlayers).map((e) => wibDayNumber(e.tsUtc))),
    ].sort((a, b) => a - b);

    // Aktif: ada dua hari sah berbeda dalam satu jendela windowDays hari.
    let active = false;
    for (let i = 0; i + 1 < qualifying.length && !active; i++) {
      if ((qualifying[i + 1] as number) - (qualifying[i] as number) <= options.windowDays - 1) active = true;
    }

    const opened = new Set(list.filter((e) => e.event === "invite_link_opened" && e.deviceId).map((e) => e.deviceId));
    const entered = new Set(list.filter((e) => (e.event === "player_joined" || e.event === "reconnected") && e.deviceId).map((e) => e.deviceId));
    const joinedFromLink = [...opened].filter((d) => entered.has(d)).length;

    const firstDay = finishedDays[0];
    const playedAgain = firstDay !== undefined && finishedDays.some((d) => d > firstDay && d - firstDay <= options.replayDays);

    results.push({
      groupId,
      gamesFinished: finished.length,
      qualifyingDays: qualifying.map(wibDayLabel),
      active,
      finishedFirstSession: finished.length > 0,
      firstGameDay: firstDay === undefined ? "" : wibDayLabel(firstDay),
      linksOpened: opened.size,
      joinedFromLink,
      playedAgainWithin7d: playedAgain,
    });
  }
  results.sort((a, b) => a.groupId.localeCompare(b.groupId));

  const linksOpened = results.reduce((s, r) => s + r.linksOpened, 0);
  const joinedFromLink = results.reduce((s, r) => s + r.joinedFromLink, 0);
  const withFinished = results.filter((r) => r.finishedFirstSession).length;
  const playedAgain = results.filter((r) => r.playedAgainWithin7d).length;
  return {
    options,
    results,
    summary: {
      groups: results.length,
      active: results.filter((r) => r.active).length,
      finishedFirstSession: withFinished,
      linksOpened,
      joinedFromLink,
      linkConversion: linksOpened > 0 ? joinedFromLink / linksOpened : null,
      withFinishedGame: withFinished,
      playedAgain,
      playedAgainRate: withFinished > 0 ? playedAgain / withFinished : null,
    },
  };
}

export function resultsToCsv(report: Report): string {
  const head = "group_id,games_finished,qualifying_days,active,finished_first_session,first_game_day_wib,links_opened,joined_from_link,played_again_7d";
  const rows = report.results.map((r) =>
    [r.groupId, r.gamesFinished, r.qualifyingDays.join("|"), r.active ? "ya" : "tidak", r.finishedFirstSession ? "ya" : "tidak", r.firstGameDay, r.linksOpened, r.joinedFromLink, r.playedAgainWithin7d ? "ya" : "tidak"].join(","),
  );
  return `${[head, ...rows].join("\n")}\n`;
}

const pct = (x: number | null): string => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);

export function formatTable(report: Report): string {
  const o = report.options;
  const cols = ["Kelompok", "Game selesai", `Hari sah (>=${o.minPlayers} pemain)`, "Aktif", "Game pertama selesai", "Tautan dibuka", "Masuk", `Main lagi <=${o.replayDays} hari`];
  const rows = report.results.map((r) => [
    r.groupId,
    String(r.gamesFinished),
    r.qualifyingDays.join(" ") || "-",
    r.active ? "YA" : "tidak",
    r.finishedFirstSession ? "ya" : "tidak",
    String(r.linksOpened),
    String(r.joinedFromLink),
    r.playedAgainWithin7d ? "ya" : "tidak",
  ]);
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => (r[i] as string).length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i] as number)).join("  ").trimEnd();
  const s = report.summary;
  return [
    line(cols),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map(line),
    "",
    `Kelompok: ${s.groups}`,
    `Kelompok AKTIF (>=${o.minPlayers} pemain pada >=2 hari WIB berbeda dalam ${o.windowDays} hari): ${s.active} dari ${s.groups}`,
    `Menyelesaikan game pertama: ${s.finishedFirstSession} dari ${s.groups} (${pct(s.groups ? s.finishedFirstSession / s.groups : null)})`,
    `Konversi tautan dibuka -> masuk: ${s.joinedFromLink} dari ${s.linksOpened} (${pct(s.linkConversion)})`,
    `Main lagi dalam ${o.replayDays} hari (hari berbeda): ${s.playedAgain} dari ${s.withFinishedGame} kelompok yang pernah menyelesaikan game (${pct(s.playedAgainRate)})`,
  ].join("\n");
}
