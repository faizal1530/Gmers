import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GapleConfig, Move } from "@gmers/game-engine";

/** Log hanya-tambah. Isi chat tidak pernah ditulis. */
export type LogRecord =
  | { t: "group"; groupId: string; ts: number }
  | { t: "room"; roomId: string; groupId: string; ts: number }
  | { t: "sit"; roomId: string; ts: number; seat: number; tokenHash: string; name: string }
  | { t: "stand"; roomId: string; ts: number; seat: number }
  | { t: "start"; roomId: string; ts: number; gameNo: number; seed: string; config: GapleConfig; roomSeats: number[] }
  | { t: "move"; roomId: string; ts: number; gameNo: number; move: Move; auto?: true }
  | { t: "closed"; roomId: string; ts: number };

export interface RoomLog {
  append(record: LogRecord): void;
  readAll(): LogRecord[];
  /** Ganti seluruh isi (pemadatan setelah room ditutup). */
  rewrite(records: LogRecord[]): void;
}

export class MemoryRoomLog implements RoomLog {
  private records: LogRecord[] = [];
  append(record: LogRecord): void {
    this.records.push(JSON.parse(JSON.stringify(record)) as LogRecord);
  }
  readAll(): LogRecord[] {
    return this.records.slice();
  }
  rewrite(records: LogRecord[]): void {
    this.records = records.slice();
  }
}

/** JSONL lokal. Baris terakhir yang terpotong (mati mendadak) dilewati saat dibaca. */
export class FileRoomLog implements RoomLog {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  append(record: LogRecord): void {
    appendFileSync(this.file, `${JSON.stringify(record)}\n`);
  }
  readAll(): LogRecord[] {
    if (!existsSync(this.file)) return [];
    const out: LogRecord[] = [];
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        out.push(JSON.parse(line) as LogRecord);
      } catch {
        // baris rusak/terpotong: lewati
      }
    }
    return out;
  }
  rewrite(records: LogRecord[]): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, records.map((r) => `${JSON.stringify(r)}\n`).join(""));
    renameSync(tmp, this.file);
  }
}
