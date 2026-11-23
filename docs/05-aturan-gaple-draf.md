# Aturan Gaple (draf untuk mesin game)

Status: **DRAF untuk direview, belum dikunci.** Disusun 23 Nov 2026. Gaple adalah game MVP Room Web (diputuskan 12 Nov). Varian yang dimainkan mahasiswa ITB Bandung harus dikonfirmasi lewat wawancara sebelum mesin dibangun. Setelah dikunci, isi dokumen ini dipindahkan ke bagian 7.4 spesifikasi.

## 0. Cara membaca dokumen ini

- Tanda **[SPEK]** = sudah tertulis di spesifikasi dan tahap 03 (28 kartu, 7 per pemain, 6|6 membuka, ujung kiri dan kanan, lewat, game terkunci dihitung sisa titik, 2-4 pemain).
- Tanda **[SUMBER]** = ada di sumber internet yang saya buka (Pagat, OnlineDominoGames).
- Tanda **[USUL]** = pilihan saya untuk menutup celah. Ini yang paling perlu Anda periksa.
- Gaple punya banyak varian lokal. Tidak ada satu aturan baku, jadi setiap angka di bawah adalah **parameter**, bukan konstanta di kode.

## 1. Apa kata sumber

| Hal | Pagat | OnlineDominoGames | Catatan |
|---|---|---|---|
| Set | 28 kartu (double-six) | sama | |
| Pemain | 4 atau 5 | 4 | Pagat: 4 pemain individual atau 2 lawan 2 |
| Bagi | 4 pemain: 6 kartu (4 tertutup di tengah) atau 7 kartu (habis) | 6 kartu, sisa 3 tidak dipakai | Spesifikasi kita memakai 7 kartu |
| Pembuka | 4 pemain 7 kartu: pemegang 0\|0 wajib membuka di ronde pertama | Satu kartu ditaruh di tengah; pembuka ronde 1 acak | Pagat tidak menyebut 6\|6. Spesifikasi kita memakai 6\|6 |
| Tidak bisa main | Buang 1 kartu tertutup ("mati"), dihitung sebagai poin lawan; variasi: boleh lewat | Buang 1 kartu tertutup | Spesifikasi kita memakai "lewat" tanpa buang |
| Ronde selesai | Kartu habis atau tidak ada yang bisa main | sama | |
| Skor | Jumlah titik kartu tersisa (termasuk kartu mati); terendah menang; 0\|0 bisa dihitung 25 | sama; menang ronde dapat selisih; game sampai 100 poin | |
| Seri | Kartu tunggal titik terendah, lalu ujung terendahnya | sama | |

Aturan lokal Bandung bisa berbeda dari semua ini.

## 2. Usulan: mesin berbasis parameter

| Parameter | Default usulan | Alternatif | Asal |
|---|---|---|---|
| `players` | 4 (didukung 2 sampai 4) | | [SPEK] |
| `handSize` | 7 | 6 | [SPEK] |
| `opening` | ronde 1: pemegang 6\|6 wajib membuka dengan 6\|6; ronde berikutnya: pemenang ronde lalu membuka dengan kartu bebas | pemegang 0\|0; pembuka acak | [SPEK] + [USUL] |
| `openingFallback` | bila 6\|6 tidak dibagikan (2 atau 3 pemain): pemegang balak tertinggi membuka; tanpa balak: kartu dengan jumlah titik tertinggi | | [USUL] |
| `turnDirection` | searah jarum jam | berlawanan | [USUL] |
| `passRule` | lewat tanpa buang, **hanya** bila tidak ada kartu yang bisa dimainkan | buang kartu mati tertutup | [SPEK] |
| `mustPlayIfAble` | benar (tidak boleh lewat bila ada kartu cocok) | | [USUL] |
| `spinner` | tidak ada (balak hanya dipasang di ujung, rantai tetap satu garis) | | [SUMBER] |
| `blockedWinner` | sisa titik terendah menang | | [SPEK] |
| `tieBreak` | 1) kartu tunggal sisa dengan titik terendah, 2) ujung terendah dari kartu itu, 3) urutan duduk dari pembuka | | [SUMBER] + [USUL] |
| `zeroZeroPenalty` | mati (0\|0 dihitung 0) | 25 bila tidak ada kartu kosong lain di tangan | [SUMBER] |
| `roundsPerGame` | 1 (satu ronde = satu game; tombol rematch memulai game baru) | beberapa ronde sampai `targetScore` | [USUL] |
| `targetScore` | tidak ada | 100 | [SUMBER] |
| `teams` | mati (semua individual) | 2 lawan 2 | [SUMBER] |
| `turnTimeoutSec` | 60 (diurus server, bukan mesin) | | [USUL] |

Default memakai spesifikasi kita bila ada, dan untuk sisanya memilih yang paling sederhana untuk MVP. Satu ronde per game sengaja dipilih: tombol rematch sudah ada di MVP, dan tidak perlu papan skor kumulatif untuk menguji apakah kelompok mau main lagi.

## 3. Aturan lengkap (default usulan)

**Kartu.** 28 kartu double-six: tiap pasangan angka 0 sampai 6 sekali, termasuk 7 balak (0\|0 sampai 6\|6). Jumlah titik satu kartu = angka kiri + angka kanan. Total titik seluruh set 168.

**Persiapan.** 4 pemain, 7 kartu masing-masing, tidak ada sisa. Dengan 2 atau 3 pemain, kartu yang tidak dibagi disisihkan tertutup dan tidak dipakai; tidak ada tumpukan ambil (gaple tidak mengambil kartu). Kartu pembagian diacak server memakai RNG yang diinjeksi (seed tercatat di log).

**Pembuka.** Ronde pertama dibuka oleh pemegang 6\|6, dan kartu pertama wajib 6\|6. Bila 6\|6 tidak dibagikan, berlaku `openingFallback`. Pada rematch, pembuka adalah pemenang game sebelumnya dan boleh memainkan kartu apa saja.

**Giliran.** Searah jarum jam. Pada giliran, pemain wajib memasang satu kartu yang salah satu angkanya sama dengan angka di **ujung kiri** atau **ujung kanan** rantai. Kartu dipasang dengan angka yang cocok bertemu. Balak (kartu kembar) tidak membuka cabang; rantai selalu satu garis dengan dua ujung.

**Lewat.** Pemain yang tidak punya kartu cocok di kedua ujung wajib melewati giliran. Lewat tidak membuang kartu dan tidak dihukum. Pemain yang punya kartu cocok **tidak boleh** lewat (server menolak).

**Akhir game.**
1. **Kartu habis:** pemain yang menghabiskan kartu pertama menang (peringkat 1).
2. **Terkunci:** semua pemain berturut-turut lewat sehingga tidak ada yang bisa main. Pemenang adalah pemain dengan jumlah titik sisa terendah.

**Peringkat akhir (selalu urutan lengkap 1..n).**
- Bila kartu habis: pemenang peringkat 1, sisanya diurutkan menurut jumlah titik sisa dari kecil ke besar.
- Bila terkunci: semua diurutkan menurut jumlah titik sisa dari kecil ke besar.
- Bila jumlah titik sama: `tieBreak` di atas. Setelah ketiga langkahnya masih sama, urutan duduk dari pembuka menentukan (supaya peringkat selalu urutan penuh dan deterministik).

**Rematch.** Tombol rematch memulai game baru dengan pemain yang sama. Dihitung sebagai game terpisah untuk metrik: rematch di hari yang sama tidak menambah hitungan "kelompok aktif".

## 4. Hal yang sengaja belum ada

- Kartu mati (membuang kartu tertutup saat tidak bisa main). Hanya ada sebagai parameter alternatif.
- Gaple 2 lawan 2 dan skor kumulatif sampai 100.
- Taruhan apa pun. Taruhan 1 Tiket tidak masuk MVP.
- Lawan komputer. Bot hanya untuk simulasi uji.
- Aturan khusus daerah (misalnya "gaple kosong", "kartu mati", "kartu angin") sampai wawancara menyebutkannya.

## 5. Pertanyaan untuk mahasiswa (wawancara)

Tanyakan dengan cara Mom Test: minta cerita permainan terakhir, bukan "aturan apa yang Anda pakai".

1. Ceritakan permainan Gaple terakhir: berapa orang, berapa kartu dibagi, siapa yang jalan duluan dan kenapa?
2. Saat tidak punya kartu cocok, apa yang terjadi? Lewat saja, ketuk, atau buang kartu?
3. Kalau tidak ada yang bisa jalan lagi, bagaimana menentukan pemenang? Apa istilahnya?
4. Apakah ada yang main berpasangan (2 lawan 2)? Siapa partner-nya?
5. Satu game itu satu ronde, atau sampai skor tertentu? Berapa?
6. Ada kartu yang punya aturan khusus (0\|0, 6\|6)?
7. Kapan dan di mana biasanya main (kos, kantin, kelas)? Pakai kartu fisik atau aplikasi? Apa yang bikin ribut?
8. Arah main: ke kiri atau ke kanan?

## 6. Uji mesin (setelah varian dikunci)

- Set berisi tepat 28 kartu unik; jumlah titik total 168.
- Pembagian 4 pemain: 7 kartu masing-masing, tanpa sisa, tanpa duplikat; 2 dan 3 pemain: sisanya disisihkan.
- Ronde 1: pemain pemegang 6\|6 yang membuka, dan langkah selain 6\|6 ditolak.
- `openingFallback` dipakai bila 6\|6 tidak dibagikan.
- Kartu hanya sah bila cocok dengan ujung kiri atau kanan; balak tidak membuka cabang.
- Lewat ditolak bila ada kartu cocok; lewat diterima bila tidak ada.
- Terkunci terdeteksi setelah n lewat berturut-turut (n = jumlah pemain) tanpa kartu baru.
- Peringkat selalu urutan lengkap 1..n, termasuk seri tiga lapis, game kartu habis, dan game terkunci.
- Contoh skor: sisa 6\|6 dan 0\|1 = 13 titik; sisa 2\|3 = 5 titik.
- `apply` murni: state lama tidak berubah. Replay log langkah dari seed menghasilkan state akhir yang sama.
- Konservasi kartu: kartu di tangan + di meja + yang disisihkan selalu 28.
- Simulasi 10.000 game acak per jumlah pemain (2, 3, 4) selesai tanpa pelanggaran aturan dan tanpa kebuntuan.

## Sumber

- [Gaple, Pagat](https://www.pagat.com/domino/line/gaple.html)
- [Gaple Dominoes Game Rules, OnlineDominoGames](https://onlinedominogames.com/gaple-dominoes)
- Aturan 6\|6 membuka, lewat, dan skor titik sisa untuk game terkunci: spesifikasi proyek (`docs/01-spesifikasi.md` 7.4) dan `docs/tahap/03-mesin-game.md`.
- Pilihan bertanda [USUL] adalah usulan saya, bukan dari sumber.
