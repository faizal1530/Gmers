import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { z } from "zod";
import { WebSocketServer, type WebSocket } from "ws";
import { AccountService, FileAccountLog, isAuthError, type AccountLog } from "./accounts";
import { realClock, type Clock } from "./clock";
import { COMMUNITIES, Community, FileCommunityLog, type CommunityLog } from "./community";
import { FileShopLog, Shop, type ShopLog } from "./shop";
import { Ledger, FileLedgerLog, type LedgerLog } from "./ledger";
import { Progress } from "./progress";
import { FileSocialLog, Social, type SocialLog, type Status } from "./social";
import { SocialHub } from "./socialhub";
import type { ServerConfig } from "./config";
import { CsvEventSink, NoopEventSink, type EventSink } from "./events";
import { makeClientMessageSchema, type ServerMessage } from "./protocol";
import { RoomService, type Conn, type ServiceDeps } from "./service";
import { FileRoomLog, type RoomLog } from "./store";

export interface GmersServer {
  port: number;
  service: RoomService;
  accounts: AccountService;
  ledger: Ledger;
  progress: Progress;
  social: Social;
  hub: SocialHub;
  community: Community;
  shop: Shop;
  close(): Promise<void>;
}

export interface ServerDeps extends ServiceDeps {
  accountLog?: AccountLog;
  ledgerLog?: LedgerLog;
  socialLog?: SocialLog;
  communityLog?: CommunityLog;
  shopLog?: ShopLog;
  log?: RoomLog;
  events?: EventSink;
}

export async function startServer(config: ServerConfig, deps: ServerDeps = {}): Promise<GmersServer> {
  const log = deps.log ?? new FileRoomLog(join(config.dataDir, config.roomLogFile));
  const events = deps.events ?? (config.eventsCsvFile ? new CsvEventSink(join(config.dataDir, config.eventsCsvFile)) : new NoopEventSink());
  // eslint-disable-next-line prefer-const -- service dibuat setelah accounts, keduanya saling merujuk lewat closure
  let service: RoomService;
  // eslint-disable-next-line prefer-const -- dideklarasikan lebih dulu karena dipakai closure sebelum diisi
  let social: Social;
  // eslint-disable-next-line prefer-const -- sama: dipakai closure penghapusan akun sebelum dibuat
  let community: Community;
  const accounts = new AccountService(config, deps.accountLog ?? new FileAccountLog(join(config.dataDir, config.accountsFile)), deps.clock ?? realClock, (h) => service.groupsOf(h), (id) => {
    social.purge(id);
    community.purge(id);
  });
  const clock = deps.clock ?? realClock;
  const ledger = new Ledger(deps.ledgerLog ?? new FileLedgerLog(join(config.dataDir, config.ledgerFile)), () => clock.now());
  const progress = new Progress(ledger, config.economy);
  social = new Social(deps.socialLog ?? new FileSocialLog(join(config.dataDir, config.socialFile)), clock);
  community = new Community({
    log: deps.communityLog ?? new FileCommunityLog(join(config.dataDir, config.communityFile)),
    clock,
    profileOf: (id) => {
      const p = accounts.profileOf(id);
      return p ? { username: p.username, name: p.name } : null; // id akun internal tidak boleh keluar
    },
    isBlocked: (a, b) => social.isBlocked(a, b),
    follows: (a, b) => social.relation(a, b).iFollow,
  });
  const shop = new Shop(ledger, deps.shopLog ?? new FileShopLog(join(config.dataDir, config.shopFile)), clock);
  const hub = new SocialHub(config, clock, social, accounts, (c) => service.roomOfConn(c as never));
  service = new RoomService(config, {
    ...deps,
    log,
    events,
    onSeat: (h, g) => accounts.noteGroup(h, g),
    hooks: {
      authenticate: (session) => accounts.identify(session),
      accountIdOf: (h) => accounts.accountIdByTokenHash(h),
      settle: (input) => {
        const rewards = progress.settle(input);
        hub.recordGame(input.players.flatMap((p) => (p.accountId ? [p.accountId] : [])), input.ts);
        return rewards;
      },
      social: hub as never,
    },
  });
  service.start();

  const schema = makeClientMessageSchema(config);
  const csvPath = config.eventsCsvFile ? join(config.dataDir, config.eventsCsvFile) : null;
  const http: HttpServer = createHttpServer((req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (path.startsWith("/api/") || path === "/admin/accounts/reset" || path === "/admin/reports") {
      handleApi({ config, accounts, progress, social, hub, community, shop, service, clock, apiHits }, req, res, path).catch(() => sendJson(res, 500, { code: "SERVER_ERROR", message: "Terjadi kesalahan di server. Coba lagi." }));
      return;
    }
    try {
      handleHttp(config, csvPath, req, res);
    } catch {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Kesalahan server.");
    }
  });
  const apiHits = new Map<string, number[]>();
  const wss = new WebSocketServer({ server: http, maxPayload: config.maxMessageBytes });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on("connection", (ws) => {
    // Alamat IP klien sengaja tidak dibaca atau disimpan.
    const conn: Conn = {
      id: randomUUID(),
      session: null,
      account: null,
      send(msg: ServerMessage) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close(code, reason) {
        ws.close(code, reason);
      },
    };
    alive.set(ws, true);
    let wsTimes: number[] = [];
    let wsOver = 0;
    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", (data) => {
      alive.set(ws, true);
      // Pembatas banjir pesan per sambungan (tanpa IP): buang kelebihan, putuskan bila terus membanjir.
      const nowMs = clock.now();
      wsTimes = wsTimes.filter((t) => nowMs - t < config.wsWindowMs);
      if (wsTimes.length >= config.wsBurst) {
        wsOver++;
        if (wsOver > config.wsBurst) ws.close(1008, "terlalu banyak pesan");
        else if (wsOver === 1) conn.send({ type: "error", code: "RATE_LIMITED", message: "Terlalu banyak pesan. Pelan-pelan ya." });
        return;
      }
      wsOver = 0;
      wsTimes.push(nowMs);
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

  // Pengingat streak: dicek tiap jam; aturan jam (18.00-22.00 WIB) dan batas 1 per hari ada di hub.
  let cancelReminder: (() => void) | null = null;
  const scheduleReminder = (): void => {
    cancelReminder = clock.setTimeout(() => {
      hub.remindStreaks();
      scheduleReminder();
    }, 3_600_000);
  };
  scheduleReminder();
  const cancelReminders = (): void => cancelReminder?.();

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
    ledger,
    progress,
    social,
    hub,
    community,
    shop,
    async close() {
      cancelReminders();
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
  ".apk": "application/vnd.android.package-archive",
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
      ...(extname(file) === ".apk" ? { "content-disposition": `attachment; filename="${file.slice(file.lastIndexOf(sep) + 1)}"` } : {}),
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
  relation: z.object({ username: z.string().trim().min(1).max(40), on: z.boolean() }).strict(),
  report: z.object({ kind: z.enum(["user", "post"]), target: z.string().trim().min(1).max(60), reason: z.string().trim().max(300).optional() }).strict(),
  status: z.object({ status: z.enum(["siap", "sibuk", "senyap", "dnd"]) }).strict(),
  prefs: z.object({ invite: z.boolean().optional(), follow: z.boolean().optional(), streak: z.boolean().optional(), dm: z.boolean().optional() }).strict(),
  post: z.object({ text: z.string().max(2000), comm: z.string().max(20).nullable().optional() }).strict(),
  reply: z.object({ text: z.string().max(1000) }).strict(),
  toggle: z.object({ on: z.boolean() }).strict(),
  item: z.object({ item: z.string().trim().min(1).max(40) }).strict(),
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

interface ApiCtx {
  clock: Clock;
  apiHits: Map<string, number[]>;
  community: Community;
  shop: Shop;
  service: RoomService;
  config: ServerConfig;
  accounts: AccountService;
  progress: Progress;
  social: Social;
  hub: SocialHub;
}

async function handleApi(ctx: ApiCtx, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const { config, accounts, progress, social, hub, community, shop, service, clock } = ctx;
  const method = req.method ?? "GET";
  try {
    if (path === "/admin/reports") {
      if (method !== "GET") return sendJson(res, 405, { code: "METHOD", message: "Metode tidak diizinkan." });
      if (!config.adminToken) return sendJson(res, 503, { code: "DISABLED", message: "Dimatikan: ADMIN_TOKEN belum diatur." });
      if (!tokensMatch(bearer(req), config.adminToken)) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Tidak diizinkan." });
      return sendJson(res, 200, {
        reports: social.reports.map((r) => ({ id: r.id, ts: r.ts, kind: r.kind, target: r.target, reason: r.reason, from: accounts.profileOf(r.from)?.username ?? "(dihapus)" })),
      });
    }
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
    /** Sertakan dompet (Trofi, Bintang, Koin, kelas) milik sesi pada jawaban. */
    const walletOf = (sess: string | null): unknown => {
      const id = accounts.idOfSession(sess);
      return id ? progress.wallet(id) : null;
    };
    const meId = accounts.idOfSession(session);
    if (meId) {
      // Batas permintaan per akun (tanpa IP): geser jendela 1 menit.
      const t = clock.now();
      const hits = (ctx.apiHits.get(meId) ?? []).filter((x) => t - x < 60_000);
      if (hits.length >= config.apiPerMinute) return sendJson(res, 429, { code: "RATE_LIMITED", message: "Terlalu banyak permintaan. Coba lagi sebentar lagi." });
      hits.push(t);
      ctx.apiHits.set(meId, hits);
    }
    if (path === "/api/communities" || path === "/api/feed" || path.startsWith("/api/posts") || path.startsWith("/api/replies") || path.startsWith("/api/shop") || path === "/api/live") {
      if (!meId) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
      const fail = (r: { code: string; message: string }): void => sendJson(res, r.code === "NOT_FOUND" ? 404 : r.code === "RATE_LIMIT" ? 429 : r.code === "INSUFFICIENT" ? 402 : 400, { code: r.code, message: r.message });
      const url = new URL(req.url ?? "/", "http://localhost");
      if (route === "GET /api/communities") return sendJson(res, 200, { communities: COMMUNITIES });
      if (route === "GET /api/feed") {
        const tab = url.searchParams.get("tab") ?? "untukmu";
        const comm = url.searchParams.get("comm");
        const bf = Number(url.searchParams.get("before"));
        if (!["untukmu", "mengikuti", "tersimpan"].includes(tab) || (comm !== null && !COMMUNITIES.some((c) => c.id === comm))) return sendJson(res, 400, { code: "BAD_REQUEST", message: "Data tidak valid." });
        const feed = community.feed(meId, tab as "untukmu" | "mengikuti" | "tersimpan", comm, Number.isFinite(bf) && bf > 0 ? bf : null);
        return sendJson(res, 200, { ...feed, suggestions: tab === "untukmu" && !comm && !url.searchParams.has("before") ? community.suggestions(meId) : [] });
      }
      if (route === "POST /api/posts") {
        const b = parseBody(schemas.post, await readJson(req));
        const r = community.post(meId, b.text, b.comm ?? null);
        return r.ok ? sendJson(res, 200, r) : fail(r);
      }
      const m = /^\/api\/(posts|replies)\/([0-9a-f]{12})(?:\/(replies|like|save|hide))?$/.exec(path);
      if (m) {
        const [, kind, pid, action] = m as unknown as [string, string, string, string | undefined];
        if (method === "GET" && kind === "posts" && !action) {
          const r = community.replies(meId, pid);
          return r ? sendJson(res, 200, r) : fail({ code: "NOT_FOUND", message: "Kiriman tidak ditemukan." });
        }
        if (method === "DELETE" && !action) {
          const r = community.remove(meId, pid);
          return r.ok ? sendJson(res, 200, r) : fail(r);
        }
        if (method === "POST" && kind === "posts") {
          if (action === "replies") {
            const b = parseBody(schemas.reply, await readJson(req));
            const r = community.reply(meId, pid, b.text);
            return r.ok ? sendJson(res, 200, r) : fail(r);
          }
          if (action === "like" || action === "save") {
            const b = parseBody(schemas.toggle, await readJson(req));
            const r = action === "like" ? community.like(meId, pid, b.on) : community.save(meId, pid, b.on);
            return r.ok ? sendJson(res, 200, r) : fail(r);
          }
          if (action === "hide") {
            const r = community.hide(meId, pid);
            return r.ok ? sendJson(res, 200, r) : fail(r);
          }
        }
      }
      if (route === "GET /api/shop") return sendJson(res, 200, shop.state(meId));
      if (route === "POST /api/shop/claim" || route === "POST /api/shop/buy" || route === "POST /api/shop/equip") {
        const r = route.endsWith("claim") ? shop.claim(meId) : route.endsWith("buy") ? shop.buy(meId, parseBody(schemas.item, await readJson(req)).item) : shop.equip(meId, parseBody(schemas.item, await readJson(req)).item);
        return r.ok ? sendJson(res, 200, { ok: true, shop: shop.state(meId), wallet: progress.wallet(meId) }) : sendJson(res, r.code === "INSUFFICIENT" ? 402 : r.code === "NOT_FOUND" ? 404 : 409, { code: r.code, message: r.message });
      }
      if (route === "GET /api/live") return sendJson(res, 200, { rooms: service.liveList() });
    }

    switch (route) {
      case "POST /api/register": {
        const b = parseBody(schemas.register, await readJson(req));
        const r = await accounts.register({ username: b.username, password: b.password, name: b.name ?? b.username.slice(0, 16), token: b.token });
        return out(isAuthError(r) ? r : { ...r, wallet: walletOf(r.session) });
      }
      case "POST /api/login": {
        const b = parseBody(schemas.login, await readJson(req));
        const r = await accounts.login(b);
        return out(isAuthError(r) ? r : { ...r, wallet: walletOf(r.session) });
      }
      case "POST /api/logout":
        accounts.logout(session);
        return sendJson(res, 200, { ok: true });
      case "GET /api/me": {
        const me = accounts.me(session);
        return me ? sendJson(res, 200, { account: me, wallet: walletOf(session) }) : sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
      }
      case "GET /api/friends": {
        const me = accounts.idOfSession(session);
        if (!me) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
        const rel = social.related(me);
        const card = (id: string) => {
          const p = accounts.profileOf(id);
          return p ? { username: p.username, name: p.name } : null;
        };
        const friends = rel.friends.flatMap((id) => {
          const p = accounts.profileOf(id);
          if (!p) return [];
          const st = social.streak(me, id);
          return [{ username: p.username, name: p.name, kelas: progress.wallet(id).kelas, online: hub.isOnline(id), status: social.status(id), streak: { count: st.count, doneToday: st.doneToday } }];
        });
        const list = (ids: string[]) => ids.flatMap((id) => card(id) ?? []);
        return sendJson(res, 200, { friends, waiting: list(rel.waiting), incoming: list(rel.incoming), blocked: list(rel.blocked), status: social.status(me), prefs: social.prefsOf(me) });
      }
      case "GET /api/users": {
        const me = accounts.idOfSession(session);
        if (!me) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
        const u = new URL(req.url ?? "/", "http://localhost").searchParams.get("username") ?? "";
        const other = u ? accounts.byUsername(u) : null;
        if (!other || other.id === me || social.isBlocked(me, other.id)) return sendJson(res, 404, { code: "NOT_FOUND", message: "Pengguna tidak ditemukan." });
        return sendJson(res, 200, { user: { username: other.username, name: other.name, kelas: progress.wallet(other.id).kelas, relation: social.relation(me, other.id) } });
      }
      case "POST /api/follow":
      case "POST /api/contact":
      case "POST /api/block": {
        const me = accounts.idOfSession(session);
        if (!me) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
        const b = parseBody(schemas.relation, await readJson(req));
        const other = accounts.byUsername(b.username);
        if (!other || other.id === me) return sendJson(res, 404, { code: "NOT_FOUND", message: "Pengguna tidak ditemukan." });
        const kind = path.slice("/api/".length);
        const ok = kind === "follow" ? social.follow(me, other.id, b.on) : kind === "contact" ? social.saveContact(me, other.id, b.on) : social.block(me, other.id, b.on);
        if (!ok) return sendJson(res, 403, { code: "BLOCKED", message: "Tidak bisa melakukan itu pada pengguna ini." });
        if (kind === "follow" && b.on) hub.notify(other.id, "follow", `${accounts.profileOf(me)?.name ?? "Seseorang"} mengikutimu`);
        return sendJson(res, 200, { relation: social.relation(me, other.id) });
      }
      case "POST /api/report": {
        const me = accounts.idOfSession(session);
        if (!me) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
        const b = parseBody(schemas.report, await readJson(req));
        const dayAgo = clock.now() - 86_400_000;
        if (social.reports.filter((r) => r.from === me && r.ts > dayAgo).length >= config.reportsPerDay) return sendJson(res, 429, { code: "RATE_LIMITED", message: "Batas laporan harian tercapai." });
        social.report(me, b.kind, b.target, b.reason ?? "");
        return sendJson(res, 200, { ok: true });
      }
      case "PUT /api/status": {
        const me = accounts.idOfSession(session);
        if (!me) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
        const b = parseBody(schemas.status, await readJson(req));
        hub.setStatus(me, b.status as Status);
        return sendJson(res, 200, { status: social.status(me) });
      }
      case "PUT /api/notif-prefs": {
        const me = accounts.idOfSession(session);
        if (!me) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
        const b = parseBody(schemas.prefs, await readJson(req));
        return sendJson(res, 200, { prefs: social.setPrefs(me, b) });
      }
      case "GET /api/notices": {
        const me = accounts.idOfSession(session);
        if (!me) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
        return sendJson(res, 200, { notices: hub.feed(me).slice().reverse() });
      }
      case "POST /api/notices/read": {
        const me = accounts.idOfSession(session);
        if (!me) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
        hub.markRead(me);
        return sendJson(res, 200, { ok: true });
      }
      case "GET /api/leaderboard": {
        const me = accounts.idOfSession(session);
        if (!me) return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Silakan masuk lagi." });
        const rows = progress.leaderboard(20).flatMap((row, i) => {
          const n = accounts.nameOf(row.accountId);
          const w = progress.wallet(row.accountId);
          return n ? [{ rank: i + 1, name: n.name, kelas: w.kelas, trofi: row.trofi, isYou: row.accountId === me }] : [];
        });
        const mine = progress.wallet(me);
        const all = progress.leaderboard(100000);
        const pos = all.findIndex((r) => r.accountId === me);
        return sendJson(res, 200, { rows, you: { rank: pos >= 0 ? pos + 1 : null, trofi: mine.trofi, kelas: mine.kelas } });
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
