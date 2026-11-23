import { describe, expect, it } from "vitest";
import { defaultServerConfig } from "../src/config";
import { makeClientMessageSchema } from "../src/protocol";
import { tok } from "./support";

const schema = makeClientMessageSchema(defaultServerConfig);

describe("skema pesan klien", () => {
  it("menerima pesan valid dan merapikan nama dan roomId", () => {
    const r = schema.parse({ type: "join", groupId: " ab12cd ", name: "  Budi   Santoso ", token: tok(1) });
    expect(r).toMatchObject({ groupId: "AB12CD", name: "Budi Santoso" });
    expect(schema.parse({ type: "play", card: [2, 5], end: "left" })).toEqual({ type: "play", card: [2, 5], end: "left" });
    expect(schema.parse({ type: "pass" })).toEqual({ type: "pass" });
    expect(schema.parse({ type: "ping" })).toEqual({ type: "ping" });
  });

  it.each([
    ["tipe tak dikenal", { type: "hack" }],
    ["token terlalu pendek", { type: "create_room", name: "A", token: "abc" }],
    ["nama kosong", { type: "create_room", name: "   ", token: tok(1) }],
    ["open_link tanpa token", { type: "open_link", groupId: "ABCDEF" }],
    ["nama terlalu panjang", { type: "create_room", name: "x".repeat(17), token: tok(1) }],
    ["nama terlalu pendek", { type: "create_room", name: "A", token: tok(1) }],
    ["nama berisi karakter kontrol", { type: "create_room", name: "ab\u0000cd", token: tok(1) }],
    ["kartu di luar rentang", { type: "play", card: [7, 1], end: "left" }],
    ["ujung salah", { type: "play", card: [1, 2], end: "middle" }],
    ["kartu bukan bilangan bulat", { type: "play", card: [1.5, 2], end: "left" }],
    ["kunci tambahan", { type: "pass", seat: 2 }],
    ["chat kosong", { type: "chat", text: "  " }],
    ["chat terlalu panjang", { type: "chat", text: "x".repeat(301) }],
    ["kursi di luar rentang", { type: "join", groupId: "ABCDEF", name: "Ana", token: tok(1), seat: 9 }],
  ])("menolak: %s", (_label, msg) => {
    expect(schema.safeParse(msg).success).toBe(false);
  });
});
