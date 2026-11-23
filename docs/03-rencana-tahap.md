# Rencana Implementasi di Claude Code

15 tahap, masing-masing cukup kecil untuk satu sesi Claude Code (setengah hari sampai dua hari kerja Claude plus tinjauan manusia). Setiap tahap punya file di `docs/tahap/` berisi tujuan, tugas, kriteria penerimaan, dan **prompt siap tempel**.

## Tahap MVP Uji (sebelum Tahap 00-15)

Dibuat 12 Nov 2026 (hasil scope-mvp). Rincian lengkap: dokumen Claude Docs "MVP Gmers: Uji Jangkauan dan Kembali Main". Angka di bawah masih **usulan** untuk dikunci sebelum membangun.

**Asumsi yang diuji:** satu lingkaran teman (3-4 mahasiswa ITB) yang diajak lewat satu tautan akan bermain bersama lalu kembali bermain lagi dalam 14 hari, tanpa dibantu kami.

**Jenis:** MVP room web (peramban, tanpa instal), satu game, chat teks, nama panggilan tanpa akun, pencatatan kejadian ke CSV. Pengingat dikirim manual lewat WhatsApp. Suara memakai panggilan WhatsApp terpisah.

**Tidak dibangun:** Trofi, liga, Bintang, Koin, Tiket dan Taruhan 1 Tiket, streak, iklan, Komunitas, Live, toko, Remi dan game kedua, aplikasi native, OTP/Google login, graf pertemanan, giliran asinkron.

**Game pertama:** disarankan Gaple (permainan klaster ITB, mesin kecil), Ludo sebagai cadangan; keputusan pemilik. Mesin game ditulis sebagai `packages/game-engine` (TS murni) dan satu-satunya bagian MVP yang dipakai ulang di Tahap 03. Sisanya sekali pakai.

**Metrik dan ambang:** kelompok aktif (minimal 3 orang, masing-masing minimal 2 sesi bersama dalam 14 hari). Dari 10 kelompok, minimal 4 aktif = asumsi bertahan; 1-3 = perbaiki satu putaran; 0 = pivot-decision. Pagar: minimal 6 dari 10 kelompok menamatkan sesi pertama tanpa bantuan kami.

**Kotak:** sekitar 6-7 minggu setelah game terkunci; biaya di luar tenaga maksimal sekitar Rp500.000.

**Prasyarat:** 10 wawancara mahasiswa ITB dan uji UX tiga metode selesai; game dan aturannya terkunci (Remi dan Gaple belum). Periksa kalender akademik ITB.

**Setelah lulus:** lanjut ke Tahap 00 dan seterusnya (aplikasi native). Tahap 09 (Tiket) tetap menunggu opini hukum tertulis.

## Cara memakai
1. Taruh seluruh paket ini di akar repo (`CLAUDE.md` di akar, `docs/` di bawahnya).
2. Buka Claude Code di akar repo. Mulai tahap dengan menempelkan prompt dari file tahap.
3. Tinjau hasil (diff, uji, ringkasan). Lanjut ke tahap berikutnya hanya bila kriteria penerimaan lulus.
4. Satu cabang per tahap, gabungkan setelah lulus. Tag `tahap-NN` sebagai titik aman.

## Peta tahap

| # | Tahap | Hasil utama | Bergantung pada |
|---|---|---|---|
| 00 | Fondasi repo | Monorepo, CI, `pnpm verify`, docker compose | n/a |
| 01 | Basis data | Migrasi dari `schema.sql`, seed, uji batasan | 00 |
| 02 | Akun dan onboarding | Google, nomor HP, OTP, avatar, JWT | 01 |
| 03 | Mesin game | Ludo, Remi, dan Gaple murni TS + simulasi 10.000 game | 00 |
| 04 | Realtime dan wasit | WebSocket, room, validasi langkah, sambung ulang | 01, 03 |
| 05 | Cangkang aplikasi | 4 tab, tema, avatar dan lencana kelas, status | 02 |
| 06 | Pertemanan dan chat | Ikuti, kontak, pertemanan turunan, chat 1-1, grup, room sekali pakai | 02, 05 |
| 07 | Room dan ajak main | Sheet Ajak main, undangan, UI Ludo, Remi, dan Gaple, mode, Jangan ganggu, Rekam | 04, 05, 06 |
| 08 | Trofi dan Ranked | Trofi, kelas, bonus, matchmaking acak, relay | 04, 07 |
| 09 | Tiket | Progres 20 menang, beri/minta, taruhan, anti-curang | 06, 08 |
| 10 | Suara dan panggilan | WebRTC, TURN, indikator jaringan, panggilan 1-1 | 06, 07 |
| 11 | Toko dan Koin | IAP, kosmetik, emoji, skin, avatar premium | 05 |
| 12 | Komunitas | Feed, posting, media, balasan, moderasi, iklan | 06 |
| 13 | Games Store, Turnamen, Live | Aktivasi game, kartu Tiket, Tonton | 08, 09 |
| 14 | Notifikasi dan streak | Push, streak pemaaf, jam tenang | 06, 07 |
| 15 | Pengerasan dan rilis | Keamanan, beban, kepatuhan, beta tertutup | semua |

Jalur kritis: 00, 01, 03, 04, 07, 08. Tahap 05, 11, 12 bisa dikerjakan paralel setelah dependensinya selesai bila ada dua sesi.

## Definisi selesai (semua tahap)
- Kriteria penerimaan di file tahap terpenuhi.
- `pnpm verify` hijau di CI.
- Tidak ada pelanggaran "Aturan yang tidak boleh dilanggar" di `CLAUDE.md`.
- `docs/CATATAN-TAHAP.md` diperbarui (apa yang dibangun, keputusan, utang teknis, pertanyaan terbuka).
- Jika skema berubah: ada migrasi dan `docs/02-erd.md` diperbarui.

## Gerbang keputusan manusia
| Sebelum tahap | Keputusan |
|---|---|
| MVP Uji | Game pertama (Gaple atau Ludo), aturan terkunci lewat wawancara, ambang dikunci |
| 02 | Layanan OTP (SMS atau WhatsApp) dan akun layanan Google Cloud |
| 08 | Angka trofi final dan aturan keluar dini |
| 09 | Opini hukum tertulis tentang Taruhan 1 Tiket |
| 10 | Kebijakan rekaman suara pemain lain |
| 11 | Akun Google Play dan Apple Developer, harga paket Koin |
| 12 | Batas usia dan kebijakan moderasi unggahan video |
| 15 | Klasifikasi gim (Permenkominfo 2/2024), pendaftaran PSE, kebijakan privasi |

## Estimasi kasar
Dengan 2 orang meninjau dan Claude membangun: Fase inti (tahap 00 sampai 09) sekitar 8 sampai 12 minggu, lalu 10 sampai 15 untuk suara, toko, komunitas, dan rilis. Ini perkiraan, bukan janji; ukur kecepatan nyata setelah tahap 03. MVP Uji (sekitar 6-7 minggu) berjalan lebih dulu dan tidak termasuk dalam perkiraan ini.
