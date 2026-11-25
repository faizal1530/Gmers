import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer, type GmersServer } from "../src/server";
import { testConfig, tok } from "./support";

const servers: GmersServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function boot(over: Parameters<typeof testConfig>[0] = {}) {
  const server = await startServer(testConfig(over));
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const call = async (method: string, path: string, body?: unknown, session?: string | null) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(session ? { authorization: `Bearer ${session}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const t = await r.text();
    return { status: r.status, json: (t ? JSON.parse(t) : {}) as Record<string, unknown> };
  };
  const mk = async (u: string, i: number): Promise<string> => (await call("POST", "/api/register", { username: u, password: "rahasia123", name: u, token: tok(i) })).json.session as string;
  return { server, base, call, mk };
}

describe("pengerasan", () => {
  it("batas permintaan HTTP per akun: kelebihan 429, akun lain tidak terpengaruh", async () => {
    const { call, mk } = await boot({ apiPerMinute: 5 });
    const a = await mk("andi", 1);
    const b = await mk("budi", 2);
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await call("GET", "/api/me", undefined, a)).status);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes.slice(5).every((c) => c === 429)).toBe(true);
    expect((await call("GET", "/api/me", undefined, b)).status).toBe(200);
  });

  it("batas laporan harian per akun", async () => {
    const { call, mk } = await boot({ reportsPerDay: 2 });
    const a = await mk("andi", 1);
    const r = (): Promise<{ status: number }> => call("POST", "/api/report", { kind: "user", target: "budi", reason: "x" }, a);
    expect((await r()).status).toBe(200);
    expect((await r()).status).toBe(200);
    expect((await r()).status).toBe(429);
  });

  it("banjir pesan WebSocket: kelebihan dibuang dengan satu peringatan, lalu sambungan diputus", async () => {
    const { server } = await boot({ wsBurst: 5, wsWindowMs: 60_000 });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const got: { type: string; code?: string }[] = [];
    ws.on("message", (d) => got.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));
    const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
    for (let i = 0; i < 30; i++) ws.send(JSON.stringify({ type: "ping" }));
    expect(await closed).toBe(1008);
    expect(got.filter((m) => m.type === "pong")).toHaveLength(5);
    expect(got.filter((m) => m.code === "RATE_LIMITED")).toHaveLength(1);
  });
});
