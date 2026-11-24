import { fileURLToPath } from "node:url";
import type { GapleConfig } from "@gmers/game-engine";

/** Semua angka dan jalur yang boleh diubah ada di sini (dan lewat variabel lingkungan GMERS_*), bukan di kode. */
export interface ServerConfig {
  port: number;
  host: string;
  /** Batas waktu satu giliran. */
  turnTimeoutMs: number;
  /** Jumlah kursi per room. Mesin mendukung 2 sampai 4 pemain. */
  maxSeats: number;
  minPlayersToStart: number;
  /** Room tanpa aktivitas dan tanpa pemain terhubung dihapus setelah ini. */
  roomIdleTtlMs: number;
  cleanupIntervalMs: number;
  /** Selang ping WebSocket; koneksi yang tidak membalas pong sebelum ping berikutnya diputus. */
  heartbeatIntervalMs: number;
  maxRooms: number;
  nameMinLength: number;
  nameMaxLength: number;
  chatMaxLength: number;
  /** Pembatas laju chat per pemain: paling banyak chatBurst pesan per chatWindowMs. */
  /** Jeda minimal antar sundulan dari satu pemain. */
  nudgeIntervalMs: number;
  chatBurst: number;
  chatWindowMs: number;
  maxMessageBytes: number;
  dataDir: string;
  roomLogFile: string;
  /** Null = tidak mencatat peristiwa ke CSV. */
  eventsCsvFile: string | null;
  /** Folder hasil build klien web yang disajikan server (null = tidak menyajikan situs). */
  staticDir: string | null;
  /** Token rahasia untuk /admin/events.csv. Null = endpoint dimatikan. Tidak ada nilai default. */
  adminToken: string | null;
  /** Garam untuk hash token perangkat (device_id di CSV dan token di log). Isi lewat GMERS_HASH_SALT. */
  hashSalt: string;
  /** Penimpa aturan Gaple (parameter mesin). `players` dan `openerSeat` diatur server. */
  game: Partial<GapleConfig>;
}

export const defaultServerConfig: ServerConfig = {
  port: 8787,
  host: "0.0.0.0",
  turnTimeoutMs: 60_000,
  maxSeats: 4,
  minPlayersToStart: 2,
  roomIdleTtlMs: 24 * 60 * 60 * 1000,
  cleanupIntervalMs: 10 * 60 * 1000,
  heartbeatIntervalMs: 25_000,
  maxRooms: 5000,
  nameMinLength: 2,
  nameMaxLength: 16,
  chatMaxLength: 300,
  nudgeIntervalMs: 10_000,
  chatBurst: 5,
  chatWindowMs: 10_000,
  maxMessageBytes: 4096,
  dataDir: "data",
  roomLogFile: "rooms.jsonl",
  eventsCsvFile: "events.csv",
  staticDir: null,
  adminToken: null,
  hashSalt: "gmers-dev-salt",
  game: {},
};

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Nilai konfigurasi tidak valid: ${v}`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const d = defaultServerConfig;
  return {
    ...d,
    port: num(env.PORT ?? env.GMERS_PORT, d.port),
    host: env.GMERS_HOST ?? d.host,
    turnTimeoutMs: num(env.GMERS_TURN_TIMEOUT_MS, d.turnTimeoutMs),
    roomIdleTtlMs: num(env.GMERS_ROOM_IDLE_TTL_MS, d.roomIdleTtlMs),
    cleanupIntervalMs: num(env.GMERS_CLEANUP_INTERVAL_MS, d.cleanupIntervalMs),
    heartbeatIntervalMs: num(env.GMERS_HEARTBEAT_MS, d.heartbeatIntervalMs),
    dataDir: env.DATA_DIR ?? env.GMERS_DATA_DIR ?? d.dataDir,
    eventsCsvFile: env.GMERS_EVENTS_CSV === "" ? null : (env.GMERS_EVENTS_CSV ?? d.eventsCsvFile),
    staticDir: env.GMERS_STATIC_DIR === "" ? null : (env.GMERS_STATIC_DIR ?? fileURLToPath(new URL("../../web/dist", import.meta.url))),
    adminToken: env.ADMIN_TOKEN ? env.ADMIN_TOKEN : null,
    hashSalt: env.HASH_SALT ?? env.GMERS_HASH_SALT ?? d.hashSalt,
  };
}
