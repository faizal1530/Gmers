import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRng } from "@gmers/game-engine";
import { startServer, type GmersServer } from "../src/server";
import { Client, assertStateShape, autoplay, testConfig, tok } from "./support";

const ROOMS = 50;

describe(`beban sederhana: ${ROOMS} room bersamaan`, () => {
  let server: GmersServer;
  const all: Client[] = [];
  beforeAll(async () => {
    let seed = 0;
    server = await startServer(testConfig({ maxRooms: 1000 }), { newSeed: () => `beban-${seed++}` });
  });
  afterAll(async () => {
    for (const c of all) c.ws.terminate();
    await server.close();
  });

  it("semua room selesai tanpa kesalahan", async () => {
    const t0 = Date.now();
    const runRoom = async (r: number): Promise<{ players: number; reason: string; moves: number }> => {
      const n = 2 + (r % 3);
      const clients: Client[] = [];
      const host = await Client.connect(server.port);
      all.push(host);
      clients.push(host);
      host.send({ type: "create_room", name: `H${r}`, token: tok(`${r}-0`) });
      const roomId = (await host.waitState(() => true)).room.id;
      for (let i = 1; i < n; i++) {
        const c = await Client.connect(server.port);
        all.push(c);
        clients.push(c);
        c.send({ type: "join", groupId: roomId, name: `P${r}-${i}`, token: tok(`${r}-${i}`) });
        await c.waitState((s) => s.you.seat === i);
      }
      const rng = createRng(`beban-bot-${r}`);
      clients.forEach((c) => autoplay(c, rng));
      host.send({ type: "start" });
      const done = await host.waitState((s) => s.room.phase === "finished", 30_000);
      for (const c of clients) {
        expect(c.errors()).toEqual([]);
        for (const m of c.msgs) if (m.type === "state") assertStateShape(m);
      }
      return { players: n, reason: done.game!.result!.reason, moves: done.game!.moveCount };
    };

    const results = await Promise.all(Array.from({ length: ROOMS }, (_, r) => runRoom(r)));
    const ms = Date.now() - t0;
    const sockets = results.reduce((s, x) => s + x.players, 0);
    const moves = results.reduce((s, x) => s + x.moves, 0);
    console.log(`beban: ${ROOMS} room, ${sockets} koneksi, ${moves} langkah, selesai dalam ${ms} ms`);
    expect(results).toHaveLength(ROOMS);
    expect(results.every((x) => x.reason === "out" || x.reason === "blocked")).toBe(true);
    expect([...server.service.rooms.values()].map((r) => r.phase).filter((p) => p !== "finished")).toEqual([]);
    expect(server.service.rooms.size).toBe(ROOMS);
  });
});
