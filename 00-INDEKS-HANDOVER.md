# Indeks paket hand-over Gmers

Paket ini berisi semua bahan proyek untuk Claude Code. **Mulai dari `docs/06-handover-claude-code-mvp.md`.** Yang lain adalah konteks; baca sesuai kebutuhan tahap.

## Inti untuk MVP Room Web (wajib dibaca)

| Berkas | Isi |
|---|---|
| `docs/06-handover-claude-code-mvp.md` | Tujuan, cakupan, tahap A-D, aturan, prompt pertama |
| `docs/05-aturan-gaple-draf.md` | Aturan Gaple berbasis parameter, wawancara, uji mesin |
| `docs/03-rencana-tahap.md` | Rencana tahap, bagian "Tahap MVP Uji" |
| `docs/tahap/03-mesin-game.md` | Antarmuka mesin dan uji properti |
| `CLAUDE.md` | Keputusan terkini dan aturan yang tidak boleh dilanggar |

## Desain dan mockup

| Berkas | Isi |
|---|---|
| `design/gmers-prototipe-v14.html` | Prototipe klik (mockup seluruh aplikasi penuh: chat, komunitas, games, live, toko). Buka di browser. Hanya referensi tampilan dan alur |
| `design/DESIGN-TOKENS.md` | Warna terang dan gelap, font, aturan tampilan Room Web |
| `design/demo/index.html` | Demo dengan mode uji `?uji=1` (mencatat ketukan dan waktu ke CSV lokal) |
| `design/logo.svg`, `design/logo-lengkap.svg`, `design/favicon.svg` | Logo |

## Data dan ERD (produk penuh, **bukan** MVP)

| Berkas | Isi |
|---|---|
| `docs/02-erd.md`, `docs/erd/*.mmd` dan `*.svg` | ERD dalam empat bagian: akun dan keuangan, sosial dan chat, game dan tiket, komunitas dan iklan |
| `docs/schema.sql` | Skema Postgres produk penuh |

MVP tidak memakai Postgres. Tabel yang relevan sebagai gambaran: `room`, `room_player`, `game_move` (log langkah hanya-tambah dengan `seq`), `game_result`.

## Spesifikasi dan rencana produk penuh (konteks)

| Berkas | Isi |
|---|---|
| `docs/01-spesifikasi.md` | Perilaku produk penuh. Bagian 7.4 = aturan game |
| `docs/04-aturan-remi-draf.md` | Aturan Remi (ditunda, jangan dibangun) |
| `docs/tahap/00-15` dan `docs/tahap-gabungan.md` | Tahap produk penuh. MVP hanya meminjam Tahap 03 |
| `docs/CATATAN-TAHAP.md` | Catatan antar sesi. Tulis pertanyaan terbuka di sini |

## Konsep, strategi, dan ekonomi (konteks)

| Berkas | Isi |
|---|---|
| `strategi/rancangan-lengkap.md` | Konsep, positioning, strategi, ekonomi, risiko |
| `strategi/DOKUMEN-ONLINE.md` | Daftar dokumen strategi online (tautan) |
| `strategi/gmers-strategi-deck.pptx` | Deck strategi |
| `strategi/simulasi-ekonomi-game-v3.md` dan `.xlsx` | Simulasi ekonomi (Trofi, Koin, Tiket); tidak dipakai MVP |
| `pemasaran/web/` | Landing page dan demo yang tayang di Cloudflare Pages (proyek `gmers`) |

Dokumen strategi online (Protokol Uji UX, Positioning dan Rencana Peluncuran, Panduan Wawancara ITB, MVP Gmers, Metrik Gmers) tertaut di `strategi/DOKUMEN-ONLINE.md`. Isi pokok MVP dan metrik sudah dirangkum di `docs/06-handover-claude-code-mvp.md` dan `docs/03-rencana-tahap.md`.

## Yang sengaja tidak dibangun di MVP
Trofi, Koin, Tiket, Bintang, Remi, Ludo, aplikasi native, login Google atau OTP, daftar teman, game asinkron, iklan, taruhan, bot di produksi, suara, pengingat otomatis.

## Status keputusan
- Terkunci: Gaple sebagai game MVP, metrik "kelompok aktif", ambang 4 dari 10 dan pagar 6 dari 10.
- Belum terkunci: aturan Gaple rinci (tunggu wawancara ITB), hosting, kebijakan privasi final, konsultasi hukum Taruhan Tiket.
