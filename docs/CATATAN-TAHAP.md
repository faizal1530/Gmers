# Catatan Tahap

Diisi Claude Code di akhir setiap tahap: apa yang dibangun, keputusan, utang teknis, pertanyaan terbuka.

## MVP Tahap A: kerangka dan mesin Gaple (23 Nov 2026), tag `mvp-A`

### Dibangun
- Monorepo pnpm (`packages/game-engine`, `apps/server` dan `apps/web` kosong), `pnpm verify` = ESLint + `tsc` + vitest.
- `packages/game-engine`: `init(config, seed, rng?)`, `legalMoves(state, seat)`, `apply(state, move)` (mengembalikan state baru atau `{code, message}`), `status(state)`, `replay(config, seed, moves)`. State JSON serializable, memuat `seed` dan `log` langkah. RNG deterministik (mulberry32) dari seed, bisa diganti lewat parameter `rng`. Tanpa I/O; ESLint melarang `Math.random` dan `Date.now` di paket ini.
- Parameter aturan di `GapleConfig` (`config.ts`) sesuai tabel draf bagian 2. Yang sudah punya lebih dari satu nilai: `players` (2-4), `handSize` (6/7), `opening` (sixSix/zeroZero/random), `openerSeat` (rematch), `turnDirection`, `mustPlayIfAble`, `zeroZeroPenalty` (0/25). Varian yang belum dibangun (kartu mati, spinner, tim, skor target, banyak ronde) hanya punya satu nilai dan **ditolak** oleh `validateConfig` bila diubah, bukan diabaikan diam-diam.
- Lewat adalah langkah eksplisit (`{type:'pass'}`); server di Tahap B yang mengirimnya saat batas waktu habis.

### Uji (54 uji, semua lulus)
- Uji unit per aturan di draf bagian 6: set 28 kartu/168 titik, pembagian 2-4 pemain, pembuka 6|6 dan fallback, kecocokan ujung dan balak, lewat, terkunci setelah n lewat, skor (13 dan 5), peringkat seri.
- Uji properti: konservasi 28 kartu di setiap langkah, `apply` murni (masukan beku tidak berubah), replay dari seed + log menghasilkan state identik, `apply` menerima langkah **iff** ada di `legalMoves` (semua kartu x ujung x kursi diperiksa).
- Simulasi 10.000 game acak per 2, 3, 4 pemain (tiap game dicek invarian per langkah; tiap 10 game dicek semua kandidat langkah), ditambah 8 varian parameter x 2.000 game. Tanpa pelanggaran dan tanpa kebuntuan.

| Pemain | Kartu habis | Terkunci | Rata-rata langkah | Maks | Pembuka cadangan (6\|6 tak dibagikan) |
|---|---|---|---|---|---|
| 2 | 34,4% | 65,6% | 13,1 | 20 | 50,1% |
| 3 | 53,7% | 46,3% | 20,8 | 35 | 24,5% |
| 4 | 75,5% | 24,5% | 26,8 | 39 | 0% |

### Keputusan yang saya ambil (default, bukan dari draf)
- Pemain acak di simulasi hanya memilih dari `legalMoves`; kekuatan bermain tidak diuji (bot hanya untuk uji).
- Di meja kosong, kartu pembuka dipasang dengan `end: 'left'` saja (satu bentuk langkah sah).
- Lewat dengan `mustPlayIfAble=true` hanya sah bila tidak ada kartu cocok; pembuka tidak boleh lewat.
- Seri lapis 3 (urutan duduk dari pembuka) diimplementasikan sebagai pengaman, tetapi tak terjangkau: dua kartu berbeda tak pernah punya jumlah titik dan sisi terendah yang sama. Lapis 1 dan 2 sudah menentukan urutan penuh.
- Tafsir `zeroZeroPenalty=25` (draf: "25 bila tidak ada kartu kosong lain di tangan"): 0|0 bernilai 25 hanya bila tak ada kartu lain dengan angka 0 di tangan; selain itu 0. Default tetap 0.
- Tafsir tie-break 1-2 (draf): bandingkan kartu sisa dengan jumlah titik terendah, lalu angka terendah pada kartu itu. Memakai titik mentah (0|0 = 0), bukan penalti.

### Pertanyaan terbuka untuk Faizal (pilihan [USUL] di draf)
1. **Arah putar**: searah jarum jam (default). Setelah wawancara, apakah mahasiswa ITB main ke kiri/kanan?
2. **Pembuka 2 dan 3 pemain**: 6|6 hanya dibagikan ke pemain pada 50% (2 pemain) dan 75% (3 pemain) game; selebihnya pemegang balak tertinggi membuka (fallback [USUL]). Pada 2 pemain, setengah game memakai fallback, jadi aturan ini sering terpakai. Apakah dipertahankan, atau lebih baik 6|6 selalu dibagikan lebih dulu / pembuka acak?
3. **Urutan pemecah seri**: titik sisa terendah, lalu kartu tunggal terendah, lalu ujung terendah, lalu urutan duduk. Setuju?
4. **Pembuka rematch**: pemenang game sebelumnya membuka dengan kartu bebas (parameter `openerSeat`; server Tahap B yang mengisinya). Setuju?
5. **Lewat wajib bila ada kartu cocok** (`mustPlayIfAble`): dipakai default. Pada 2 pemain, 65,6% game berakhir terkunci; angka ini normal untuk gaple 2 pemain tanpa tumpukan ambil, tetapi layak dicek saat wawancara apakah mahasiswa menganggapnya wajar.
6. **Kartu mati, 2 lawan 2, skor kumulatif**: sengaja belum dibangun (parameter ditolak). Dibangun hanya bila wawancara menyebutkannya.

### Utang teknis
- `apps/server` dan `apps/web` hanya `package.json` + `src/.gitkeep`. Belum ada ADR.
- Isi `main` di GitHub sebelumnya di-force-push dan riwayatnya terpisah dari branch kerja ini; branch kerja menggabungkannya dengan `--allow-unrelated-histories`. Mungkin perlu dirapikan saat PR.

## MVP Tahap B: server room WebSocket (23 Nov 2026), tag `mvp-B`

### Dibangun (`apps/server`)
- Satu proses Node + `ws`, room di memori. `src/config.ts` (semua angka dan jalur, dapat ditimpa lewat `GMERS_*`), `protocol.ts` (skema zod), `service.ts` (`RoomService`: seluruh logika room, tanpa socket), `server.ts` (lapisan WebSocket + `/healthz`), `store.ts` (log JSONL hanya-tambah), `events.ts` (`EventSink`, adapter CSV), `clock.ts` (jam injeksi). Jalankan: `pnpm --filter @gmers/server start` (port `PORT`/`GMERS_PORT`, default 8787).
- Pesan klien: `create_room`, `join` (nama + token perangkat + kursi opsional; token yang sudah duduk = sambung ulang), `start` (hanya pembuat room), `play {card,end}`, `pass`, `chat`, `rematch`, `leave`, `ping`. Server: `state` (per pemain), `chat`, `error {code,message}` (Indonesia), `pong`, `left`. Klien tidak mengirim nomor kursi; server yang menetapkan dari token.
- Privasi kartu: pesan `state` hanya berisi `yourHand` milik penerima, `cardsLeft` angka untuk kursi lain, `yourMoves` (langkah sah hanya saat gilirannya), papan, dan hasil. Seed, tangan lain, dan kartu sisihan tidak pernah dikirim, termasuk setelah game selesai (hasil hanya titik dan jumlah kartu sisa).
- Sambung ulang: sama token = kursi, tangan, dan state sama. Tab kedua dengan token yang sama menggantikan koneksi lama (kode `REPLACED`, tutup 4001). Heartbeat: ping WebSocket tiap 25 detik; koneksi yang tak membalas diputus.
- Timer giliran 60 detik (`turnTimeoutMs`), dijalankan server dengan jam injeksi: habis dan ada langkah sah -> `legalMoves[0]` (kartu sah pertama, ujung kiri bila ada pilihan); tidak ada langkah sah -> lewat. Timer dimulai ulang tiap langkah dan setelah restart.
- Ketahanan: tiap kursi, mulai game, dan langkah ditulis ke `data/rooms.jsonl` (seed dan konfigurasi mesin ikut tersimpan; token disimpan sebagai hash; isi chat tidak pernah ditulis). Saat start, room dibangun ulang dengan replay mesin. Room yang tak aktif 24 jam dan tanpa pemain terhubung dihapus (sapuan tiap 10 menit) dan log dipadatkan.
- Rematch: game baru dengan pemain yang masih duduk; pemenang game sebelumnya membuka dengan kartu bebas (`openerSeat` mesin).
- Peristiwa ke `data/events.csv` (kolom handover bagian 6): `room_created`, `player_joined`, `player_left`, `reconnected`, `game_started`, `game_finished` (alasan + peringkat dalam kursi room), `rematch_clicked`, `message_sent` (tanpa isi). `device_id` = 16 hex pertama dari hash token + garam (`GMERS_HASH_SALT`). Alamat IP tidak pernah dibaca. Ekspor dan penghitung = Tahap D.

### Uji (50 uji server + 54 mesin, `pnpm verify` hijau, 3x berturut-turut stabil)
- Game penuh lewat WebSocket nyata untuk 2, 3, 4 klien sampai kartu habis **dan** terkunci; langkah ilegal/di luar giliran ditolak dan state tidak berubah; sambung ulang; heartbeat; restart dengan log berkas nyata (replay) lalu game dilanjutkan sampai selesai; privasi (daftar kunci pesan + `yourHand` = tangan sendiri di tiap langkah game penuh); timer giliran dengan jam palsu (ada langkah sah, hanya lewat, pembatalan oleh langkah manual); rematch; pembersihan 24 jam; CSV dan log tanpa isi chat, nama, token mentah, IP.
- Beban: 50 room bersamaan (campuran 2/3/4 pemain), 149 koneksi, 993 langkah, selesai dalam sekitar 0,5 detik, tanpa kesalahan.

### Keputusan yang saya ambil (default)
- Memulai game: hanya pembuat room (kursi terkecil bila pembuat keluar). Rematch: siapa pun yang duduk, langsung mulai tanpa menunggu persetujuan. Alternatif: semua pemain terhubung harus menekan rematch.
- Tidak boleh masuk room saat game berjalan (`GAME_IN_PROGRESS`); tidak ada penonton. Keluar (`leave`) hanya di lobi atau setelah game selesai; saat game berjalan pemain cukup menutup halaman, dan gilirannya dimainkan otomatis oleh timer.
- `player_left` dicatat hanya untuk keluar eksplisit, bukan putus koneksi; `reconnected` dicatat tiap `join` dengan token yang sudah duduk. `invite_link_opened` belum ada (butuh HTTP/klien; Tahap C atau D).
- Nama panggilan boleh kembar; pemain dibedakan lewat kursi.
- Chat tidak disimpan dan tidak dikirim ulang saat sambung ulang (riwayat chat hilang saat refresh). Belum ada pembatas laju chat.

### Belum dibangun / utang teknis
- Pembatas laju pesan per koneksi dan pembatas pembuatan room per perangkat (cegah penyalahgunaan); perlu dipertimbangkan sebelum tautan disebar luas.
- Timer "hanya lewat" menunggu penuh 60 detik, sesuai prompt. Usulan: lewat otomatis lebih cepat (mis. 3 detik) saat pemain tak punya langkah sah, supaya game tidak tersendat; satu parameter konfigurasi bila Anda setuju.
- Tidak ada sajian berkas statis klien (Tahap C), tidak ada ekspor CSV berpelindung token (Tahap D), tidak ada TLS (diurus hosting).
- Log JSONL ditulis sinkron per langkah; cukup untuk MVP, bukan untuk ribuan room.
- Tag `mvp-A` belum bisa di-push dari sandbox ini (koneksi tag ditolak); tag dibuat lokal. Tag `mvp-B` kemungkinan sama.

### Pertanyaan terbuka untuk Faizal
1. Rematch langsung mulai oleh satu orang, atau perlu semua pemain setuju? (default: langsung)
2. Boleh lewat otomatis lebih cepat saat tidak ada langkah sah? (default: tunggu 60 detik)
3. Boleh pemain bergabung ke game yang sedang berjalan sebagai penonton? (default: tidak; di luar cakupan handover)
4. Pertanyaan Tahap A (arah putar, pembuka 2-3 pemain, pemecah seri) masih terbuka; server memakai default mesin.

## MVP Tahap C: klien web (24 Nov 2026), tag `mvp-C`

### Dibangun
- **Langkah 0, kelompok menetap (server):** kode di tautan = `group_id` yang tidak pernah kedaluwarsa. Sesi room (`room_id`) boleh dibersihkan setelah 24 jam; membuka kode yang sama membuat sesi baru dengan `group_id` sama (bukan galat). Catatan `group` di log JSONL tidak ikut dipadatkan. Pesan baru: `open_link {groupId, token}` (mencatat `invite_link_opened`, membalas `group_info` tanpa membuat sesi). `join` kini memakai `groupId`. `state.room` memuat `groupId` (tetap) dan `id` (sesi). Semua peristiwa membawa `group_id`; `room_created` diganti `group_created`. Nama panggilan server: 2 sampai 16 karakter. Pembatas laju chat server: 5 pesan per 10 detik (`RATE_LIMITED`).
- **Server menyajikan situs:** `apps/web/dist` disajikan satu proses yang sama (rute klien dijawab `index.html`, jalur aset ber-hash di-cache panjang), dengan header keamanan (CSP tanpa pihak ketiga, `no-referrer`, dll.). Font Plus Jakarta Sans di-host sendiri lewat `@fontsource` (tidak ada permintaan ke Google Fonts).
- **`apps/web` (Vite + TypeScript, tanpa kerangka):** beranda (nama + Buat room), masuk lewat tautan, ruang tunggu (kursi, Siap/Terputus, Salin, Bagikan ke WhatsApp lewat `wa.me`), meja Gaple, chat, hasil + Main lagi, sambung ulang otomatis, halaman tidak ditemukan, `/privasi` (DRAF). Semua teks di `src/i18n/id.ts` (ada uji yang memindai kode agar tidak ada kalimat di luar berkas itu). Terang/gelap sesuai token, `prefers-reduced-motion` dihormati, target sentuh minimal 44 px.
- Sambung ulang: backoff 0,5, 1, 2, 4, lalu 5 detik; ping tiap 20 detik; pemicu langsung saat `online` dan saat tab kembali aktif; banner "Menyambung kembali..." dan kartu tetap tampil tetapi tidak bisa dikirim selama terputus; langkah tidak diantre.
- Token perangkat dan nama di `localStorage` dengan `try/catch` dan cadangan memori.

### Uji
- 43 uji logika dan komponen (jsdom, socket palsu): hanya langkah dari `yourMoves` yang bisa dikirim (kartu redup tidak mengirim apa pun, pilihan ujung saat cocok di dua sisi, Lewat hanya bila tak ada langkah lain, bukan giliran = semua nonaktif), alur tautan, sambung ulang dan backoff, HTML di chat tampil sebagai teks, penanda belum dibaca, pembatas laju.
- **E2E Chromium sungguhan** (`pnpm e2e`, bagian dari `pnpm verify`): 4 konteks browser membuka satu tautan, masuk, bermain game 1 sampai selesai, satu pemain refresh di tengah dan kembali ke kursi dengan kartu yang sama tanpa mengisi nama lagi, rematch, game 2 sampai selesai; chat dengan HTML; tanpa overflow horizontal di 360 px (beranda, formulir masuk, ruang tunggu, meja, chat terbuka, hasil); tanpa galat konsol; tanpa permintaan ke pihak ketiga. Tangkapan layar (terang dan gelap) di `apps/web/e2e/out/` (tidak di-commit). Skrip menyatakan SKIP (bukan gagal) bila Chromium tidak tersedia.
- E2E menemukan satu bug nyata: Vite menyisipkan font kecil sebagai `data:` URL yang diblokir CSP. Diperbaiki dengan `assetsInlineLimit: 0`.

### Keputusan otomatis (Tahap C)
1. **Vanilla TypeScript, bukan Preact.** Alasan: ukuran (JS 28 KB), tanpa dependensi runtime selain font, dan semua teks lewat node teks (tanpa `innerHTML`) sehingga XSS tertutup. Mengubah: tulis ulang `src/views/*` sebagai komponen; logika (`logic.ts`, `net.ts`, `storage.ts`) tetap.
2. **"Siap" = terhubung.** Server tidak punya konsep siap; kursi tampil "Siap" bila pemain terhubung, "Terputus" bila tidak.
3. **Satu ketukan memasang kartu** bila hanya satu ujung sah; bila dua ujung sah muncul pilihan ujung.
4. **Chat dibuka dari tombol di header** (bukan tombol melayang) supaya tidak menutupi kartu; riwayat chat tidak dikirim ulang saat refresh (server tidak menyimpannya).
5. **Rantai kartu dibungkus beberapa baris** (bukan satu baris panjang yang digulir) agar tidak ada overflow; ujung kiri dan kanan selalu ditampilkan sebagai angka besar di atas papan, dan kartu pertama/terakhir diberi bingkai.
6. **Pembuat room wajib mengisi nama dulu di beranda**, supaya `create_room` langsung membawa nama.
7. Tab kedua dengan token yang sama menggantikan yang pertama (tab lama berhenti menyambung dan menjelaskan alasannya) agar tidak saling berebut sambung ulang.

## MVP Tahap D: pencatatan dan siap rilis uji (24 Nov 2026), tag `mvp-D`

### Dibangun
- **Pencatatan lengkap:** kolom CSV `ts_utc, ts_wib, group_id, room_id, device_id, event, game_no, detail`. Peristiwa `group_created, invite_link_opened, player_joined, player_left, reconnected, game_started, game_finished, rematch_clicked, message_sent`. `game_started` dan `game_finished` memuat `players=`, `devices=` (hash perangkat 16 hex, dipisah `|`), `reason=`, `ranking=` (kursi room), sehingga penghitung tahu siapa bermain bersama tanpa data pribadi. `invite_link_opened` dipancarkan saat klien membuka tautan (pesan WebSocket `open_link`).
- **Ekspor:** `GET /admin/events.csv`, token dari `ADMIN_TOKEN` (header `Authorization: Bearer` atau `?token=`), dibandingkan lewat hash dengan `timingSafeEqual`. Tanpa `ADMIN_TOKEN` di server: 503. Tanpa/salah token: 401. Berkas data lain tidak bisa diambil lewat web (diuji termasuk percobaan path traversal).
- **Penghitung:** `scripts/hitung-kelompok-aktif.ts` (`pnpm hitung events.csv --out hasil.csv`) dengan pustaka murni `scripts/lib/metrics.ts`. Keluaran: tabel per kelompok, ringkasan (aktif, selesai game pertama, konversi tautan dibuka -> masuk, main lagi dalam 7 hari), dan CSV hasil.
- **Privasi:** rute `/privasi` (Bahasa Indonesia, ditandai DRAF di halaman dan di berkas i18n; belum ditinjau ahli hukum).
- **Deploy:** `Dockerfile` (dua tahap, pengguna non-root, tanpa `.env`/data, `HEALTHCHECK`), `.dockerignore`, `docs/DEPLOY.md` (opsi layanan Docker dan VPS, variabel, log, restart, ekspor, cadangan, uji asap, pemecahan masalah).
- **Laporan:** `docs/LAPORAN-MVP.md`.

### Uji
- Penghitung: 19 uji termasuk semua kasus yang diminta (rematch hari sama, dua hari berbeda, 23.59 vs 00.01 WIB, 2 pemain, jendela 14 hari terlewat, jendela bergeser, perangkat ganda) plus parser CSV.
- Ekspor dan server: 10 uji HTTP (401/503/200, perbandingan token, penyajian statis, header keamanan, tidak bisa mengambil log, konfigurasi dari lingkungan: PORT, DATA_DIR, HASH_SALT, ADMIN_TOKEN, `/healthz`).
- CSV: uji sistem memeriksa seluruh kolom pada semua baris: tanpa isi chat, nama, token mentah, IP, nomor HP, dan `ADMIN_TOKEN`; log langkah juga bersih dari chat dan token mentah.
- **Uji sistem menyeluruh** (`scripts/test/sistem.test.ts`, 6 uji): server nyata dengan jam palsu, 5 kelompok x 5 hari simulasi, pemain otomatis lewat WebSocket (termasuk putus-sambung, keluar dari kursi, rematch lintas tengah malam WIB, sesi dibersihkan setelah 24 jam lalu kode yang sama membuka sesi baru), ekspor lewat endpoint, penghitung (di dalam proses dan lewat CLI), dan restart server dari log. Hasil sesuai harapan: hanya G1 (hari 1 dan 3) dan G5 (23.50 WIB dan 00.10 WIB) yang aktif; G2 (rematch hari yang sama), G3 (2 pemain), dan G4 (jendela terlewat) tidak.
- Build Docker tidak bisa diuji (daemon Docker tidak berjalan di sandbox). Tahap runtime image ditiru di folder sementara (`pnpm install --frozen-lockfile --prod --filter @gmers/server...`, hanya sumber server dan `dist`) dan server dijalankan dari sana dengan `PORT`, `DATA_DIR`, `HASH_SALT`, `ADMIN_TOKEN`: `/healthz` 200, situs dan rute klien 200, header keamanan ada, ekspor 401 tanpa token dan 200 dengan token, `events.csv` tertulis di `DATA_DIR`.

### Keputusan otomatis (Tahap D)
1. **Jendela 14 hari bergeser:** dua hari sah mana pun berjarak paling lama 13 hari kalender WIB. Alternatif: jendela tetap sejak game pertama kelompok. Ubah: parameter `--window` atau fungsi `computeReport` di `scripts/lib/metrics.ts`.
2. **Hari sebuah game = hari WIB saat `game_finished`** (bukan `game_started`), sehingga game yang melewati tengah malam dihitung di hari selesainya.
3. **Peserta game ada di kolom `detail`** (hash perangkat 16 hex), karena `game_finished` tidak punya `device_id` tunggal. Ini bukan data pribadi, tetapi lebih dari "hanya hitungan" yang diminta untuk chat; chat tetap hanya hitungan.
4. **`invite_link_opened` dikirim klien lewat WebSocket (`open_link`), bukan lewat HTTP GET**, supaya pratinjau tautan WhatsApp dan perayap tidak dihitung sebagai orang yang membuka tautan. Konsekuensi: orang yang membuka tautan tetapi JavaScript-nya gagal jalan tidak tercatat.
5. **Token admin lewat header atau `?token=`.** Query string praktis untuk pengguna non-teknis tetapi tersimpan di riwayat peramban; DEPLOY.md menyarankan header. Tanpa `ADMIN_TOKEN` ekspor mati (503), tidak ada nilai bawaan.
6. **Server dijalankan lewat `tsx` (TypeScript tanpa langkah build)** di dalam kontainer: lebih sederhana, sedikit lebih lambat start. Ubah: bundel server dengan esbuild dan jalankan `node`.
7. **Retensi 90 hari hanya tertulis di draf privasi; belum ada penghapusan otomatis** (DEPLOY.md bagian 7 menjelaskan penghapusan manual). Kontak permintaan hapus data = "lewat orang yang mengajakmu bermain" sampai Anda menetapkan kanal resmi.
8. **Satu token perangkat = satu orang.** Dua HP atau data peramban yang dihapus dihitung sebagai dua orang.

### Pertanyaan terbuka tersisa
Pilihan [USUL] aturan Gaple (arah putar, pembuka 2-3 pemain, pemecah seri, rematch, lewat otomatis, penonton), kanal kontak privasi, dan wawancara ITB. Lihat `docs/LAPORAN-MVP.md` bagian 4 dan 5.

## Keputusan otomatis: ringkasan untuk ditinjau
Total 20 keputusan, semuanya bisa diubah tanpa membongkar arsitektur:
- Tahap B (5): "Keputusan yang saya ambil (default)" di bagian Tahap B di atas.
- Tahap C (7): "Keputusan otomatis (Tahap C)".
- Tahap D (8): "Keputusan otomatis (Tahap D)".
