# Laporan MVP Room Web Gmers (Gaple)

Disusun otomatis di akhir Tahap D, 24 Nov 2026. Bahasa Indonesia, ringkas. Rincian teknis per tahap ada di `docs/CATATAN-TAHAP.md`.

## 1. Status

| Tahap | Isi | Status | Tag |
|---|---|---|---|
| A | Kerangka monorepo dan mesin Gaple berbasis parameter | selesai, lulus | `mvp-A` |
| B | Server room WebSocket (sambung ulang, timer giliran, log JSONL) | selesai, lulus | `mvp-B` |
| C | Klien web (mobile-first) dan kelompok yang menetap | selesai, lulus | `mvp-C` |
| D | Pencatatan, ekspor, penghitung metrik, privasi (DRAF), Dockerfile, panduan deploy | selesai, lulus | `mvp-D` |

**Catatan git:** semua pekerjaan ada di branch `claude/intelligent-ramanujan-uvb4y4`, bukan `main`. Tag dibuat di klon sesi tetapi push tag ditolak dari sandbox, jadi tag belum ada di GitHub. Lihat bagian 5, langkah 1.

## 2. Yang sudah jadi dan lulus uji

`pnpm verify` hijau (lint, tipe, semua uji, dan E2E browser). Jumlah uji otomatis: mesin 54, server 66, klien 43, skrip 19 + 6 uji sistem.

- **Mesin Gaple:** semua aturan di draf bagian 6, uji properti (28 kartu selalu utuh, `apply` murni, replay dari seed identik), simulasi 10.000 game per 2/3/4 pemain tanpa pelanggaran dan tanpa kebuntuan.
- **Server:** game penuh lewat WebSocket nyata; langkah ilegal ditolak tanpa mengubah state; kartu tangan hanya dikirim ke pemiliknya; sambung ulang; restart di tengah game pulih dari log; timer giliran 60 detik (ada langkah sah: kartu sah pertama; tidak ada: lewat); rematch; pembersihan sesi 24 jam tetapi **kode kelompok tidak pernah kedaluwarsa**; beban 50 room bersamaan tanpa kesalahan (sekitar 0,5 detik).
- **Klien web:** beranda, masuk lewat tautan, ruang tunggu (Salin dan Bagikan ke WhatsApp), meja Gaple, chat, hasil dan Main lagi, sambung ulang otomatis, halaman tidak ditemukan, `/privasi`. Semua teks di satu berkas (`apps/web/src/i18n/id.ts`). Diuji di Chromium sungguhan dengan 4 pemain: bermain dua game sampai selesai, satu pemain refresh di tengah dan kembali ke kursi dengan kartu yang sama, rematch, tanpa overflow horizontal di lebar 360 px, tanpa galat konsol, tanpa permintaan ke pihak ketiga (font di-host sendiri).
- **Pencatatan:** CSV `events.csv` dengan kolom `ts_utc, ts_wib, group_id, room_id, device_id, event, game_no, detail`. Peristiwa: `group_created, invite_link_opened, player_joined, player_left, reconnected, game_started, game_finished, rematch_clicked, message_sent`. Diuji bahwa tiap peristiwa dipancarkan dari alur nyata, dan bahwa CSV tidak memuat isi chat, nama, token mentah, alamat IP, atau nomor HP.
- **Ekspor:** `GET /admin/events.csv` dengan `ADMIN_TOKEN` (perbandingan waktu konstan). Tanpa token di server: 503. Tanpa token atau token salah: 401. Tidak ada token bawaan.
- **Penghitung** (`pnpm hitung`): lulus semua kasus yang diminta (rematch hari yang sama tidak dihitung, dua hari berbeda dihitung, 23.59 dan 00.01 WIB hari berbeda, 2 pemain tidak dihitung, jendela 14 hari terlewat).
- **Uji sistem menyeluruh:** 5 kelompok, 5 hari simulasi (jam palsu), pemain otomatis lewat WebSocket, ekspor lewat endpoint, penghitung, hasil sesuai harapan (hanya 2 dari 5 kelompok aktif: yang main di 2 hari berbeda, termasuk yang lewat tengah malam WIB).

## 3. Belum atau tidak bisa diuji di lingkungan pengembangan

- **Build Docker sungguhan.** Daemon Docker tidak jalan di sandbox. Sebagai gantinya, tahap runtime image ditiru persis (instal produksi dengan filter, hanya sumber server dan `dist`) dan server dijalankan dari sana: `/healthz`, situs, header keamanan, dan ekspor berfungsi. Dockerfile belum pernah dibangun oleh Docker; build pertama di hosting mungkin menemukan masalah kecil.
- **Hosting sungguhan, domain, HTTPS, dan WebSocket lewat proksi hosting.** Belum ada deploy.
- **HP asli** (Android Chrome, iOS Safari, WebView di dalam WhatsApp), jaringan seluler yang berpindah-pindah, dan layar selain 360 px. Hanya Chromium desktop dengan viewport 360 px yang diuji.
- **Mode gelap** hanya dilihat lewat tangkapan layar, belum dinilai di perangkat.
- **Beban di atas 50 room.** Cukup untuk 10 kelompok; belum diukur di hosting yang sebenarnya.
- **Kekuatan permainan:** uji memakai pemain acak; keseimbangan dan rasa permainan hanya bisa dinilai manusia.

## 4. Keputusan otomatis yang perlu Anda tinjau

Total 20 keputusan (5 Tahap B, 7 Tahap C, 8 Tahap D); rincian dan cara mengubah ada di `docs/CATATAN-TAHAP.md`, bagian "Keputusan otomatis". Yang paling penting:

**Aturan Gaple, default dari pilihan bertanda [USUL] di `docs/05-aturan-gaple-draf.md`** (belum dikunci wawancara ITB):
1. **Arah putar:** searah jarum jam.
2. **Pembuka:** pemegang 6|6 membuka dengan 6|6. Pada 2 pemain, 6|6 tidak terbagi di sekitar 50% game (3 pemain sekitar 25%); pembuka pengganti: pemegang balak tertinggi.
3. **Pemecah seri:** titik sisa terendah, lalu kartu tunggal sisa terendah, lalu ujung terendahnya, lalu urutan duduk.
4. **Wajib main bila ada kartu cocok;** lewat tanpa buang kartu (tanpa "kartu mati").
5. **Satu game = satu ronde;** tanpa skor kumulatif dan tanpa 2 lawan 2.
6. **Pembuka rematch:** pemenang game sebelumnya, boleh memasang kartu apa saja.
7. **Batas waktu giliran 60 detik;** pemain yang tidak punya langkah sah menunggu 60 detik penuh sebelum dilewati otomatis (usulan: lewat dalam 3 detik).

**Metrik:**
8. **Kelompok aktif:** minimal 3 perangkat berbeda dalam satu game selesai, pada minimal 2 hari kalender WIB berbeda, dengan jendela 14 hari yang **bergeser** (dua hari sah mana pun berjarak paling lama 13 hari). Alternatifnya jendela tetap sejak game pertama; ubah lewat `--window` atau logika di `scripts/lib/metrics.ts`.
9. **"Selesai tanpa bantuan" tidak bisa diukur otomatis.** Skrip hanya menghitung kelompok yang menyelesaikan minimal satu game; "tanpa bantuan kita" harus Anda catat manual.
10. **Satu perangkat = satu orang.** Pemain yang membuka dari dua HP atau menghapus data peramban dihitung sebagai dua orang.

**Privasi:**
11. Retensi 90 hari di draf kebijakan privasi masih usulan, dan **belum ada penghapusan otomatis** (lihat `docs/DEPLOY.md` bagian 7).

## 5. Perlu tindakan Faizal (urut)

1. **Rapikan git (5 menit).** Dari komputer Anda:
   ```bash
   git fetch origin claude/intelligent-ramanujan-uvb4y4
   git checkout claude/intelligent-ramanujan-uvb4y4
   pnpm install && pnpm verify    # harus hijau
   ```
   Lalu gabungkan branch itu ke `main` (lewat pull request di GitHub, atau `git checkout main && git merge claude/intelligent-ramanujan-uvb4y4`). Catatan: riwayat `main` di GitHub pernah di-force-push sehingga riwayatnya terpisah dari branch kerja ini; branch kerja sudah menggabungkannya, jadi seharusnya cukup fast-forward. Buat dan dorong tag dari komputer Anda: `git tag mvp-A 2e5358f && git tag mvp-B 0626adc && git tag mvp-C 8609f0c && git tag mvp-D <commit Tahap D, lihat git log>` lalu `git push origin --tags`.
2. **Pasang hosting.** Ikuti `docs/DEPLOY.md` (Opsi A atau B): satu instance, Volume di `/data`, variabel `ADMIN_TOKEN` dan `HASH_SALT` (buat dengan `openssl rand -hex 32`, jangan ditulis di repo), health check `/healthz`. **Jangan** pakai paket yang menidurkan aplikasi untuk uji kelompok.
3. **Uji asap (bagian 8 DEPLOY.md)** dengan dua HP sungguhan, termasuk refresh di tengah game dan restart layanan.
4. **Coba di Android dan iPhone asli**, terutama membuka tautan dari dalam WhatsApp dan berpindah WiFi ke data seluler di tengah game.
5. **Tinjau aturan Gaple setelah wawancara ITB.** Tanyakan pertanyaan di `docs/05-aturan-gaple-draf.md` bagian 5, lalu ubah parameter di `packages/game-engine/src/config.ts` (default) atau lewat `GapleConfig`. Varian yang belum dibangun (kartu mati, 2 lawan 2, skor kumulatif) hanya dibangun bila wawancara menyebutkannya.
6. **Kebijakan privasi oleh ahli hukum** sebelum daftar tunggu publik. Teks di `/privasi` (dan `apps/web/src/i18n/id.ts`) masih DRAF dan memuat alamat kontak yang belum final (saat ini: "lewat orang yang mengajakmu bermain"). Putuskan juga cara menerima permintaan hapus data.
7. **Uji dengan 2 kelompok percobaan** sebelum 10 kelompok sungguhan: satu kelompok main dua hari berbeda, lalu jalankan penghitung dan cocokkan dengan ingatan Anda. Perbaiki yang janggal sebelum merekrut.
8. **Rekrut 10 kelompok dan kirim pengingat manual lewat WhatsApp** (otomatisasi pengingat sengaja belum dibangun).
9. **Jadwalkan cadangan CSV harian** (DEPLOY.md bagian 7) dan putuskan retensi 90 hari.

## 6. Cara menjalankan semuanya

```bash
pnpm install                 # pasang dependensi (Node 22, pnpm 10)
pnpm verify                  # lint + tipe + semua uji + E2E browser (E2E dilewati bila Chromium tidak ada)
pnpm build                   # bangun klien web ke apps/web/dist
pnpm --filter @gmers/server start      # jalankan server di http://localhost:8787 (situs + WebSocket)
pnpm e2e                     # hanya E2E browser (butuh Chromium; set CHROMIUM_PATH bila lokasinya khusus)
pnpm --filter @gmers/scripts test      # uji penghitung dan uji sistem menyeluruh
pnpm hitung events.csv --out hasil.csv # hitung kelompok aktif dari CSV hasil ekspor
```

Variabel lingkungan server dan langkah deploy: `docs/DEPLOY.md`.

## 7. Cara membaca hasil penghitung

Per kelompok: `Game selesai`, `Hari sah` (hari WIB dengan game selesai berpemain minimal 3 perangkat), `Aktif` (dua hari sah dalam jendela 14 hari), `Game pertama selesai`, `Tautan dibuka` dan `Masuk` (perangkat yang membuka tautan lalu duduk), `Main lagi <=7 hari` (game selesai di hari WIB berbeda, 1 sampai 7 hari setelah game pertama; rematch di hari yang sama tidak dihitung). Ambang MVP: minimal **4 dari 10** kelompok aktif = asumsi bertahan; 1 sampai 3 = perbaiki satu putaran; 0 = pivot. Pagar: minimal 6 dari 10 kelompok menyelesaikan sesi pertama tanpa bantuan kita.
