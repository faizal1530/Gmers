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
