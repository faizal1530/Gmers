import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { z } from "zod";
import { WebSocketServer, type WebSocket } from "ws";
import { AccountService, FileAccountLog, isAuthError, type AccountLog } from "./accounts";
import { realClock } from "./clock";
import type { ServerConfig } from "./config";
import { CsvEventSink, NoopEventSink, type EventSink } from "./events";
import { makeClientMessageSchema, type ServerMessage } from "./protocol";
import { RoomService, type Conn, type ServiceDeps } from "./service";
import { FileRoomLog, type RoomLog } from "./store";

export interface GmersServer {
  port: number;
  service: RoomService;
  accounts: AccountService;
  close(): Promise<void>;
}

export interface ServerDeps extends ServiceDeps {
  accountLog?: AccountLog;
  log?: RoomLog;
  events?: EventSink;
}

export async function startServer(config: ServerConfig, deps: ServerDeps = {}): Promise<GmersServer> {
  const log = deps.log ?? new FileRoomLog(join(config.dataDir, config.roomLogFile));
  const events = deps.events ?? (config.eventsCsvFile ? new CsvEventSink(join(config.dataDir, config.eventsCsvFile)) : new NoopEventSink());
  // eslint-disable-next-line prefer-const -- service dibuat setelah accounts, keduanya saling merujuk lewat closure
  let service: RoomService;
  const accounts = new AccountService(config, deps.accountLog ?? new FileAccountLog(join(config.dataDir, config.accountsFile)), deps.clock ?? realClock, (h) => service.groupsOf(h));
  service = new RoomService(config, { ...deps, log, events, onSeat: (h, g) => accounts.noteGroup(h, g) });
  service.start();

  const schema = makeClientMessageSchema(config);
  const csvPath = config.eventsCsvFile ? join(config.dataDir, config.eventsCsvFile) : null;
  const http: HttpServer = createHttpServer((req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (path.startsWith("/api/") || path === "/admin/accounts/reset") {
      handleApi(config, accounts, req, res, path).catch(() => sendJson(res, 500, { code: "SERVER_ERROR", message: "Terjadi kesalahan di server. Coba lagi." }));
      return;
    }
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
    accounts,
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


// ---------- API akun ----------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body), { "cache-control": "no-store" });
}

class BodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage, limit = 4096): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new BodyError(415, "BAD_REQUEST", "Permintaan harus berformat JSON.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new BodyError(413, "TOO_LARGE", "Permintaan terlalu besar.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BodyError(400, "BAD_REQUEST", "Permintaan tidak bisa dibaca.");
  }
}

// eslint-disable-next-line no-control-regex
const noControl = /^[^\u0000-\u001F\u007F]*$/;
const usernameS = z.string().trim().regex(/^[A-Za-z0-9_.]{3,20}$/, "USERNAME");
const passwordS = z.string().min(8, "PASSWORD").max(128, "PASSWORD");
const nameS = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2, "NAME").max(16, "NAME").regex(noControl, "NAME"));
const tokenS = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, "TOKEN");
const prefsS = z.object({ theme: z.enum(["auto", "light", "dark"]).optional(), sound: z.boolean().optional() }).strict();

const schemas = {
  register: z.object({ username: usernameS, password: passwordS, name: nameS.optional(), token: tokenS }).strict(),
  login: z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(128) }).strict(),
  profile: z.object({ name: nameS.optional(), prefs: prefsS.optional() }).strict(),
  password: z.object({ oldPassword: z.string().min(1).max(128), newPassword: passwordS }).strict(),
  del: z.object({ password: z.string().min(1).max(128) }).strict(),
  reset: z.object({ username: z.string().trim().min(1).max(40), newPassword: passwordS }).strict(),
};

const FIELD_MESSAGES: Record<string, string> = {
  USERNAME: "Nama pengguna 3 sampai 20 karakter: huruf, angka, titik, atau garis bawah.",
  PASSWORD: "Kata sandi 8 sampai 128 karakter.",
  NAME: "Nama panggilan 2 sampai 16 karakter.",
  TOKEN: "Perangkat tidak dikenali. Muat ulang halaman lalu coba lagi.",
};

function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (r.success) return r.data as z.infer<S>;
  const msg = r.error.issues.map((i) => FIELD_MESSAGES[i.message]).find(Boolean);
  throw new BodyError(400, "BAD_REQUEST", msg ?? "Data tidak valid.");
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}

async function handleApi(config: ServerConfig, accounts: AccountService, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const method = req.method ?? "GET";
  try {
    if (path === "/admin/accounts/reset") {
      if (method !== "POST") return sendJson(res, 405, { code: "METHOD", message: "Metode tidak diizinkan." });
      if (!config.adminToken) return sendJson(res, 503, { code: "DISABLED", message: "Dimatikan: ADMIN_TOKEN belum diatur." });
      if (!tokensMatch(bearer(req), config.adminToken)) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Tidak diizinkan." });
      const b = parseBody(schemas.reset, await readJson(req));
      const r = await accounts.adminReset(b.username, b.newPassword);
      return isAuthError(r) ? sendJson(res, r.status, { code: r.code, message: r.message }) : sendJson(res, 200, { ok: true });
    }

    const route = `${method} ${path}`;
    const session = bearer(req);
    const out = (r: unknown): void => (isAuthError(r) ? sendJson(res, r.status, { code: r.code, message: r.message }) : sendJson(res, 200, r));
    switch (route) {
      case "POST /api/register": {
        const b = parseBody(schemas.register, await readJson(req));
        return out(await accounts.register({ username: b.username, password: b.password, name: b.name ?? b.username.slice(0, 16), token: b.token }));
      }
      case "POST /api/login": {
        const b = parseBody(schemas.login, await readJson(req));
        return out(await accounts.login(b));
      }
      case "POST /api/logout":
        accounts.logout(session);
        return sendJson(res, 200, { ok: true });
      case "GET /api/me": {
        const me = accounts.me(session);
        return me ? sendJson(res, 200, { account: me }) : sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
      }
      case "PUT /api/me": {
        const b = parseBody(schemas.profile, await readJson(req));
        const r = accounts.updateProfile(session, b);
        return isAuthError(r) ? out(r) : sendJson(res, 200, { account: r });
      }
      case "POST /api/me/password": {
        const b = parseBody(schemas.password, await readJson(req));
        return out(await accounts.changePassword(session, b.oldPassword, b.newPassword));
      }
      case "DELETE /api/me": {
        const b = parseBody(schemas.del, await readJson(req));
        return out(await accounts.deleteAccount(session, b.password));
      }
      default:
        return sendJson(res, path.startsWith("/api/") ? 404 : 405, { code: "NOT_FOUND", message: "Tidak ditemukan." });
    }
  } catch (e) {
    if (e instanceof BodyError) return sendJson(res, e.status, { code: e.code, message: e.message });
    throw e;
  }
}
