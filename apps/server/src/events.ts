import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type EventName =
  | "group_created"
  | "player_joined"
  | "player_left"
  | "reconnected"
  | "game_started"
  | "game_finished"
  | "rematch_clicked"
  | "message_sent"
  | "invite_link_opened";

export interface GameEvent {
  /** Epoch ms. */
  ts: number;
  /** Kode kelompok pada tautan; tidak pernah kedaluwarsa. */
  groupId: string;
  /** Sesi room saat ini (satu kelompok bisa punya banyak sesi lintas hari); kosong bila tidak ada. */
  roomId: string;
  /** Hash token perangkat (bukan token asli); string kosong bila tidak ada. */
  deviceId: string;
  event: EventName;
  gameNo: number | null;
  /** Teks pendek tanpa data pribadi: tanpa isi chat, nomor HP, atau IP. */
  detail: string;
}

export interface EventSink {
  emit(event: GameEvent): void;
}

export class NoopEventSink implements EventSink {
  emit(): void {}
}

export class MemoryEventSink implements EventSink {
  readonly events: GameEvent[] = [];
  emit(event: GameEvent): void {
    this.events.push(event);
  }
}

export const CSV_HEADER = "ts_utc,ts_wib,group_id,room_id,device_id,event,game_no,detail";

/** Waktu WIB (UTC+7) ber-offset eksplisit, mis. 2026-11-23T22:15:00.000+07:00. */
export function formatWib(ts: number): string {
  return new Date(ts + 7 * 3600_000).toISOString().replace("Z", "+07:00");
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function eventToCsvLine(e: GameEvent): string {
  return [
    new Date(e.ts).toISOString(),
    formatWib(e.ts),
    e.groupId,
    e.roomId,
    e.deviceId,
    e.event,
    e.gameNo === null ? "" : String(e.gameNo),
    e.detail,
  ]
    .map(csvCell)
    .join(",");
}

/** Adapter berkas CSV (hanya-tambah). Tahap D melengkapi ekspor dan penghitung. */
export class CsvEventSink implements EventSink {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file) || statSync(file).size === 0) writeFileSync(file, `${CSV_HEADER}\n`);
  }
  emit(event: GameEvent): void {
    appendFileSync(this.file, `${eventToCsvLine(event)}\n`);
  }
}
