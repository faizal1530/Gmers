import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, type GmersServer } from "../src/server";
import { testConfig, tok } from "./support";

const servers: GmersServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function boot(over: Parameters<typeof testConfig>[0] = {}) {
  const cfg = testConfig(over);
  const server = await startServer(cfg);
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const call = async (method: string, path: string, body?: unknown, session?: string | null, headers: Record<string, string> = {}) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(session ? { authorization: `Bearer ${session}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // bukan JSON
    }
    return { status: r.status, json, text, headers: r.headers };
  };
  return { cfg, server, base, call };
}

const reg = (username = "andi", extra: Record<string, unknown> = {}) => ({ username, password: "rahasia123", name: "Andi", token: tok(1), ...extra });

describe("API akun", () => {
  it("daftar, lihat profil, ubah profil, masuk dari perangkat lain, keluar", async () => {
    const { call } = await boot();
    const r = await call("POST", "/api/register", reg());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const session = r.json.session as string;
    expect((r.json.account as Record<string, unknown>).token).toBe(tok(1));

    const me = await call("GET", "/api/me", undefined, session);
    expect(me.json.account).toMatchObject({ username: "andi", name: "Andi" });

    const put = await call("PUT", "/api/me", { name: "Andi Baru", prefs: { theme: "dark", sound: false } }, session);
    expect(put.json.account).toMatchObject({ name: "Andi Baru", prefs: { theme: "dark", sound: false } });

    const login = await call("POST", "/api/login", { username: "ANDI", password: "rahasia123" });
    expect(login.status).toBe(200);
    expect((login.json.account as Record<string, unknown>).name).toBe("Andi Baru");
    const s2 = login.json.session as string;
    expect(s2).not.toBe(session);

    expect((await call("POST", "/api/logout", {}, session)).status).toBe(200);
    expect((await call("GET", "/api/me", undefined, session)).status).toBe(401);
    expect((await call("GET", "/api/me", undefined, s2)).status).toBe(200); // perangkat lain tetap masuk
  });

  it("validasi: pesan Indonesia per kolom", async () => {
    const { call } = await boot();
    const cases: [Record<string, unknown>, RegExp][] = [
      [reg("ab"), /Nama pengguna 3 sampai 20/],
      [reg("nama pengguna"), /Nama pengguna 3 sampai 20/],
      [reg("andi", { password: "pendek" }), /Kata sandi 8 sampai 128/],
      [reg("andi", { name: "A" }), /Nama panggilan 2 sampai 16/],
      [reg("andi", { token: "x" }), /Perangkat tidak dikenali/],
      [reg("andi", { dataTambahan: 1 }), /Data tidak valid/],
    ];
    for (const [body, msg] of cases) {
      const r = await call("POST", "/api/register", body);
      expect(r.status).toBe(400);
      expect(r.json.message).toMatch(msg);
    }
  });

  it("nama pengguna kembar 409; masuk salah 401 dengan pesan generik; kunci 429", async () => {
    const { call } = await boot({ loginMaxFails: 3 });
    await call("POST", "/api/register", reg());
    expect((await call("POST", "/api/register", reg("Andi", { token: tok(2) }))).status).toBe(409);
    const bad = await call("POST", "/api/login", { username: "andi", password: "salah-salah" });
    const none = await call("POST", "/api/login", { username: "hantu", password: "salah-salah" });
    expect(bad.status).toBe(401);
    expect(none.json).toEqual(bad.json);
    await call("POST", "/api/login", { username: "andi", password: "salah-salah" });
    await call("POST", "/api/login", { username: "andi", password: "salah-salah" });
    expect((await call("POST", "/api/login", { username: "andi", password: "rahasia123" })).status).toBe(429);
  });

  it("ganti kata sandi dan hapus akun lewat API", async () => {
    const { call } = await boot();
    const session = (await call("POST", "/api/register", reg())).json.session as string;
    expect((await call("POST", "/api/me/password", { oldPassword: "salah", newPassword: "kata-baru-123" }, session)).status).toBe(401);
    expect((await call("POST", "/api/me/password", { oldPassword: "rahasia123", newPassword: "kata-baru-123" }, session)).status).toBe(200);
    expect((await call("POST", "/api/login", { username: "andi", password: "kata-baru-123" })).status).toBe(200);
    expect((await call("DELETE", "/api/me", { password: "salah" }, session)).status).toBe(401);
    expect((await call("DELETE", "/api/me", { password: "kata-baru-123" }, session)).status).toBe(200);
    expect((await call("GET", "/api/me", undefined, session)).status).toBe(401);
    expect((await call("POST", "/api/login", { username: "andi", password: "kata-baru-123" })).status).toBe(401);
  });

  it("butuh sesi untuk profil; bentuk permintaan dijaga (JSON, ukuran, JSON rusak, metode, jalur)", async () => {
    const { call } = await boot();
    expect((await call("GET", "/api/me")).status).toBe(401);
    expect((await call("PUT", "/api/me", { name: "Budi" })).status).toBe(401);
    expect((await call("POST", "/api/register", "teks biasa", null, { "content-type": "text/plain" })).status).toBe(415);
    expect((await call("POST", "/api/register", "{rusak")).status).toBe(400);
    expect((await call("POST", "/api/register", reg("andi", { name: "x".repeat(6000) }))).status).toBe(413);
    expect((await call("GET", "/api/register")).status).toBe(404);
    expect((await call("GET", "/api/tidak-ada")).status).toBe(404);
  });

  it("reset admin: tanpa ADMIN_TOKEN 503, token salah 401, benar mengganti kata sandi dan mencabut sesi", async () => {
    const off = await boot({ adminToken: null });
    expect((await off.call("POST", "/admin/accounts/reset", { username: "andi", newPassword: "kata-baru-123" })).status).toBe(503);
    const { call } = await boot({ adminToken: "token-admin-uji-123456" });
    const session = (await call("POST", "/api/register", reg())).json.session as string;
    const body = { username: "andi", newPassword: "kata-admin-123" };
    expect((await call("POST", "/admin/accounts/reset", body)).status).toBe(401);
    expect((await call("POST", "/admin/accounts/reset", body, "salah")).status).toBe(401);
    expect((await call("GET", "/admin/accounts/reset")).status).toBe(405);
    expect((await call("POST", "/admin/accounts/reset", body, "token-admin-uji-123456")).status).toBe(200);
    expect((await call("GET", "/api/me", undefined, session)).status).toBe(401);
    expect((await call("POST", "/api/login", { username: "andi", password: "kata-admin-123" })).status).toBe(200);
    expect((await call("POST", "/admin/accounts/reset", { username: "hantu", newPassword: "kata-admin-123" }, "token-admin-uji-123456")).status).toBe(404);
  });

  it("berkas akun di disk tidak memuat kata sandi polos dan tidak bisa diambil lewat web", async () => {
    const { call, cfg } = await boot({ staticDir: null });
    await call("POST", "/api/register", reg("andi", { password: "sandi-rahasia-unik-777" }));
    const file = readFileSync(join(cfg.dataDir, cfg.accountsFile), "utf8");
    expect(file).not.toContain("sandi-rahasia-unik-777");
    expect(file).toContain('"username":"andi"');
    for (const p of ["/accounts.jsonl", "/data/accounts.jsonl", "/admin/accounts.jsonl"]) {
      expect((await call("GET", p)).text).not.toContain("andi");
    }
  });

  it("restart server: akun, sesi, dan daftar room tetap ada (sesi tidak kedaluwarsa)", async () => {
    const cfg = testConfig();
    const s1 = await startServer(cfg);
    const base1 = `http://127.0.0.1:${s1.port}`;
    const r = await (await fetch(`${base1}/api/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reg()) })).json() as { session: string };
    await s1.close();
    const s2 = await startServer(cfg);
    servers.push(s2);
    const me = await fetch(`http://127.0.0.1:${s2.port}/api/me`, { headers: { authorization: `Bearer ${r.session}` } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { account: { username: string } }).account.username).toBe("andi");
  });
});
