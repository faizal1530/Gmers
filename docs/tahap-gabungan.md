# Gmers: Prompt dan Tahap Implementasi (gabungan)

Gabungan semua file docs/tahap/NN-*.md. Sumber di paket kode.

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
# Tahap 01: Basis data

**Tujuan:** Skema PostgreSQL berjalan lewat migrasi dan batasan datanya terbukti oleh uji.

## Masukan (baca dulu)
- docs/02-erd.md
- docs/schema.sql

## Tugas
1. Ubah `docs/schema.sql` menjadi migrasi bernomor di `apps/server/migrations` (jangan menyalin buta: tinjau dan perbaiki bila ada celah).
2. Generator tipe Kysely dari skema.
3. Seed pengembangan: 8 pengguna, beberapa pertemanan, komunitas Gaple Bandung dan lainnya, katalog item, game, paket Koin.
4. Modul `ledger`: fungsi tunggal `applyLedger(tx, userId, currency, amount, reason, refId)` yang menulis `ledger_entry` dan memperbarui `wallet` dalam satu transaksi; menolak saldo negatif.
5. Modul `friendship`: `recomputeFriendship(tx, a, b)` memanggil fungsi SQL dan dipanggil dari semua perubahan follow, kontak, dan blokir.

## Kriteria penerimaan
- [ ] Migrasi naik dan turun tanpa galat pada basis data kosong.
- [ ] Semua batasan di `docs/02-erd.md` bagian 'Aturan integritas' punya uji yang gagal bila batasan dihapus.
- [ ] Tidak ada jalur kode yang mengubah `wallet` selain `applyLedger`.

## Uji yang harus ada
- Uji: saldo negatif ditolak; `ledger_entry` tidak bisa diubah; alasan lintas mata uang ditolak (Koin ke Tiket); nomor HP ganda ditolak; iklan kategori judi ditolak; penempatan iklan 'chat' ditolak; pertemanan terbentuk dan putus sesuai `follow` dan `contact_save`; room dengan `expires_at` hanya untuk jenis room.

## Prompt siap tempel

```
Kerjakan Tahap 01 (docs/tahap/01-basis-data.md). Ubah docs/schema.sql menjadi migrasi di apps/server/migrations, tambahkan tipe Kysely, seed, modul ledger (applyLedger) dan friendship (recomputeFriendship). Tulis uji integrasi di Postgres nyata untuk setiap aturan di docs/02-erd.md bagian Aturan integritas, termasuk bahwa Koin tidak bisa menjadi Tiket. Tinjau skema kritis dan laporkan bila ada celah sebelum membangun di atasnya.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-01`.
# Tahap 02: Akun dan onboarding

**Tujuan:** Pengguna bisa masuk dengan Google, memverifikasi nomor HP lewat OTP, memilih avatar basic, dan mendapat sesi.

**Butuh keputusan manusia sebelum mulai:** Keputusan layanan OTP (SMS atau WhatsApp) dan akun Google Cloud OAuth.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 3, 4
- prototipe: alur login, nomor, kode, avatar

## Tugas
1. Endpoint: `POST /auth/google` (verifikasi ID token), `POST /auth/phone` (kirim OTP), `POST /auth/otp` (verifikasi), `POST /me/profile` (avatar dan nama), `POST /auth/refresh`.
2. Aturan OTP: 6 angka, kedaluwarsa 5 menit, maksimal 5 percobaan, kirim ulang setelah 60 detik, maksimal 5 kirim per nomor per jam. Hash kode; simpan nomor terenkripsi dan hash.
3. Satu nomor satu akun. Percobaan memakai nomor yang sudah terdaftar ditolak dengan pesan jelas.
4. Antarmuka `OtpProvider` dengan adapter konsol (dev) dan adapter palsu untuk uji. Adapter nyata ditunda sampai keputusan layanan.
5. Layar mobile: Login Google, Nomor HP, Kode, Avatar dan nama (penanda 3 langkah). Hanya 6 avatar basic. Validasi nomor: diawali 8, 9 sampai 12 angka, awalan 0 dibuang.
6. Pembuatan `wallet` kosong dan trofi 0 saat akun dibuat.

## Kriteria penerimaan
- [ ] Alur lengkap berjalan dari simulator sampai layar utama (stub).
- [ ] Semua batas OTP dan satu-nomor-satu-akun terbukti oleh uji.
- [ ] Nomor HP tidak muncul di respons API manapun selain milik sendiri (diuji) dan tidak ada di log.

## Uji yang harus ada
- Uji integrasi tiap batas OTP; uji nomor ganda; uji bahwa token Google palsu ditolak; uji log tidak memuat nomor.
- E2E Maestro: onboarding dari login sampai pilih avatar.

## Prompt siap tempel

```
Kerjakan Tahap 02 (docs/tahap/02-akun.md). Bangun auth Google + OTP nomor HP + profil avatar sesuai spesifikasi bagian 3 dan 4, dengan antarmuka OtpProvider (adapter konsol untuk dev). Layar mobile mengikuti alur prototipe. Pastikan nomor HP tidak bocor ke respons atau log, dan tulis uji untuk setiap batas OTP. Jangan memilih layanan OTP nyata; tanya saya bila perlu.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-02`.
# Tahap 03: Mesin game

**Tujuan:** Aturan Ludo, Remi, dan Gaple sebagai paket TypeScript murni yang dipakai server dan klien.

**Catatan Remi (12 Nov 2026):** Ludo dan Gaple dikerjakan lebih dulu. Remi menunggu varian aturan dikunci (spesifikasi 7.4 dan pertanyaan terbuka 7; draf di `docs/04-aturan-remi-draf.md`). Mesin dibuat berbasis parameter aturan, jadi varian bisa disesuaikan tanpa membongkar mesin.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 7.4
- prototipe: logika Ludo, Remi, dan Gaple di berkas HTML (referensi perilaku)

## Tugas
1. Antarmuka umum: `init(config, seed) -> State`, `legalMoves(state, seat) -> Move[]`, `apply(state, move) -> State | Error`, `status(state) -> {over, ranking}`. State serializable JSON, deterministik dengan seed, tanpa `Math.random` langsung (injeksi RNG).
2. Ludo: 52 petak, 4 bidak, keluar dengan 6, giliran tambahan untuk 6 dan memakan, petak aman, finish tepat 56, 2-4 pemain.
3. Gaple: 28 kartu, 7 per pemain, 6|6 membuka, ujung kiri dan kanan, lewat, game terkunci dihitung sisa titik, 2-4 pemain.
4. Klien memakai mesin yang sama untuk menampilkan langkah sah; server yang memutuskan.

## Kriteria penerimaan
- [ ] Semua aturan di spesifikasi 7.4 punya uji unit.
- [ ] Simulasi 10.000 game acak per game dan per jumlah pemain selesai tanpa pelanggaran aturan dan tanpa kebuntuan.
- [ ] Peringkat akhir selalu urutan lengkap 1..n, termasuk game terkunci Gaple.

## Uji yang harus ada
- Uji properti: konservasi kartu (28 selalu), bidak tidak melewati finish, tidak ada langkah ilegal diterima, `apply` murni (state lama tidak berubah), replay log langkah menghasilkan state akhir yang sama.

## Prompt siap tempel

```
Kerjakan Tahap 03 (docs/tahap/03-mesin-game.md). Bangun packages/game-engine untuk Ludo, Remi, dan Gaple sebagai TypeScript murni dan deterministik (RNG diinjeksi), sesuai spesifikasi bagian 7.4. Tulis uji unit dan simulasi 10.000 game acak per game per jumlah pemain, plus uji properti dan uji replay. Tidak ada I/O atau dependensi platform di paket ini.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-03`.
# Tahap 04: Realtime dan wasit

**Tujuan:** Server menjalankan room: pemain terhubung lewat WebSocket, langkah divalidasi mesin, dan game bisa disambung ulang.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 7.2 sampai 7.5
- docs/02-erd.md bagian game
- Tahap 01 dan 03

## Tugas
1. Gateway WebSocket dengan autentikasi JWT, heartbeat, dan sambung ulang dengan nomor urut pesan.
2. Layanan room: buat room, duduk, mulai, kirim `move` (niat), server memvalidasi lewat game-engine, menulis `game_move`, menyiarkan state ke pemain dan penonton.
3. Giliran dan batas waktu (`turn_deadline`); pemain putus dihitung terputus lalu timeout sesuai aturan; game asinkron (giliran 24 jam) dijalankan dari pekerja terjadwal.
4. Penonton: menerima state dengan kartu tangan disembunyikan dan jeda tayang yang dapat dikonfigurasi.
5. Pemulihan: server dimulai ulang tidak kehilangan game (state dibangun ulang dari log langkah).
6. Hasil akhir ditulis ke `game_result` dan `result_player` (trofi dan Tiket dihitung di Tahap 08 dan 09; di sini hanya peringkat).

## Kriteria penerimaan
- [ ] Dua klien uji bisa menyelesaikan game Ludo, Remi, dan Gaple penuh lewat WebSocket.
- [ ] Langkah ilegal atau di luar giliran ditolak dan tidak mengubah state.
- [ ] Memutus dan menyambung ulang klien di tengah game memulihkan state yang benar.
- [ ] Restart server di tengah game tidak kehilangan state (diuji).

## Uji yang harus ada
- Uji integrasi dengan klien WebSocket palsu; uji replay dari log; uji beban sederhana 200 room bersamaan.

## Prompt siap tempel

```
Kerjakan Tahap 04 (docs/tahap/04-realtime.md). Bangun gateway WebSocket dan layanan room di apps/server dengan server sebagai wasit (memakai packages/game-engine), log langkah di game_move, sambung ulang, giliran asinkron, mode penonton dengan kartu tersembunyi, dan pemulihan dari log. Tulis uji integrasi dua klien palsu menyelesaikan game penuh, uji langkah ilegal, uji putus-sambung, dan uji restart server.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-04`.
# Tahap 05: Cangkang aplikasi

**Tujuan:** Navigasi empat tab, tema, komponen dasar, avatar dengan lencana kelas, dan status pengguna.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 1, 4, 5.4
- prototipe: warna, tipografi, komponen

## Tugas
1. Navigasi: Chat, Komunitas, Games, Live; tombol mengambang di kanan bawah (+ di Chat, pensil di Komunitas).
2. Token desain (terang dan gelap) mengikuti prototipe: warna, tipografi, jarak. Komponen: tombol, kartu, sheet bawah, toast, chip, tab segmen, switch.
3. Komponen `Avatar` (SVG, 6 basic + premium) dengan lencana kelas yang dihitung dari trofi.
4. Status pengguna (Siap main, Sibuk, Senyap, Jangan ganggu) dengan sheet pemilih; disimpan di server.
5. i18n Bahasa Indonesia dari berkas tunggal.

## Kriteria penerimaan
- [ ] Semua tab terbuka dengan data stub.
- [ ] Mode gelap dan terang benar; target sentuh minimal 44 px; label pembaca layar ada.
- [ ] Avatar menampilkan lencana kelas yang benar untuk setiap ambang trofi (diuji).

## Uji yang harus ada
- Uji komponen untuk Avatar (kelas dari trofi), sheet, dan status. Uji snapshot tampilan tema.

## Prompt siap tempel

```
Kerjakan Tahap 05 (docs/tahap/05-cangkang-aplikasi.md). Bangun navigasi 4 tab, tema terang dan gelap, komponen dasar, komponen Avatar dengan lencana kelas (Pemula, Jago, Pro, Master, Raja dari packages/shared config), dan status pengguna. Ikuti tampilan prototipe. Semua teks lewat i18n id.ts.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-05`.
# Tahap 06: Pertemanan dan chat

**Tujuan:** Mengikuti, menyimpan kontak, pertemanan turunan, dan chat 1-1, grup, serta room sekali pakai.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 5, 6
- docs/02-erd.md bagian 2

## Tugas
1. Endpoint ikuti, berhenti mengikuti, simpan kontak, hapus kontak, blokir; semuanya memanggil `recomputeFriendship`.
2. Pencocokan kontak lewat hash nomor HP dengan persetujuan pengguna (unggah hash, bukan nomor).
3. Percakapan: 1-1 (hanya teman), grup (maks 50), room sekali pakai dengan `expires_at` 24 jam dari aktivitas terakhir; penyapu terjadwal menghapus room kedaluwarsa permanen.
4. Pesan realtime lewat WebSocket, status terbaca, riwayat dengan paginasi, antrean luring di klien.
5. Semua endpoint chat menolak non-teman di server (uji).
6. Layar mobile: daftar chat, chat 1-1, grup baru, chat baru (hanya teman), tab Teman di Komunitas (daftar teman, Menunggu saling), layar profil orang lain (Ikuti, Simpan kontak, status hubungan).
7. Pertemanan putus: riwayat tetap terlihat, kolom tulis diganti pesan, tombol ajak hilang.

## Kriteria penerimaan
- [ ] Skenario pertemanan di prototipe terbukti: ikuti satu arah bukan teman; saling ikuti atau saling simpan kontak jadi teman; hapus syarat terakhir memutus.
- [ ] Non-teman tidak bisa membuat chat, mengirim pesan, atau mengajak main lewat API (diuji).
- [ ] Room kedaluwarsa terhapus oleh penyapu dan aktivitas menggeser `expires_at`.

## Uji yang harus ada
- Uji integrasi aturan teman dan chat; uji penyapu room; uji pembatasan blokir; E2E dua perangkat mengobrol.

## Prompt siap tempel

```
Kerjakan Tahap 06 (docs/tahap/06-pertemanan-chat.md). Bangun pertemanan turunan (follow dan contact_save) dan chat 1-1, grup, serta room sekali pakai sesuai spesifikasi bagian 5 dan 6, termasuk layar mobile. Pastikan setiap endpoint chat memeriksa pertemanan di server dan tulis uji untuk skenario putus pertemanan. Hash nomor HP hanya untuk pencocokan kontak, tidak pernah diekspos.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-06`.
# Tahap 07: Room dan ajak main

**Tujuan:** Dari chat, ajak teman main lalu bermain Ludo atau Gaple sampai selesai di aplikasi.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 7.2, 7.3, 5.4
- prototipe: sheet Ajak main, kartu undangan, room, Jangan ganggu, Rekam

## Tugas
1. Sheet Ajak main: game, kapan (sekarang atau 24 jam), mode, Ranked (ditampilkan; logikanya di Tahap 08), dan taruhan (ditampilkan nonaktif; logikanya di Tahap 09).
2. Kartu undangan di chat dengan status (terbuka, ditahan, bergabung, nanti, sibuk, kedaluwarsa). Aturan Jangan ganggu (ditahan) dan Sibuk (balasan otomatis).
3. UI game Ludo, Remi, dan Gaple memakai `packages/game-engine` untuk menampilkan langkah sah; tangan Gaple, papan Ludo, dadu, giliran, layar hasil.
4. Bar atas room: Mute, Jangan ganggu selama di room (dipulihkan saat keluar), Rekam.
5. Rekam: rekaman layar ke folder lokal (Video/Gmers) memakai API platform, indikator REC dan pewaktu, pemberitahuan ke pemain lain, berhenti otomatis saat keluar atau game selesai.
6. Mode per pemain (Suara, Chat, Senyap). Suara sendiri dikerjakan di Tahap 10; di sini mode Chat dan Senyap lengkap.

## Kriteria penerimaan
- [ ] Dua perangkat bisa bermain Ludo, Remi, dan Gaple penuh dari undangan sampai layar hasil.
- [ ] Undangan ke teman Jangan ganggu ditahan tanpa notifikasi.
- [ ] Rekam menghasilkan file di folder lokal dan pemain lain melihat tanda REC (diuji manual di perangkat nyata; catat hasil).

## Uji yang harus ada
- E2E Maestro dua perangkat; uji komponen kartu undangan; uji aturan penerima Jangan ganggu dan Sibuk di server.

## Prompt siap tempel

```
Kerjakan Tahap 07 (docs/tahap/07-room-ajak-main.md). Bangun sheet Ajak main, kartu undangan di chat, UI Ludo, Remi, dan Gaple (memakai packages/game-engine, server sebagai wasit dari Tahap 04), bar atas room dengan Jangan ganggu dan Rekam sesuai spesifikasi bagian 7. Ranked dan taruhan Tiket hanya tampil, logikanya tahap berikutnya. Uji E2E dua perangkat dari undangan sampai layar hasil.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-07`.
# Tahap 08: Trofi dan Ranked

**Tujuan:** Trofi, kelas, bonus harian, Ranked lawan acak lewat relay, dan anti-curang dasar.

**Butuh keputusan manusia sebelum mulai:** Angka trofi final dan aturan keluar dini.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 7.5, 14
- rancangan lengkap bagian 3 dan 5

## Tugas
1. Perhitungan trofi di server saat `game_result` ditulis: +10/+4/-2/-5 (4 pemain), +10/-5 (2 pemain), lantai kelas, bonus +2 game pertama harian, disconnect dihitung kalah, keluar dini dihitung peringkat terakhir. Bintang per game sesuai konfigurasi.
2. Matchmaking acak lewat Redis: antrean per game dan rentang kelas, melebar bertahap; room acak diberi `random_match=true` dan wajib lewat TURN.
3. Konfirmasi siap di awal Ranked; Ranked hanya live.
4. Anti-curang dasar: tanda akun ganda (nomor HP dan sidik perangkat), deteksi langkah mencurigakan (pasif), pembatasan lawan sama berulang.
5. Layar mobile: Ranked lawan acak, layar hasil dengan ringkasan trofi dan kelas naik, profil dengan kelas.

## Kriteria penerimaan
- [ ] Tabel trofi terbukti oleh uji untuk semua peringkat dan format.
- [ ] Lantai kelas dan bonus harian benar, termasuk pergantian hari (WIB).
- [ ] Match acak tidak pernah membocorkan alamat jaringan lawan (relay).

## Uji yang harus ada
- Uji tabel trofi lengkap; uji lantai kelas; uji bonus harian di batas hari; uji antrean matchmaking; uji disconnect.

## Prompt siap tempel

```
Kerjakan Tahap 08 (docs/tahap/08-trofi-ranked.md). Hitung trofi di server sesuai spesifikasi 7.5 (semua peringkat, lantai kelas, bonus harian WIB, keluar dini), matchmaking acak dengan Redis dan relay TURN, konfirmasi siap, dan anti-curang dasar. Tulis uji tabel untuk setiap kombinasi trofi. Angka ada di packages/shared config. Tanya saya soal aturan keluar dini bila spesifikasi kurang jelas.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-08`.
# Tahap 09: Tiket

**Tujuan:** Progres 20 kemenangan, beri dan minta Tiket, taruhan 1 Tiket, dan semua pembatasan anti-penyalahgunaan.

**Butuh keputusan manusia sebelum mulai:** Opini hukum tertulis tentang Taruhan 1 Tiket (fitur boleh dibangun di balik flag, jangan dirilis sebelum jelas).

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 9
- docs/02-erd.md bagian 3

## Tugas
1. Progres: setiap kemenangan Ranked peringkat 1 yang memenuhi syarat menambah `win_progress`; mencapai 20 menghasilkan 1 Tiket lewat `applyLedger` (alasan `ranked_wins`) dan mereset ke 0.
2. Syarat hitung: **maksimal 1 kemenangan dihitung per lawan per hari** dan game pasif tidak dihitung (`counted_for_ticket`).
3. Beri Tiket: batas 10 per minggu (dari `ticket_gift`); minta Tiket: satu per teman per hari, menjadi kartu di chat, bisa Beri atau Tolak. Hanya antar teman.
4. Taruhan 1 Tiket: hanya 1-1 dan game Sekarang; Tiket ditahan (escrow) saat masuk room; pemenang di antara dua orang mengambil keduanya; keluar dini dianggap kalah; satu taruhan per pasangan per hari; hanya Tiket, tidak pernah Koin atau uang.
5. Deteksi pola: akun yang menerima banyak Tiket dari banyak akun baru ditandai dan dibatasi.
6. Layar mobile: kartu Tiket di tab Turnamen (progres, minta, beri), kartu Tiket di sheet Ajak main, kartu permintaan di chat, taruhan di sheet Ajak main.

## Kriteria penerimaan
- [ ] Setiap batas di spesifikasi 9.2, 9.3, 9.4 punya uji gagal-bila-dihapus.
- [ ] Tidak ada jalur dari Koin atau Rupiah ke Tiket (uji + tinjauan kode).
- [ ] Saldo Tiket selalu sama dengan jumlah `ledger_entry` Tiket (uji invarian).

## Uji yang harus ada
- Uji win-trading: dua akun saling mengalah hanya menghasilkan 1 kemenangan dihitung per hari; uji batas beri 10 per minggu; uji permintaan ganda; uji taruhan (menang, kalah, keluar dini, ganda); uji invarian ledger lewat 1.000 operasi acak.

## Prompt siap tempel

```
Kerjakan Tahap 09 (docs/tahap/09-tiket.md). Bangun progres 20 kemenangan, beri dan minta Tiket, taruhan 1 Tiket dengan escrow, dan semua pembatasan anti-penyalahgunaan di spesifikasi bagian 9. Semua perubahan saldo lewat applyLedger. Tulis uji gagal-bila-dihapus untuk setiap batas, uji win-trading, dan uji invarian saldo sama dengan jumlah ledger. Pastikan tidak ada jalur Koin ke Tiket. Laporkan bila ada bagian taruhan yang berisiko hukum.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-09`.
# Tahap 10: Suara dan panggilan

**Tujuan:** Suara di room (maks 4) dan panggilan suara dan video 1-1 lewat WebRTC dengan TURN.

**Butuh keputusan manusia sebelum mulai:** Kebijakan rekaman suara pemain lain.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 5.3, 7.3
- rancangan lengkap bagian 5

## Tugas
1. Signaling lewat WebSocket; WebRTC P2P mesh maks 4 untuk room; TURN (coturn) otomatis sebagai cadangan, wajib untuk match acak.
2. Indikator jaringan per pemain (hijau, kuning, merah) dari statistik WebRTC; kuning menurunkan bitrate; merah mematikan suara pemain itu dan memindahkan game ke chat tanpa mengganggu pemain lain.
3. Mute, mikrofon, izin perangkat, penanganan audio saat aplikasi di latar.
4. Panggilan 1-1 suara dan video dengan layar panggilan; tombol Ajak main dari layar panggilan membuka sheet dengan mode Suara.
5. Kebijakan rekaman: suara pemain lain hanya direkam bila mereka mengizinkan (sesuai keputusan).
6. Panggilan ke teman Jangan ganggu atau Sibuk tidak berdering.

## Kriteria penerimaan
- [ ] Panggilan dan suara room berfungsi di dua perangkat nyata, termasuk lewat TURN (uji dengan jaringan seluler).
- [ ] Satu pemain merah tidak mematikan suara pemain lain (diuji).
- [ ] Match acak selalu lewat relay (diuji dengan memeriksa jenis kandidat ICE).

## Uji yang harus ada
- Uji logika indikator jaringan dengan statistik tiruan; uji manual di perangkat nyata dengan catatan hasil; uji pilihan TURN.

## Prompt siap tempel

```
Kerjakan Tahap 10 (docs/tahap/10-suara-panggilan.md). Bangun suara room (maks 4, WebRTC mesh, coturn sebagai cadangan, relay wajib untuk match acak), indikator jaringan tiga status per pemain, dan panggilan 1-1 suara dan video, sesuai spesifikasi 5.3 dan 7.3. Logika indikator harus bisa diuji dengan statistik tiruan. Catat hasil uji di perangkat nyata di docs/CATATAN-TAHAP.md.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-10`.
# Tahap 11: Toko dan Koin

**Tujuan:** Beli paket Koin lewat toko aplikasi, dan belanja kosmetik: avatar, emoji, skin dadu.

**Butuh keputusan manusia sebelum mulai:** Akun Google Play dan Apple Developer, serta harga paket Koin final.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 12
- docs/02-erd.md bagian 1

## Tugas
1. Integrasi RevenueCat (Google Play Billing dan Apple IAP); verifikasi di server lewat webhook; `purchase.store_txn` unik mencegah ganda; Koin masuk lewat `applyLedger` (`purchase_pack`).
2. Katalog `item` dan `owned_item`; beli dengan Koin (`buy_item`), tidak bisa dibeli dua kali.
3. Layar Profil: tab Avatar, Emoji, Skin dadu. Emoji store dengan paket tema dan percobaan 24 jam bila ada. Penggantian avatar.
4. Pemulihan pembelian (restore).
5. Koin tidak bisa dikirim, ditarik, atau dipakai untuk Tiket (tidak ada endpoint).

## Kriteria penerimaan
- [ ] Pembelian sandbox lulus di Android dan iOS; pembelian ganda tidak menambah Koin dua kali.
- [ ] Pembelian item mengurangi Koin atomik; saldo tidak pernah negatif.
- [ ] Tidak ada endpoint yang memindahkan Koin antar pengguna.

## Uji yang harus ada
- Uji webhook (idempoten); uji beli item (saldo cukup, kurang, ganda); uji restore.

## Prompt siap tempel

```
Kerjakan Tahap 11 (docs/tahap/11-toko-koin.md). Integrasi RevenueCat dengan webhook server idempoten, paket Koin, katalog kosmetik (avatar, emoji, skin dadu), layar toko bertab di Profil, restore purchase. Koin hanya untuk kosmetik; pastikan tidak ada jalur Koin ke Tiket dan tidak ada transfer Koin. Gunakan sandbox untuk uji.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-11`.
# Tahap 12: Komunitas

**Tujuan:** Feed utas dengan komunitas, postingan foto dan video, balasan, moderasi, dan iklan native.

**Butuh keputusan manusia sebelum mulai:** Batas usia dan kebijakan moderasi unggahan video.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 10
- docs/02-erd.md bagian 4
- prototipe: tab Untukmu, Mengikuti, Teman, komunitas, kartu iklan

## Tugas
1. Endpoint feed (Untukmu, Mengikuti, Teman), komunitas, bergabung, room komunitas, postingan, balasan, suka dan simpan, bagikan ke chat.
2. Unggah media lewat URL bertanda tangan ke penyimpanan S3; batas durasi 60 detik dan 50 MB; status moderasi `pending` sampai lolos pemindaian otomatis.
3. Moderasi: lapor, sembunyikan, blokir; antrean laporan untuk admin; pemindaian konten otomatis lewat antarmuka `ContentScanner` (adapter palsu dulu).
4. Iklan native: kartu 'Bersponsor' setiap 3 postingan, opsi sembunyikan, pembatasan frekuensi, catat `ad_impression` dengan placement 'feed' atau 'live' saja; kategori judi dan taruhan ditolak.
5. Kenalan hari ini: rekomendasi sederhana (game sama, kota sama).
6. Layar mobile sesuai prototipe, termasuk menulis postingan dari galeri.

## Kriteria penerimaan
- [ ] Alur lihat, tulis, balas, ikuti, dan bergabung berjalan di dua perangkat.
- [ ] Tidak ada iklan di respons chat atau room (diuji); kategori terlarang ditolak.
- [ ] Media pending tidak tampil ke publik.

## Uji yang harus ada
- Uji penempatan iklan; uji batas unggah; uji moderasi pending; uji laporan; E2E tulis dan baca postingan.

## Prompt siap tempel

```
Kerjakan Tahap 12 (docs/tahap/12-komunitas.md). Bangun feed Komunitas (Untukmu, Mengikuti, Teman), komunitas dan room komunitas, postingan foto dan video dengan moderasi pending, balasan, lapor, dan iklan native sesuai spesifikasi bagian 10. Iklan tidak pernah di chat atau game, dan kategori judi atau taruhan ditolak; tulis uji untuk itu. Ikuti tampilan prototipe.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-12`.
# Tahap 13: Games Store, Turnamen, dan Live

**Tujuan:** Tab Games lengkap (Main, Turnamen, Store) dan Live dengan Tonton dan Gabung.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 7.1, 9.5, 11

## Tugas
1. Store: aktivasi game bawaan dan 'segera'; game premium dengan pembelian Koin dan akses tamu gratis di room pemilik (kerangka, tanpa konten game baru).
2. Tab Turnamen: kartu Tiket dan progres, daftar turnamen (kerangka, tanpa hadiah uang); masuk dengan Tiket dicatat `tournament_entry`.
3. Live: daftar room yang tayang; Tonton (penonton, chat penonton, tangan tersembunyi, jeda tayang); Gabung ke kursi kosong. Iklan di sela, bukan di tengah giliran.
4. Kontrol pemain top atas chat penonton.

## Kriteria penerimaan
- [ ] Penonton tidak pernah menerima kartu tangan pemain (diuji di server).
- [ ] Penonton tidak bisa mengirim langkah.
- [ ] Aktivasi game dan kepemilikan premium bekerja.

## Uji yang harus ada
- Uji server: payload penonton tanpa tangan; uji penonton menolak langkah; uji akses tamu game premium.

## Prompt siap tempel

```
Kerjakan Tahap 13 (docs/tahap/13-store-turnamen-live.md). Bangun tab Games (Main, Turnamen, Store) dan Live (Tonton dan Gabung) sesuai spesifikasi 7.1, 9.5, dan 11. Server tidak boleh mengirim kartu tangan ke penonton dan harus menolak langkah dari penonton; tulis uji. Turnamen hanya kerangka tanpa hadiah uang.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-13`.
# Tahap 14: Notifikasi dan streak

**Tujuan:** Notifikasi push netral dan streak yang pemaaf.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 8, 13

## Tugas
1. Push lewat FCM dan APNs; token perangkat; jenis notifikasi dan pengaturan per jenis; teks netral tidak menyebut game; jam tenang 22:00 sampai 07:00; Jangan ganggu menahan.
2. Streak per pasangan teman: hari 03:00 sampai 03:00 WIB, pembeku gratis mingguan (tabung maks 2), pemulihan 24 jam dengan dua game, mode Senyap dan asinkron dihitung, pengingat maks 1 per hari, hanya bila streak 3 hari atau lebih.
3. Milestone 3, 7, 30, 100 hari memberi Bintang (`streak_milestone`).

## Kriteria penerimaan
- [ ] Aturan streak terbukti oleh uji termasuk batas hari dan pembeku.
- [ ] Tidak ada push di jam tenang dan saat Jangan ganggu (diuji).

## Uji yang harus ada
- Uji tabel streak dengan jam tiruan; uji penjadwal pengingat; uji pengaturan notifikasi.

## Prompt siap tempel

```
Kerjakan Tahap 14 (docs/tahap/14-notifikasi-streak.md). Bangun push netral dengan jam tenang dan pengaturan, serta streak pemaaf sesuai spesifikasi bagian 8 dan 13. Gunakan jam yang bisa disuntik agar uji batas hari WIB mudah. Streak tidak memengaruhi trofi atau Tiket.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-14`.
# Tahap 15: Pengerasan dan rilis

**Tujuan:** Keamanan, beban, kepatuhan, dan beta tertutup 50 sampai 100 pemain.

**Butuh keputusan manusia sebelum mulai:** Klasifikasi gim, pendaftaran PSE, kebijakan privasi, dan ambang keputusan beta.

## Masukan (baca dulu)
- Seluruh dokumen
- rancangan lengkap bagian 3 dan 8

## Tugas
1. Tinjauan keamanan: OWASP Mobile dan API, rate limit semua endpoint publik, pemeriksaan otorisasi per sumber daya (uji IDOR), rotasi rahasia, pencadangan basis data.
2. Uji beban: 500 room bersamaan, 5.000 koneksi; pantau latensi gerakan di bawah 300 ms median.
3. Pemantauan: log terstruktur tanpa data pribadi, metrik (retensi, undangan diterima, suara jatuh ke TURN), pelacak galat.
4. Kepatuhan: kebijakan privasi dan persetujuan (UU PDP), halaman syarat, klasifikasi gim (Permenkominfo 2/2024), pendaftaran PSE, label usia di toko.
5. Pengujian oleh Claude: jalankan seluruh suite, E2E semua alur utama di dua perangkat, uji eksplorasi bermodal daftar risiko, dan laporan cacat.
6. Beta tertutup: TestFlight dan jalur uji Google Play, formulir umpan balik, ambang keputusan Fase 1 ditetapkan sebelum mulai (lihat rancangan lengkap bagian 8).

## Kriteria penerimaan
- [ ] Tidak ada temuan keamanan tingkat tinggi yang terbuka.
- [ ] Uji beban memenuhi target.
- [ ] Daftar periksa kepatuhan lengkap dan disetujui manusia.
- [ ] Build beta terpasang di perangkat nyata Android dan iOS.

## Uji yang harus ada
- Uji IDOR untuk semua sumber daya; uji rate limit; uji beban; E2E penuh.

## Prompt siap tempel

```
Kerjakan Tahap 15 (docs/tahap/15-pengerasan-rilis.md). Lakukan tinjauan keamanan API dan mobile, uji otorisasi per sumber daya (IDOR), rate limit, uji beban 500 room, pemantauan tanpa data pribadi, dan daftar periksa kepatuhan. Jalankan seluruh suite dan E2E, tulis laporan cacat, dan siapkan build beta. Jangan menyatakan siap rilis; serahkan daftar periksa kepatuhan untuk keputusan manusia.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-15`.
