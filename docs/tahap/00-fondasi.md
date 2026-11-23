# Tahap 00: Fondasi repo

**Tujuan:** Monorepo yang bisa dibangun, diuji, dan dijalankan dengan satu perintah, dengan CI.

## Masukan (baca dulu)
- CLAUDE.md
- docs/01-spesifikasi.md bagian 1 dan 15

## Tugas
1. Inisialisasi pnpm workspace: `apps/mobile` (Expo TS), `apps/server` (Fastify TS), `packages/game-engine`, `packages/shared`, `infra`.
2. `infra/docker-compose.yml`: Postgres 16, Redis, coturn. Skrip `pnpm dev:infra`.
3. Skrip akar: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm verify` (menjalankan ketiganya).
4. `packages/shared/src/config.ts` berisi konfigurasi bisnis dari spesifikasi (WINS_PER_TICKET=20, GIVE_MAX_PER_WEEK=10, kelas dan batas trofi, durasi room 24 jam, dst).
5. CI (GitHub Actions): verify di setiap push, layanan Postgres untuk uji integrasi.
6. ADR pertama `docs/adr/0001-stack.md` mencatat keputusan teknologi dari CLAUDE.md.

## Kriteria penerimaan
- [ ] `pnpm install && pnpm verify` hijau dari repo bersih.
- [ ] `pnpm dev:infra` menyalakan Postgres, Redis, coturn.
- [ ] Server menjawab `GET /health` dengan `{ok:true}`, aplikasi mobile terbuka di simulator dengan layar kosong.
- [ ] Config dibaca oleh server dan mobile dari paket yang sama.

## Uji yang harus ada
- Uji unit config (nilai sesuai spesifikasi).
- Uji integrasi /health.

## Prompt siap tempel

```
Kerjakan Tahap 00 (docs/tahap/00-fondasi.md). Baca CLAUDE.md dan docs/01-spesifikasi.md dulu. Buat monorepo pnpm sesuai CLAUDE.md, docker compose untuk Postgres 16, Redis, dan coturn, skrip pnpm verify, config bisnis di packages/shared, endpoint /health, dan CI GitHub Actions. Tulis rencana 3-7 butir dulu, lalu bangun. Selesai bila semua kriteria penerimaan di file tahap lulus dan pnpm verify hijau. Akhiri dengan ringkasan dan perbarui docs/CATATAN-TAHAP.md.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-00`.
