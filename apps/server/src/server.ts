import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { ServerConfig } from "./config";
import { CsvEventSink, NoopEventSink, type EventSink } from "./events";
import { makeClientMessageSchema, type ServerMessage } from "./protocol";
import { RoomService, type Conn, type ServiceDeps } from "./service";
import { FileRoomLog, type RoomLog } from "./store";
import { join } from "node:path";

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
  const http: HttpServer = createHttpServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Gmers server");
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
