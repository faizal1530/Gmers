# CLAUDE.md: Gmers

Aplikasi chat + game sosial (Ludo, Remi, dan Gaple dulu) untuk Android dan iOS. Tim: 2 orang dan Claude. Bahasa kerja dengan pemilik: **Bahasa Indonesia**. Kode, nama variabel, dan commit boleh Inggris; teks yang dilihat pengguna Bahasa Indonesia.

## MVP aktif: mulai di sini
Pekerjaan saat ini adalah **MVP Room Web (Gaple)**. Baca `00-INDEKS-HANDOVER.md`, lalu `docs/06-handover-claude-code-mvp.md` dan `docs/05-aturan-gaple-draf.md`. Bagian produk penuh (Tiket, Trofi, ledger, Expo, Postgres, tahap 00-15 selain 03) **bukan** untuk MVP; abaikan sampai MVP lulus. Prototipe lokal: `design/gmers-prototipe-v14.html`; token desain: `design/DESIGN-TOKENS.md`.

## Struktur repo MVP (Tahap A sampai D selesai)
- `packages/game-engine`: mesin Gaple (TS murni, tanpa I/O). Aturan hanya lewat parameter `GapleConfig`; `Math.random` dan `Date.now` dilarang di `src` (ESLint).
- `apps/server`: satu proses Node (`ws`), akun opsional (nama pengguna + kata sandi scrypt, sesi permanen, `accounts.jsonl`; keputusan Faizal 24 Nov, menggantikan "tanpa akun" di handover; tanpa email dan nomor HP), room di memori, log JSONL (`DATA_DIR`), `EventSink` CSV, menyajikan `apps/web/dist`, ekspor `/admin/events.csv` (`ADMIN_TOKEN`), `/healthz`. Kode di tautan = `group_id` kelompok yang tidak pernah kedaluwarsa.
- Fase tambahan (24-25 Nov 2026, "2 game"): Ludo (`packages/game-engine/src/ludo.ts`), `games.ts` (adapter game; room game-agnostic), `ledger.ts`/`progress.ts`/`economy.ts`/`matchmaking.ts` (Trofi, Bintang, Ranked), `social.ts`/`socialhub.ts` (teman, DM relay di memori, ajakan, streak), `community.ts` (feed teks), `shop.ts` (Toko Koin SIMULASI), Live/penonton di `service.ts`. Data: `ledger.jsonl`, `social.jsonl`, `community.jsonl`, `shop.jsonl` (lihat `docs/DEPLOY.md` 5c). Sengaja tidak ada: Tiket/taruhan, pembayaran, suara, iklan, native, unggah media, Remi.
- `apps/web`: klien Vite + TypeScript tanpa kerangka, dengan tab bawah Games/Room/Chat/Profil. Semua teks pengguna di `src/i18n/id.ts`. Suara sintetis di `src/sound.ts`. E2E Chromium di `e2e/run.ts`.
- `scripts`: `pnpm hitung events.csv` (penghitung kelompok aktif) dan uji sistem.
- Perintah: `pnpm verify` (lint, tipe, uji, E2E), `pnpm build`, `pnpm hitung`. Deploy: `Dockerfile` dan `docs/DEPLOY.md`. Ringkasan dan daftar tindakan: `docs/LAPORAN-MVP.md`. Untuk MVP abaikan `apps/mobile`, `packages/shared`, `infra`, Postgres/Redis/Expo di bagian Teknologi.

## Keputusan terkini (12 Nov 2026)
- Nama produk: **Gmers**. Tiga game awal: Ludo (game yang lebih mudah), Remi, dan Gaple. Gaple dan Remi adalah game klaster beta pertama (mahasiswa ITB, Bandung). Aturan Remi masih draf (`docs/04-aturan-remi-draf.md`); jangan membangun mesin Remi sebelum varian dikunci.
- Taruhan 1 Tiket tetap masuk produk dengan tiga pengaman WAJIB: sakelar mati jarak jauh, hanya 18+, dan konsultasi hukum tertulis sebelum rilis publik (spesifikasi 9.4).
- Mesin game dan room dibuat game-agnostic: menambah game tidak boleh mengubah room, chat, dan ledger.
- Keluaran uji beta: demo punya mode uji (`?uji=1`) yang mencatat ketukan dan waktu ke CSV lokal.
- MVP uji (lihat `docs/03-rencana-tahap.md`): room web satu game, **Gaple** (diputuskan 12 Nov), tanpa Tiket, Trofi, Koin, Remi, dan aplikasi native. Wawancara ITB dimulai Senin 16 Nov 2026.
- Metrik tunggal: **kelompok aktif** = minimal 3 orang bermain bersama pada minimal 2 hari kalender berbeda (WIB) dalam 14 hari; rematch di hari yang sama tidak menambah hitungan. Ambang MVP: minimal 4 dari 10 kelompok (hipotesis, dikunci sebelum uji). Target "20 dalam 6 minggu" belum dikukuhkan: kapasitas rekrutmen sekitar 2-3 kelompok per minggu.

## Baca dulu (urut)
1. `docs/01-spesifikasi.md`: perilaku produk. Sumber kebenaran.
2. `docs/02-erd.md` dan `docs/schema.sql`: data. Sumber kebenaran skema.
3. `docs/03-rencana-tahap.md`: urutan kerja. Kerjakan **satu tahap per sesi**, buka `docs/tahap/NN-*.md`.
4. Prototipe klik (referensi tampilan dan alur, bukan kode): https://claude.ai/artifact/MJ1A9td18tdnNi2jaR4Hmw

Bila spesifikasi dan prototipe berbeda, spesifikasi menang. Bila spesifikasi kurang jelas atau bertentangan, **berhenti dan tanya**, jangan menebak untuk hal yang menyangkut uang, Tiket, privasi, atau keselamatan.

## Aturan yang tidak boleh dilanggar
1. Empat mata uang terpisah: Trofi, Koin, Tiket, Bintang. **Tidak ada jalur Koin atau Rupiah ke Tiket, dan tidak ada taruhan Koin atau uang.** Semua perubahan saldo lewat satu modul (`ledger`) yang menulis baris `ledger_entry` dalam transaksi yang sama.
2. Server adalah wasit. Klien mengirim niat (langkah), server memvalidasi dengan `packages/game-engine` dan menetapkan hasil, trofi, dan Tiket. Jangan pernah menghitung trofi, Tiket, atau saldo di klien sebagai sumber kebenaran.
3. Tidak ada lawan komputer. Bot hanya boleh ada di uji otomatis.
4. Iklan hanya di feed Komunitas dan Live. Tidak pernah di chat atau saat game berjalan. Kategori judi dan taruhan diblokir.
5. Chat dan ajak main hanya antar **teman** (saling ikuti atau saling simpan kontak). Setiap endpoint chat memeriksa pertemanan di server.
6. Nomor HP dan email tidak pernah dikirim ke pengguna lain, tidak ada di log, dan nomor disimpan terenkripsi plus hash.
7. Jangan menambah fitur di luar `docs/01-spesifikasi.md` bagian 16 (di luar cakupan) tanpa persetujuan.

## Teknologi (keputusan dikunci di Tahap 0, ubah hanya lewat ADR)
- Monorepo **pnpm**: `apps/mobile` (Expo + React Native, TypeScript), `apps/server` (Node 22, Fastify, WebSocket), `packages/game-engine` (TS murni, tanpa dependensi platform), `packages/shared` (tipe dan skema zod), `infra` (docker compose: Postgres 16, Redis, coturn).
- Basis data: PostgreSQL, migrasi SQL biasa (`apps/server/migrations`), akses dengan Kysely. `docs/schema.sql` adalah acuan awal migrasi.
- Realtime: WebSocket (satu koneksi per klien), Redis untuk pub/sub dan antrean matchmaking.
- Suara dan panggilan: `react-native-webrtc` dengan coturn (TURN wajib untuk match acak).
- Pembelian: RevenueCat. Iklan: AdMob. Push: FCM dan APNs lewat Expo. Media: penyimpanan kompatibel S3.
- Auth: Google Sign-In, server memverifikasi ID token lalu menerbitkan JWT berumur pendek dan refresh token. OTP lewat antarmuka `OtpProvider` (adapter konsol untuk dev, adapter nyata belakangan).

## Cara bekerja per tahap
1. Baca file tahap. Tulis rencana singkat (3-7 butir) sebelum mengubah kode.
2. Kerjakan dengan langkah kecil, commit sering dengan pesan jelas.
3. **Tulis uji bersama kode.** Tahap selesai hanya bila semua kriteria penerimaan di file tahap lulus dan `pnpm verify` hijau.
4. Jalankan `pnpm verify` (lint, typecheck, uji unit, uji integrasi) sebelum menyatakan selesai.
5. Akhiri dengan ringkasan: apa yang dibangun, apa yang diuji, apa yang belum, dan pertanyaan terbuka. Perbarui `docs/CATATAN-TAHAP.md`.
6. Jangan mengubah `docs/schema.sql` langsung setelah Tahap 1; buat migrasi baru dan perbarui `docs/02-erd.md`.

## Standar kode
- TypeScript `strict`. Tidak ada `any` tanpa komentar alasan.
- Validasi semua masukan di batas sistem dengan zod. Kesalahan dikembalikan dalam bentuk `{code, message}`; `message` bahasa Indonesia untuk pengguna.
- Konfigurasi angka bisnis (batas, jumlah, durasi) di satu berkas `packages/shared/src/config.ts` yang juga dibaca server. Jangan menanam angka di komponen UI.
- Semua string pengguna di `apps/mobile/src/i18n/id.ts`.
- Aksesibilitas: target sentuh minimal 44 px, label pembaca layar, kontras cukup, dukungan mode gelap.
- Tanpa dependensi baru yang berat tanpa alasan tertulis di ADR.

## Uji dan QA (QA dilakukan Claude, jadi uji harus bisa dijalankan sendiri)
- `packages/game-engine`: uji unit per aturan + **simulasi 10.000 game acak per game tanpa pelanggaran aturan** + uji properti (konservasi kartu, bidak tidak melewati finish).
- Server: uji integrasi dengan Postgres nyata (docker), termasuk batasan data (`schema.sql` punya uji perilaku).
- Mobile: uji komponen untuk logika UI, dan skenario E2E (Maestro) untuk alur utama: onboarding, ajak main, selesai game.
- Setiap aturan anti-curang dan batas Tiket punya uji sendiri (lihat Tahap 9).

## Hal yang butuh keputusan manusia (jangan putuskan sendiri)
Layanan OTP dan biayanya, batas usia, kebijakan rekaman suara pemain lain, harga dan paket Koin final, apa pun yang menyangkut hadiah uang atau turnamen berhadiah, isi kebijakan privasi, dan pemakaian nama atau merek pihak lain.
