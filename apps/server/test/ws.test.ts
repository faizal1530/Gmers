import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRng } from "@gmers/game-engine";
import { startServer, type GmersServer } from "../src/server";
import { FileRoomLog } from "../src/store";
import { CSV_HEADER } from "../src/events";
import { Client, assertStateShape, autoplay, testConfig, tok } from "./support";
import type { ServerConfig } from "../src/config";

const servers: GmersServer[] = [];
const clients: Client[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function boot(overrides: Partial<ServerConfig> = {}, deps: Parameters<typeof startServer>[1] = {}): Promise<GmersServer> {
  const s = await startServer(testConfig(overrides), deps);
  servers.push(s);
  return s;
}

async function connect(port: number, opts?: { autoPong?: boolean }): Promise<Client> {
  const c = await Client.connect(port, opts);
  clients.push(c);
  return c;
}

/** Buat room dengan n pemain lewat WebSocket. */
async function seatPlayers(port: number, n: number): Promise<{ players: Client[]; roomId: string }> {
  const players: Client[] = [];
  const host = await connect(port);
  host.send({ type: "create_room", name: "P0", token: tok(0) });
  const roomId = (await host.waitState(() => true)).room.id;
  players.push(host);
  for (let i = 1; i < n; i++) {
    const c = await connect(port);
    c.send({ type: "join", roomId, name: `P${i}`, token: tok(i) });
    await c.waitState((s) => s.you.seat === i);
    players.push(c);
  }
  return { players, roomId };
}

describe("game penuh lewat WebSocket", () => {
  for (const n of [2, 3, 4]) {
    it(`${n} klien menyelesaikan game sampai kartu habis dan sampai terkunci, tanpa kesalahan protokol`, async () => {
      let counter = 0;
      const server = await boot({}, { newSeed: () => `ws-${n}-${counter++}` });
      const seen = new Set<string>();
      for (let game = 0; game < 40 && seen.size < 2; game++) {
        const { players } = await seatPlayers(server.port, n);
        const rng = createRng(`bot-${n}-${game}`);
        players.forEach((p) => autoplay(p, rng));
        players[0]!.send({ type: "start" });
        const done = await players[0]!.waitState((s) => s.room.phase === "finished");
        const result = done.game!.result!;
        seen.add(result.reason);
        expect(result.ranking.map((r) => r.rank)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        expect(new Set(result.ranking.map((r) => r.seat)).size).toBe(n);
        // semua klien melihat hasil yang sama, bentuk pesan sesuai daftar kunci, dan tidak ada kesalahan
        for (const p of players) {
          const s = await p.waitState((st) => st.room.phase === "finished");
          expect(s.game!.result).toEqual(result);
          expect(p.errors()).toEqual([]);
          for (const m of p.msgs) if (m.type === "state") assertStateShape(m);
          p.ws.terminate();
        }
      }
      expect([...seen].sort()).toEqual(["blocked", "out"]);
    });
  }
});

describe("langkah ilegal lewat WebSocket", () => {
  it("langkah di luar giliran dan kartu bukan milik ditolak; state tidak berubah", async () => {
    const server = await boot({}, { newSeed: () => "ilegal" });
    const { players, roomId } = await seatPlayers(server.port, 3);
    players[0]!.send({ type: "start" });
    await players[0]!.waitState((s) => s.room.phase === "playing");
    const room = server.service.rooms.get(roomId)!;
    const before = JSON.stringify(room.game!.state);
    const turnSeat = room.game!.roomSeats[room.game!.state.turn]!;
    const other = players[(turnSeat + 1) % 3]!;
    other.send({ type: "pass" });
    await other.waitFor(() => other.errors().find((e) => e.code === "NOT_YOUR_TURN"));
    const mine = players[turnSeat]!;
    mine.send({ type: "play", card: [6, 6], end: "right" });
    mine.send({ type: "chat" });
    await mine.waitFor(() => mine.errors().length >= 2);
    expect(JSON.stringify(room.game!.state)).toBe(before);
  });

  it("JSON rusak, skema salah, dan muatan terlalu besar", async () => {
    const server = await boot({ maxMessageBytes: 1024 });
    const c = await connect(server.port);
    c.ws.send("bukan json");
    c.send({ type: "hack" });
    await c.waitFor(() => c.errors().length >= 2);
    expect(c.errors().map((e) => e.code)).toEqual(["BAD_MESSAGE", "BAD_MESSAGE"]);
    expect(c.errors()[0]!.message).toMatch(/Pesan/);
    c.ws.send("x".repeat(5000));
    await c.waitFor(() => c.closed);
    expect(c.closeCode).toBe(1009);
  });

  it("ping aplikasi dibalas pong", async () => {
    const server = await boot();
    const c = await connect(server.port);
    c.send({ type: "ping" });
    const pong = await c.waitFor(() => c.msgs.find((m) => m.type === "pong"));
    expect(pong).toMatchObject({ type: "pong" });
  });
});

describe("putus dan sambung ulang lewat WebSocket", () => {
  it("klien yang putus ditandai terputus; sambung dengan token yang sama memulihkan state yang sama", async () => {
    const server = await boot({}, { newSeed: () => "sambung" });
    const { players, roomId } = await seatPlayers(server.port, 3);
    players[0]!.send({ type: "start" });
    await players[0]!.waitState((s) => s.room.phase === "playing");
    const room = server.service.rooms.get(roomId)!;
    // mainkan beberapa langkah
    for (let i = 0; i < 4; i++) {
      const seat = room.game!.roomSeats[room.game!.state.turn]!;
      const p = players[seat]!;
      const s = await p.waitState((st) => st.game?.turn === st.you.seat && st.game.moveCount === i);
      p.send(s.game!.yourMoves[0]!);
      await p.waitState((st) => (st.game?.moveCount ?? 0) > i);
    }
    const victim = players[1]!;
    const vs = await victim.waitState((s) => (s.game?.moveCount ?? 0) >= 4);
    victim.ws.terminate();
    await players[0]!.waitState((s) => s.room.seats[1]?.connected === false);

    const back = await connect(server.port);
    back.send({ type: "join", roomId, name: "x", token: tok(1) });
    const s = await back.waitState((st) => st.you.seat === 1);
    expect(s.game!.yourHand).toEqual(vs.game!.yourHand);
    expect(s.game!.board).toEqual(vs.game!.board);
    expect(s.game!.moveCount).toBe(vs.game!.moveCount);
    await players[0]!.waitState((st) => st.room.seats[1]?.connected === true);
  });

  it("heartbeat memutus klien yang tidak membalas ping", async () => {
    const server = await boot({ heartbeatIntervalMs: 80 });
    const { players, roomId } = await seatPlayers(server.port, 2);
    const zombie = await connect(server.port, { autoPong: false });
    zombie.send({ type: "join", roomId, name: "Z", token: tok(5) });
    await zombie.waitState((s) => s.you.seat === 2);
    await players[0]!.waitState((s) => s.room.seats[2]?.connected === true);
    await zombie.waitFor(() => zombie.closed, 3000);
    await players[0]!.waitState((s) => s.room.seats[2]?.connected === false, 3000);
  });
});

describe("restart server di tengah game (log berkas nyata)", () => {
  it("room dibangun ulang dari log JSONL; pemain sambung ulang dan game dilanjutkan sampai selesai; CSV tercatat", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gmers-"));
    dirs.push(dir);
    const cfg = { dataDir: dir, eventsCsvFile: "events.csv", turnTimeoutMs: 60_000 };
    const s1 = await startServer(testConfig(cfg), { newSeed: () => "restart-seed" });
    const { players, roomId } = await seatPlayers(s1.port, 3);
    players[0]!.send({ type: "start" });
    const room1 = s1.service.rooms.get(roomId)!;
    await players[0]!.waitState((s) => s.room.phase === "playing");
    for (let i = 0; i < 6; i++) {
      const seat = room1.game!.roomSeats[room1.game!.state.turn]!;
      const s = await players[seat]!.waitState((st) => st.game?.turn === st.you.seat && st.game.moveCount === i);
      players[seat]!.send(s.game!.yourMoves[0]!);
      await players[seat]!.waitState((st) => (st.game?.moveCount ?? 0) > i);
    }
    const hands = players.map((p) => p.state()!.game!.yourHand);
    const stateBefore = JSON.stringify(room1.game!.state);
    await s1.close();
    players.forEach((p) => p.ws.terminate());

    const s2 = await startServer(testConfig(cfg), { newSeed: () => "tak-dipakai" });
    servers.push(s2);
    expect(JSON.stringify(s2.service.rooms.get(roomId)!.game!.state)).toBe(stateBefore);

    const again: Client[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await connect(s2.port);
      c.send({ type: "join", roomId, name: "x", token: tok(i) });
      const st = await c.waitState((s) => s.you.seat === i);
      expect(st.game!.yourHand).toEqual(hands[i]);
      expect(st.game!.moveCount).toBe(6);
      again.push(c);
    }
    const rng = createRng("lanjut");
    again.forEach((c) => autoplay(c, rng));
    // pong/ping memicu autoplay untuk state yang sudah diterima
    for (const c of again) c.send({ type: "ping" });
    const fin = await again[0]!.waitState((s) => s.room.phase === "finished", 15_000);
    expect(fin.game!.result!.ranking).toHaveLength(3);

    const csv = readFileSync(join(dir, "events.csv"), "utf8").trim().split("\n");
    expect(csv[0]).toBe(CSV_HEADER);
    const names = csv.slice(1).map((l) => l.split(",")[4]);
    expect(names).toContain("room_created");
    expect(names).toContain("game_started");
    expect(names.filter((n) => n === "reconnected")).toHaveLength(3);
    expect(names).toContain("game_finished");
    expect(readFileSync(join(dir, "events.csv"), "utf8")).not.toMatch(/P0|P1|127\.0\.0\.1|token-perangkat/);
    const jsonl = new FileRoomLog(join(dir, "rooms.jsonl")).readAll();
    expect(jsonl.filter((r) => r.t === "move").length).toBeGreaterThanOrEqual(6);
  });
});
