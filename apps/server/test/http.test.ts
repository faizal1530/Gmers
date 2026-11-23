import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CSV_HEADER } from "../src/events";
import { startServer, tokensMatch, type GmersServer } from "../src/server";
import { loadConfig } from "../src/config";
import { testConfig } from "./support";

const servers: GmersServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

function site(): string {
  const dir = mkdtempSync(join(tmpdir(), "gmers-site-"));
  mkdirSync(join(dir, "assets"));
  writeFile(join(dir, "index.html"), "<!doctype html><title>Gmers</title>");
  writeFile(join(dir, "assets", "app-abc123.js"), "console.log(1)");
  writeFile(join(dir, "favicon.svg"), "<svg/>");
  return dir;
}
const writeFile = (p: string, c: string): void => writeFileSync(p, c);

async function boot(over: Parameters<typeof testConfig>[0] = {}): Promise<{ base: string; server: GmersServer; dataDir: string }> {
  const cfg = testConfig({ eventsCsvFile: "events.csv", ...over });
  const server = await startServer(cfg);
  servers.push(server);
  return { base: `http://127.0.0.1:${server.port}`, server, dataDir: cfg.dataDir };
}

describe("/healthz", () => {
  it("200 tanpa data sensitif", async () => {
    const { base } = await boot();
    const r = await fetch(`${base}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("ok");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("konfigurasi dari lingkungan (siap deploy)", () => {
  it("membaca PORT, DATA_DIR, HASH_SALT, ADMIN_TOKEN; host bawaan 0.0.0.0; tanpa token bawaan", () => {
    const c = loadConfig({ PORT: "4321", DATA_DIR: "/data", HASH_SALT: "garam-uji", ADMIN_TOKEN: "rahasia-uji" });
    expect(c).toMatchObject({ port: 4321, dataDir: "/data", hashSalt: "garam-uji", adminToken: "rahasia-uji", host: "0.0.0.0" });
    expect(loadConfig({}).adminToken).toBeNull();
    expect(loadConfig({}).port).toBe(8787);
    expect(() => loadConfig({ PORT: "abc" })).toThrow();
  });

  it("server benar-benar mendengarkan pada PORT dan memakai DATA_DIR untuk log", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "gmers-env-"));
    const cfg = loadConfig({ PORT: "0", DATA_DIR: dataDir, GMERS_HOST: "127.0.0.1", GMERS_STATIC_DIR: "" });
    const server = await startServer(cfg);
    servers.push(server);
    expect((await fetch(`http://127.0.0.1:${server.port}/healthz`)).status).toBe(200);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(dataDir, "events.csv"))).toBe(true);
  });
});

describe("ekspor /admin/events.csv", () => {
  it("tanpa ADMIN_TOKEN di server: dimatikan (503), tidak ada token bawaan", async () => {
    const { base } = await boot({ adminToken: null });
    expect((await fetch(`${base}/admin/events.csv`)).status).toBe(503);
    expect((await fetch(`${base}/admin/events.csv?token=`)).status).toBe(503);
    expect((await fetch(`${base}/admin/events.csv`, { headers: { authorization: "Bearer " } })).status).toBe(503);
  });

  it("menolak permintaan tanpa token atau dengan token salah (401) dan tidak membocorkan isi", async () => {
    const { base, dataDir } = await boot({ adminToken: "token-rahasia-panjang" });
    writeFileSync(join(dataDir, "events.csv"), `${CSV_HEADER}\n2026-11-23T10:00:00.000Z,x,G,R,dev,group_created,,\n`);
    for (const init of [
      {},
      { headers: { authorization: "Bearer salah" } },
      { headers: { authorization: "token-rahasia-panjang" } },
      { headers: { authorization: "Basic dG9rZW4tcmFoYXNpYS1wYW5qYW5n" } },
    ]) {
      const r = await fetch(`${base}/admin/events.csv`, init);
      expect(r.status).toBe(401);
      expect(await r.text()).not.toContain("group_created");
    }
    expect((await fetch(`${base}/admin/events.csv?token=salah`)).status).toBe(401);
    expect((await fetch(`${base}/admin/events.csv?token=token-rahasia-panjang-x`)).status).toBe(401);
    expect((await fetch(`${base}/admin/events.csv`, { method: "POST" })).status).toBe(405);
  });

  it("token benar (header Bearer atau ?token=) mengunduh CSV tanpa cache", async () => {
    const { base, dataDir } = await boot({ adminToken: "token-rahasia-panjang" });
    writeFileSync(join(dataDir, "events.csv"), `${CSV_HEADER}\nbaris-contoh\n`);
    for (const r of [
      await fetch(`${base}/admin/events.csv`, { headers: { authorization: "Bearer token-rahasia-panjang" } }),
      await fetch(`${base}/admin/events.csv?token=token-rahasia-panjang`),
    ]) {
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/csv");
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("content-disposition")).toContain("gmers-events.csv");
      expect(await r.text()).toBe(`${CSV_HEADER}\nbaris-contoh\n`);
    }
  });

  it("perbandingan token: cocok persis saja; kosong/tidak ada selalu ditolak", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abd", "abc")).toBe(false);
    expect(tokensMatch("abcd", "abc")).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
    expect(tokensMatch(null, "abc")).toBe(false);
    expect(tokensMatch("abc", null)).toBe(false);
  });

  it("log langkah dan berkas data lain tidak bisa diambil lewat web", async () => {
    const { base, dataDir } = await boot({ staticDir: site(), adminToken: "t-rahasia-uji-123" });
    writeFileSync(join(dataDir, "rooms.jsonl"), "rahasia-log");
    for (const p of ["/rooms.jsonl", "/data/rooms.jsonl", "/admin/rooms.jsonl", "/admin", "/%2e%2e/rooms.jsonl", "/..%2f..%2frooms.jsonl"]) {
      const r = await fetch(`${base}${p}`);
      expect(await r.text()).not.toContain("rahasia-log");
    }
  });
});

describe("menyajikan situs", () => {
  it("berkas statis, cache aset ber-hash, SPA untuk rute klien, 404 untuk berkas yang tak ada, dan header keamanan", async () => {
    const { base } = await boot({ staticDir: site() });
    const idx = await fetch(`${base}/`);
    expect(idx.status).toBe(200);
    expect(await idx.text()).toContain("<title>Gmers</title>");
    expect(idx.headers.get("cache-control")).toBe("no-cache");
    expect(idx.headers.get("x-content-type-options")).toBe("nosniff");
    expect(idx.headers.get("referrer-policy")).toBe("no-referrer");
    expect(idx.headers.get("x-frame-options")).toBe("DENY");
    const csp = idx.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/https?:\/\/(?!localhost)/);

    const asset = await fetch(`${base}/assets/app-abc123.js`);
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(`${base}/g/ABC123`)).status).toBe(200);
    expect(await (await fetch(`${base}/privasi`)).text()).toContain("<title>Gmers</title>");
    expect((await fetch(`${base}/assets/tidak-ada.js`)).status).toBe(404);
    expect((await fetch(`${base}/favicon.svg`)).headers.get("content-type")).toBe("image/svg+xml");
  });

  it("tanpa staticDir server hanya melayani WebSocket dan /healthz", async () => {
    const { base } = await boot({ staticDir: null });
    expect((await fetch(`${base}/`)).status).toBe(404);
  });
});
