import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ServerConfig } from "./config";
import { CsvEventSink, NoopEventSink, type EventSink } from "./events";
import { makeClientMessageSchema, type ServerMessage } from "./protocol";
import { RoomService, type Conn, type ServiceDeps } from "./service";
import { FileRoomLog, type RoomLog } from "./store";

export interface GmersServer {
  port: number;
  service: RoomService;
  close(): Promise<void>;
}

export interface ServerDeps extends ServiceDeps {
  log?: RoomLog;
  events?: EventSink;
}

export async function startServer(config: ServerConfig, deps: ServerDeps = {}): Promise<GmersServer> {
  const log = deps.log ?? new FileRoomLog(join(config.dataDir, config.roomLogFile));
  const events = deps.events ?? (config.eventsCsvFile ? new CsvEventSink(join(config.dataDir, config.eventsCsvFile)) : new NoopEventSink());
  const service = new RoomService(config, { ...deps, log, events });
  service.start();

  const schema = makeClientMessageSchema(config);
  const csvPath = config.eventsCsvFile ? join(config.dataDir, config.eventsCsvFile) : null;
  const http: HttpServer = createHttpServer((req, res) => {
    try {
      handleHttp(config, csvPath, req, res);
    } catch {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Kesalahan server.");
    }
  });
  const wss = new WebSocketServer({ server: http, maxPayload: config.maxMessageBytes });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on("connection", (ws) => {
    // Alamat IP klien sengaja tidak dibaca atau disimpan.
    const conn: Conn = {
      id: randomUUID(),
      session: null,
      send(msg: ServerMessage) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close(code, reason) {
        ws.close(code, reason);
      },
    };
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", (data) => {
      alive.set(ws, true);
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        conn.send({ type: "error", code: "BAD_MESSAGE", message: "Pesan tidak bisa dibaca." });
        return;
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        conn.send({ type: "error", code: "BAD_MESSAGE", message: "Pesan tidak valid." });
        return;
      }
      try {
        service.handle(conn, parsed.data);
      } catch (e) {
        // handle() sudah memberi tahu klien; jangan matikan proses karena satu pesan.
        process.stderr.write(`kesalahan menangani pesan: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    });
    ws.on("close", () => service.onDisconnect(conn));
    ws.on("error", () => ws.terminate());
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, config.heartbeatIntervalMs);
  heartbeat.unref();

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(config.port, config.host, resolve);
  });
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : config.port;

  return {
    port,
    service,
    async close() {
      clearInterval(heartbeat);
      service.stop();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Header keamanan untuk semua jawaban. Skrip hanya dari origin sendiri; tidak ada pihak ketiga. */
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function sha(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Bandingkan token dalam waktu konstan (lewat hash agar panjang sama). */
export function tokensMatch(given: string | null | undefined, expected: string | null): boolean {
  if (!expected || !given) return false;
  return timingSafeEqual(sha(given), sha(expected));
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

function handleHttp(config: ServerConfig, csvPath: string | null, req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain; charset=utf-8", "Metode tidak diizinkan.");
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = decodeURIComponent(url.pathname);

  if (path === "/healthz") return send(res, 200, "text/plain; charset=utf-8", "ok", { "cache-control": "no-store" });

  if (path === "/admin/events.csv") {
    if (!config.adminToken) return send(res, 503, "text/plain; charset=utf-8", "Ekspor dimatikan: ADMIN_TOKEN belum diatur.", { "cache-control": "no-store" });
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const given = bearer ?? url.searchParams.get("token");
    if (!tokensMatch(given, config.adminToken)) return send(res, 401, "text/plain; charset=utf-8", "Tidak diizinkan.", { "cache-control": "no-store", "www-authenticate": "Bearer" });
    if (!csvPath || !existsSync(csvPath)) return send(res, 404, "text/plain; charset=utf-8", "Belum ada data.", { "cache-control": "no-store" });
    return send(res, 200, "text/csv; charset=utf-8", readFileSync(csvPath), {
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="gmers-events.csv"',
    });
  }
  if (path.startsWith("/admin")) return send(res, 404, "text/plain; charset=utf-8", "Tidak ditemukan.");

  if (!config.staticDir) return send(res, 404, "text/plain; charset=utf-8", "Gmers server");
  const root = resolve(config.staticDir);
  const file = resolve(join(root, normalize(path)));
  const inside = file === root || file.startsWith(root + sep);
  if (inside && existsSync(file) && statSync(file).isFile()) {
    const hashed = /\/assets\//.test(path);
    return send(res, 200, MIME[extname(file)] ?? "application/octet-stream", readFileSync(file), {
      "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    });
  }
  // Rute klien (/g/KODE, /privasi, dll.) dijawab dengan index.html; berkas yang tak ada dengan ekstensi = 404.
  if (extname(path) === "" && existsSync(join(root, "index.html"))) {
    return send(res, 200, MIME[".html"] as string, readFileSync(join(root, "index.html")), { "cache-control": "no-cache" });
  }
  return send(res, 404, "text/plain; charset=utf-8", "Tidak ditemukan.");
}
