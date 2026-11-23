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
