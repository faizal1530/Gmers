# Gmers: Spesifikasi Produk (v1)

Sumber kebenaran untuk perilaku produk. Acuan visual dan alur: prototipe klik versi 14 (https://claude.ai/artifact/MJ1A9td18tdnNi2jaR4Hmw). Konteks bisnis dan hukum: `strategi/rancangan-lengkap.md` (di Project: `claude/social-gamr-rancangan-lengkap.md`). Bila prototipe dan dokumen ini berbeda, dokumen ini yang berlaku, dan prototipe diperbaiki.

Kata kunci: **WAJIB** = tidak boleh dilanggar. **Sebaiknya** = default yang boleh diubah dengan alasan. Semua angka adalah asumsi awal yang disimpan sebagai konfigurasi server, bukan konstanta di klien.

## 1. Ringkasan

Aplikasi chat gaya WhatsApp/Telegram untuk Android dan iOS, dengan game papan dan kartu yang dimainkan bersama teman. Tiga game awal: **Ludo, Remi, dan Gaple**. Ludo berperan sebagai game yang lebih mudah (pintu masuk bagi pemain baru), sedangkan Gaple dan Remi adalah game yang dimainkan di klaster beta pertama (mahasiswa ITB, Bandung). **Tidak ada lawan komputer.** Selama bermain pemain bisa ngobrol lewat suara atau chat. Posisi: "main bareng teman", bukan "produk game".

Empat tab: **Chat**, **Komunitas**, **Games**, **Live**. Profil dibuka dari tab Chat (atau ikon profil).

Tim: 2 orang dan Claude. Implikasi: pilih teknologi yang sedikit komponennya, uji otomatis sebanyak mungkin, dan hindari fitur yang butuh moderasi manual besar di fase awal.

## 2. Prinsip WAJIB (hukum dan keamanan)

1. **Tiga mata uang terpisah.**
   - **Trofi**: hanya dari bermain Ranked. Tidak bisa dibeli, dikirim, atau dijual.
   - **Koin**: dibeli dengan Rupiah lewat toko aplikasi. Hanya untuk kosmetik (avatar, emoji, skin dadu). Tidak bisa dikirim, ditarik, atau ditukar jadi Tiket.
   - **Tiket**: dari prestasi (menang Ranked) atau pemberian teman. Tidak bisa dibeli dan tidak punya jalur dari Koin atau Rupiah.
   - **Bintang**: mata uang gratis (misi, main bersama). Tidak bisa dibeli.
2. **Tidak ada jalur dari uang ke hadiah.** Uang masuk lewat Koin, Koin keluar hanya sebagai kosmetik.
3. **Iklan tidak pernah muncul di chat atau saat game berjalan.** Iklan hanya di feed Komunitas dan Live. Kategori iklan judi dan taruhan diblokir.
4. **Orang asing tidak bisa mengirim pesan langsung.** Chat dan ajak main hanya untuk **teman** (bagian 6).
5. **Tidak ada lawan komputer.** Teman di room demo prototipe hanyalah simulasi.
6. Hasil game, trofi, Tiket, Koin, dan Bintang dihitung dan divalidasi **di server**. Klien tidak dipercaya.
7. Perlindungan pengguna muda: pengguna di bawah 18 tahun tidak menerima kontak orang asing di luar room, tidak ada penjualan item streak, hadiah uang hanya 18+ dengan verifikasi (fase 3).

## 3. Akun dan onboarding

Urutan layar (WAJIB berurutan):
1. **Login dengan Google.** Tanpa email dan kata sandi sendiri.
2. **Nomor HP.** Format +62, diawali 8, 9 sampai 12 angka, awalan 0 dibuang. Nomor dipakai untuk keamanan dan mencegah akun ganda. Nomor tidak pernah ditampilkan ke pengguna lain.
3. **Kode OTP 6 angka** lewat SMS atau WhatsApp. Kedaluwarsa 5 menit, maksimal 5 percobaan, kirim ulang setelah 60 detik, maksimal 5 kirim per nomor per jam.
4. **Avatar dasar dan nama panggilan.** Hanya avatar basic (6 pilihan) yang tersedia di awal. Avatar lain dibeli dengan Koin. Nama panggilan 1 sampai 20 karakter.

Aturan: satu nomor HP hanya untuk satu akun. Akun baru mulai di kelas **Pemula** dengan 0 trofi.

## 4. Kelas dan avatar

Kelas berdasarkan trofi, tampil sebagai lencana di sudut avatar di semua tempat:

| Kelas | Trofi minimum |
|---|---|
| Pemula | 0 |
| Jago | 100 |
| Pro | 300 |
| Master | 600 |
| Raja | 1000 |

- Avatar basic a1 sampai a6 gratis. Avatar premium (contoh: Astronot, Kucing Belang) dibeli dengan Koin, sekali beli milik selamanya.
- Pemilik avatar bisa mengganti avatar kapan saja di Profil.

## 5. Chat

### 5.1 Tiga jenis percakapan
| Jenis | Aturan |
|---|---|
| **1-1** | Hanya antar teman. Punya ikon dadu (Ajak main), panggilan suara dan video, streak. |
| **Grup** | Permanen. Anggota dipilih dari teman. Maksimal 50 anggota (sebaiknya). |
| **Room sekali pakai** | Grup untuk main game. Otomatis terhapus 24 jam setelah aktivitas terakhir (pesan atau game). Penghitung sisa waktu terlihat. Memasuki room atau bermain menyegarkan waktunya. |

### 5.2 Pesan
Teks, emoji (standar gratis, paket premium dengan Koin), kartu undangan game, kartu Tiket, foto (opsional fase 2). Status baca dasar. Tombol "+" mengambang di kanan bawah membuka Chat baru dan Grup baru.

### 5.3 Panggilan
Suara dan video 1-1 lewat WebRTC. Dari layar panggilan ada tombol "Ajak main" yang menutup panggilan dan membuka sheet Ajak main dengan mode Suara. Panggilan ke teman berstatus Jangan ganggu atau Sibuk tidak berdering.

### 5.4 Status pengguna
Siap main, Sibuk, Senyap, **Jangan ganggu**. Jangan ganggu: undangan ditahan tanpa notifikasi dan baru dilihat setelah pengguna kembali; panggilan tidak berdering. Di dalam room ada pintasan "Jangan ganggu selama di room" yang dipulihkan otomatis saat keluar.

## 6. Pertemanan

Dua orang **berteman** kalau salah satu terpenuhi:
- saling mengikuti, atau
- saling menyimpan kontak.

Aturan:
- Pertemanan dihitung ulang setiap kali ikuti, berhenti mengikuti, simpan kontak, atau hapus kontak berubah. Kalau tidak ada syarat yang terpenuhi, pertemanan **putus**.
- Setelah putus: riwayat chat tetap terlihat, kolom tulis diganti pesan "Kalian bukan teman lagi", tombol Ajak main hilang, orang itu hilang dari daftar Chat baru dan Bagikan, serta pindah ke daftar "Menunggu saling".
- Pengguna bisa memblokir dan melaporkan. Blokir memutus pertemanan dan semua kontak.
- Orang asing hanya bisa diikuti dan dilihat profilnya. Tidak bisa chat.

## 7. Games

### 7.1 Tab Games: Main, Turnamen, Store
- **Main**: daftar game yang diaktifkan, "Ranked lawan acak", "Cari lawan", dan mulai room.
- **Turnamen**: turnamen dan kartu Tiket (bagian 9).
- **Store**: game yang bisa diaktifkan. Ludo, Remi, dan Gaple bawaan. Game lain (Ular Tangga, Congklak, Catur, Cangkulan) tampil sebagai "segera" atau bisa diaktifkan bila sudah ada. Game premium (contoh Jalan Hidup) dibeli dengan Koin; pemilik room membeli sekali, tamu main gratis.

### 7.2 Mengajak main (sheet Ajak main)
Pilihan: **Game**, **Kapan** (Sekarang, atau Nanti dengan giliran 24 jam), **Mode room yang disarankan** (Suara, Chat, Senyap), **Ranked** (hanya untuk Sekarang), **Taruhan 1 Tiket** (hanya 1-1 dan Sekarang, bagian 9.4), dan kartu Tiket.
- Undangan menjadi kartu di chat. Penerima: Gabung (memilih mode sendiri), Nanti, atau Lagi sibuk.
- Kedaluwarsa undangan: 15 menit (live), 24 jam (asinkron).
- Penerima berstatus Jangan ganggu: undangan **ditahan**. Berstatus Sibuk: dibalas otomatis "Lagi sibuk, nanti ya".
- Mode Suara hanya sampai 4 pemain.

### 7.3 Room
- 2 sampai 4 pemain. Tiap pemain boleh memilih mode sendiri (Suara, Chat, Senyap).
- Indikator jaringan per pemain: hijau, kuning (bitrate turun), merah (suara mati, game pindah ke chat). Satu pemain merah tidak mematikan suara pemain lain.
- Match acak (Ranked) wajib lewat relay TURN supaya alamat jaringan pemain tersembunyi.
- Tombol: Mute, Jangan ganggu, Keluar, dan **Rekam** (bagian 7.6). Pemain bisa melapor atau memblokir pemain lain dari room.
- Game selesai: layar hasil, ringkasan trofi, Bintang, Tiket, streak, lalu "Main lagi" atau "Kembali ke chat".
- Keluar sebelum selesai dihitung kalah. Sebaiknya di Ranked dihitung peringkat terakhir (prototipe belum mensimulasikan ini).

### 7.4 Aturan game
**Ludo (2-4 pemain):** jalur 52 petak, 4 bidak per pemain. Keluar kandang dengan angka 6. Angka 6 memberi giliran tambahan. Memakan bidak lawan memberi giliran tambahan. Petak aman: 0, 13, 26, 39, 8, 21, 34, 47 (tidak bisa dimakan). Bidak masuk garis finish tepat di 56. Menang bila keempat bidak finish.

**Gaple (2-4 pemain):** 28 kartu domino (0|0 sampai 6|6), masing-masing pemain 7 kartu (pada 2 atau 3 pemain, sisa kartu tidak dipakai; ini perlu dikonfirmasi saat membangun mesin). Pemegang 6|6 membuka. Kartu diletakkan di ujung kiri atau kanan yang angkanya cocok. Tidak punya kartu cocok: lewat. Menang bila kartu habis lebih dulu. Bila semua lewat (game terkunci): pemenang adalah yang jumlah titik sisa kartunya paling sedikit.

**Remi (2-4 pemain):** memakai kartu remi standar. **Varian aturan belum ditetapkan** (jumlah kartu per pemain, cara menurunkan dan menyusun kartu, penghitungan poin, pemakaian joker). Varian dikunci dari wawancara dengan mahasiswa Bandung (pertanyaan terbuka nomor 7). Draf aturan: `04-aturan-remi-draf.md`. Mesin Remi tidak dibangun sebelum varian dikunci dan ditulis di sini.

Seluruh logika aturan ada di paket TypeScript bersama (`packages/game-engine`) yang dipakai klien (tampilan dan prediksi) dan server (keputusan sah). Antarmuka mesin dibuat game-agnostic supaya menambah game tidak mengubah room, chat, dan ledger.

### 7.5 Ranked dan trofi
Ranked hanya untuk game Sekarang (live). Mode santai tidak mengubah trofi.

| Peringkat | Perubahan trofi (4 pemain) |
|---|---|
| 1 | +10 |
| 2 | +4 |
| 3 | -2 |
| 4 | -5 |

Format 2 pemain: menang +10, kalah -5. Pelindung: lantai kelas (trofi tidak turun di bawah batas kelas yang sudah dicapai), bonus game Ranked pertama hari itu +2, disconnect dihitung kalah tanpa hukuman tambahan. Bintang: +5 setiap game selesai (Bintang harian dibatasi, lihat konfigurasi).

### 7.6 Rekam
- Tombol Rekam di bar atas room. Saat merekam tampil indikator merah dan pewaktu mm:ss. **Semua pemain di room melihat tanda REC** dan mendapat pemberitahuan.
- Rekaman layar game ditulis ke **folder lokal perangkat** (Video/Gmers), nama file `Gmers_<Game>_<tanggal>_<jam>.mp4`. Tidak diunggah ke server.
- Suara pemain lain hanya ikut direkam kalau mereka mengizinkan (default: tidak).
- Berhenti otomatis saat keluar room atau game selesai.

## 8. Streak
Jumlah hari berturut-turut ketika kedua anggota pasangan menyelesaikan minimal satu giliran atau game bersama. Hari dihitung 03:00 sampai 03:00 WIB. Aturan pemaaf: 1 pembeku gratis per minggu (tabung maksimal 2), pemulihan gratis dalam 24 jam dengan dua game bersama, mode Senyap dan asinkron tetap dihitung, pengingat maksimal 1 per hari dan tidak dikirim 22:00 sampai 07:00. Streak tidak memengaruhi trofi atau Tiket. Hanya antar teman.

## 9. Tiket

### 9.1 Mendapat Tiket
- **Menang Ranked 20 kali (peringkat 1) = 1 Tiket.** Progres tampil di tab Turnamen dan di sheet Ajak main.
- Pemberian dari teman (9.2).
- Pemenang taruhan (9.4).
- Tidak ada pembelian Tiket.

### 9.2 Memberi dan meminta
- **Beri 1 Tiket** ke teman. Batas **memberi 10 Tiket per minggu**.
- **Minta 1 Tiket** ke teman: satu permintaan per teman per hari. Permintaan menjadi kartu di chat; penerima bisa Beri atau Tolak.
- Keduanya dapat dilakukan dari tab Turnamen dan dari ikon dadu di chat 1-1.

### 9.3 Anti penyalahgunaan (WAJIB)
- Kemenangan Ranked yang dihitung ke Tiket: **maksimal 1 kemenangan per lawan per hari**, dan game pasif (tanpa gerakan berarti) tidak dihitung. Tujuannya mencegah dua teman saling mengalah (win-trading).
- Deteksi pola: akun yang menerima Tiket dalam jumlah besar dari banyak akun baru ditandai dan dibatasi.
- Tiket tidak bisa dijual, ditarik, atau ditukar.

### 9.4 Taruhan 1 Tiket
Di 1-1 dan game Sekarang. Masing-masing menaruh 1 Tiket. Saat masuk room, Tiket ditahan (escrow) oleh server. Pemenang di antara kedua orang itu mengambil keduanya (+2 bersih +1); kalah memindahkan 1 Tiket. Keluar sebelum selesai dianggap kalah. Satu taruhan per teman per hari. Hanya 2 orang yang bertaruh meski room 4 pemain. Taruhan hanya dengan Tiket, **tidak pernah dengan Koin atau uang**. Jangan memasarkannya sebagai taruhan; sebut "tantang dengan Tiket".

**Keputusan risiko (dicatat 11 Nov 2026, diambil pemilik produk).** Taruhan 1 Tiket tetap masuk produk walau berada di area abu-abu hukum, dengan alasan tidak ada uang yang terlibat. Catatan penilaian: ukuran hukum dan kebijakan toko aplikasi bisa mencakup nilai selain uang tunai (Tiket punya nilai tidak langsung karena dipakai masuk turnamen berhadiah sponsor), dan risikonya tidak berhenti di fitur: penolakan atau penurunan dari toko aplikasi bisa mengenai seluruh aplikasi. Karena itu tiga pengaman berikut **WAJIB** ada sebelum rilis publik:
1. **Sakelar mati jarak jauh.** Fitur bisa dimatikan dari server, per wilayah atau seluruhnya, tanpa merilis versi baru (konfigurasi server, bukan konstanta klien).
2. **Hanya 18+.** Verifikasi usia khusus untuk Taruhan Tiket; pengguna di bawah 18 tahun tidak melihat opsi ini.
3. **Konsultasi hukum tertulis** (sekitar satu jam) sebelum rilis publik. Hasilnya juga dipakai untuk sponsor dan investor.

Syarat yang menjaga posisi ini dan tidak boleh dilonggarkan: Tiket tidak bisa dibeli, tidak ada jalur dari Koin atau Rupiah ke Tiket, dan Tiket tidak bisa ditarik, dijual, atau ditukar (bagian 2 dan 9.3). Bila hasil konsultasi hukum melarang, fitur dimatikan dengan sakelar tanpa mengubah bagian lain produk.

### 9.5 Pemakaian Tiket
Tiket dipakai masuk turnamen (fase 2). Turnamen gratis, hadiah dari sponsor, bukan dari uang pemain. Hadiah uang menunggu opini hukum tertulis (lihat rancangan lengkap bagian 3).

## 10. Komunitas

Tab Komunitas berbentuk **feed** (utas) dengan tiga tab: **Untukmu**, **Mengikuti**, **Teman**.
- **Postingan**: teks, foto, video, dikaitkan ke satu komunitas. Aksi: suka, balas (utas), bagikan (ke chat teman atau salin tautan), simpan. "Ikuti" pada penulis. "Sapa" pada postingan perkenalan. "Ajak main" muncul di postingan teman.
- **Komunitas** (contoh Gaple Bandung): punya deskripsi, jumlah anggota, daftar room komunitas yang bisa langsung dimasuki, dan halaman sendiri. Chip komunitas menyaring feed.
- **Kenalan hari ini**: kartu orang yang main game yang sama, dengan tombol Ikuti.
- **Teman**: daftar teman (Chat dan Ajak), daftar "Menunggu saling", dan feed dari teman.
- Tombol pensil mengambang untuk menulis postingan (foto atau video dari perangkat).
- **Iklan**: kartu "Bersponsor" asli (native) setiap 3 postingan, ada opsi sembunyikan. Tidak ada di chat atau saat game.
- Moderasi: lapor postingan dan pengguna, sembunyikan, blokir. Unggahan video dibatasi durasi dan ukuran (sebaiknya 60 detik, 50 MB). Pemindaian konten otomatis (pornografi dan kekerasan) sebelum tampil publik.
- Hanya pengguna 18+ yang bisa mengunggah video di komunitas publik (sebaiknya, sampai ada kebijakan moderasi).

## 11. Live

- **Tonton**: masuk sebagai penonton, bisa chat dengan penonton lain, tidak ikut main. Kartu tangan pemain disembunyikan; permainan ditayangkan dengan jeda 30 sampai 60 detik di game kartu.
- **Gabung**: duduk di kursi kosong.
- Yang ditayangkan adalah **status game**, bukan video.
- Iklan di sela pertandingan, bukan di tengah giliran.
- Tidak ada tebakan berhadiah.

## 12. Toko dan ekonomi

- **Paket Koin**: Rp5.000 = 50, Rp10.000 = 110, Rp25.000 = 300, Rp50.000 = 650, Rp100.000 = 1.400 (lewat Google Play Billing dan Apple IAP; di prototipe hanya simulasi).
- **Toko kosmetik** dengan tab: Avatar, Emoji, Skin dadu. Skin: Klasik gratis, Kayu Jati 80, Batik Biru 120, Neon 150 Koin. Emoji: paket Dasar gratis, Meja Gaple 60, Drama Ludo 80, dan seterusnya.
- Koin tidak bisa dikirim, ditarik, atau dipakai membeli Tiket.
- Pembelian dipulihkan lewat akun (restore purchase).
- Pendapatan: Koin, iklan di feed dan Live, game premium (fase 3). Angka ada di `claude/simulasi-ekonomi-game-v3.md`.

## 13. Notifikasi

Netral ("Giliranmu dengan Rina", tidak menyebut game). Jenis: undangan main, giliran asinkron, permintaan dan pemberian Tiket, pesan chat, balasan di utas, streak (jam tenang 22:00-07:00). Setiap jenis bisa dimatikan. Status Jangan ganggu menahan semua kecuali panggilan dari favorit (opsional).

## 14. Anti-curang dan keselamatan

- Server wasit: semua langkah game divalidasi, klien hanya mengirim niat.
- Deteksi: win-trading, akun ganda (per nomor HP dan perangkat), pola Tiket tidak wajar, bot.
- Laporan: tombol lapor di room, chat, profil, dan postingan. Jejak laporan disimpan. Admin dapat membekukan akun.
- Suara: default hanya dengan teman; match acak lewat TURN; mute dan blokir selalu tersedia.
- Data pribadi: nomor HP dan email tidak tampil ke pengguna lain, dienkripsi saat disimpan (nomor di-hash untuk pencocokan).
- Kepatuhan: klasifikasi gim (Permenkominfo 2/2024), pendaftaran PSE, kebijakan privasi, dan persetujuan sesuai UU PDP.

## 15. Kebutuhan non-fungsional

| Aspek | Target (sebaiknya) |
|---|---|
| Platform | Android 8+ dan iOS 15+, satu basis kode |
| Latensi gerakan game | di bawah 300 ms median di jaringan seluler Indonesia |
| Suara | WebRTC P2P maks 4, turun ke TURN otomatis |
| Offline | Chat dan giliran asinkron antre dan terkirim saat daring |
| Ketersediaan | 99,5% sebulan pada fase awal |
| Keamanan | TLS di mana-mana, JWT berumur pendek, rate limit semua endpoint publik |
| Bahasa | Bahasa Indonesia dulu, string terpisah agar bisa ditambah |
| Aksesibilitas | Target sentuh minimal 44 px, kontras cukup, label untuk pembaca layar |
| Uji | Mesin aturan game dengan uji unit dan simulasi 10.000 game acak tanpa pelanggaran aturan |

## 16. Di luar cakupan v1

Lawan komputer, tebakan berhadiah, hadiah uang tunai, pembelian Tiket, taruhan Koin atau uang, siaran video penuh, game pihak ketiga, jual-beli antarpengguna, DM dari orang asing, kamera dan AR.

## 17. Pertanyaan terbuka

1. Layanan OTP: SMS biasa atau WhatsApp? Biaya per verifikasi masuk hitungan ekonomi.
2. Apakah suara pemain lain boleh ikut direkam jika mereka setuju, atau hanya papan game?
3. Batas usia: 13+ atau 17+? Menentukan fitur komunitas dan video.
4. Aturan pertemanan lain: apakah pertemanan perlu notifikasi saat terbentuk atau putus?
5. Kalau pemberi menghapus pertemanan setelah memberi Tiket, apakah Tiket ditarik? (Usul: tidak.)
6. Opini hukum tertulis soal Taruhan 1 Tiket dan turnamen berhadiah. Taruhan 1 Tiket sudah diputuskan tetap masuk dengan tiga pengaman WAJIB (bagian 9.4); opini hukum diperlukan sebelum rilis publik.
7. Varian aturan Remi yang dimainkan mahasiswa Bandung: jumlah kartu per pemain, cara menurunkan dan menyusun, penghitungan poin, joker. Dikunci dari wawancara klaster beta sebelum mesin Remi dibangun.
