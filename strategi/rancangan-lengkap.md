# Gmers (dulu Social Gamr): Rancangan Lengkap

Dokumen ini merangkum hasil diskusi desain: konsep, sistem trofi dan turnamen yang aman hukum, ekonomi, arsitektur voice, struktur tab, roadmap, penilaian, perbandingan dengan Snapchat, game premium, dan mekanik streak. Diperbarui 12 November 2026 (lihat **bagian 14: Pembaruan** untuk keputusan terbaru).

**Catatan penting:** semua angka adalah asumsi awal untuk diuji, bukan fakta pasar. Bagian hukum bukan nasihat hukum; konsultasikan desain final dengan pengacara yang paham regulasi gaming Indonesia sebelum membangun fitur hadiah uang. Spreadsheet simulasi ada sebagai file terpisah: **simulasi-ekonomi-game-v3.xlsx**.

**Status dokumen:** bagian 1-13 adalah rancangan dasar tanggal 9 November 2026. Bila ada yang bertentangan dengan bagian 14, **bagian 14 yang berlaku**. Spesifikasi teknis terkini ada di `spec/01-spesifikasi.md`.

---

## 14. Pembaruan 11-12 November 2026 (berlaku)

### 14.1 Nama dan game awal
- Nama produk sekarang **Gmers** (sebelumnya Social Gamr).
- Tab: Chat, Komunitas, Games, Live.
- Game awal ada **tiga: Ludo (pintu masuk yang paling mudah), Remi, dan Gaple**. Gaple dan Remi dipilih karena dimainkan mahasiswa ITB Bandung. Tanpa lawan komputer.
- Remi memakai mesin berparameter. **Varian belum dikunci**: ada dua varian di internet (Remi Indonesia dan Rummy umum). Kunci lewat wawancara mahasiswa ITB sebelum mesin dibangun. Draf aturan: `spec/04-aturan-remi-draf.md`.
- Teman = saling mengikuti ATAU saling menyimpan kontak; hanya teman yang bisa chat.

### 14.2 Posisi dan klaim utama
- **Keunggulan utama (USP) adalah chat**: bermain dan mengobrol dalam satu tempat, seperti duduk satu meja. Pembanding: WhatsApp + tautan (A), Gmers (B), Ludo King (C).
- Asumsi paling berisiko: **jangkauan dan efek jaringan** (apakah satu lingkaran teman benar-benar pindah dan kembali). Klaim "aplikasi lain sulit dipakai" baru pengalaman satu orang dan harus diuji.
- Tantangan utama: antarmuka dan gamifikasi. "Adiktif" diartikan sebagai pengalaman bermain bersama teman, bukan jebakan retensi.
- Distribusi: GTM berbasis komunitas lewat admin grup WhatsApp ditambah video pendek. Metrik tunggal peluncuran: **kelompok aktif** (minimal 3 orang, masing-masing minimal 2 sesi bersama dalam 14 hari). Ambang yang diusulkan: 20 kelompok dalam 6 minggu.

### 14.3 Klaster beta pertama
- **Mahasiswa ITB Bandung**, dengan target turnamen antarmahasiswa di Bandung.
- Dokumen kerja: "Gmers: Positioning dan Rencana Peluncuran Klaster Pertama" (Claude Docs) dan "Protokol Uji UX Gmers vs WhatsApp + Tautan".

### 14.4 Keputusan risiko: Taruhan 1 Tiket
- Taruhan 1 Tiket antarteman **dipertahankan** sebagai risiko yang diambil dengan sadar (tidak melibatkan uang, tiket tidak bisa dibeli, dijual, atau diuangkan).
- Tiga pengaman **WAJIB**: (1) remote kill switch, (2) hanya 18+, (3) konsultasi hukum tertulis sebelum rilis publik.
- Ini mengubah satu butir di bagian 3 ("hindari taruhan antarteman"): untuk taruhan berbasis Tiket gratis, keputusan di 14.4 yang berlaku. Taruhan dengan Koin atau uang tetap dilarang.

### 14.5 Mesin game dan pengujian
- Mesin game bersifat **game-agnostic**; Ludo, Remi, Gaple adalah aturan di atasnya.
- Prototipe v14 punya mode uji `?uji=1` untuk mencatat jumlah ketukan, waktu, dan metode (A/B/C), dengan ekspor CSV. Ketukan terukur: pengundang 4, penerima 3 (turun satu bila sudah di chat yang sama). Pembanding WhatsApp masih perkiraan.
- Ambang lulus diset dan dikunci **sebelum** uji dimulai.

### 14.6 Langkah berikut
1. 10 wawancara mahasiswa ITB (kunci varian Remi, uji klaim UX).
2. Uji UX tiga metode (protokol di Claude Docs).
3. Unggah situs baru ke Cloudflare Pages (manual, zip).
4. Konsultasi hukum tertulis (Taruhan Tiket, turnamen berhadiah) dan kebijakan privasi sebelum daftar tunggu.
5. Jadwal MVP multi-perangkat (belum ditentukan).

---

## 1. Konsep

- Aplikasi chat seperti Telegram dengan tab game. Game awal: **Ludo (yang paling mudah), Remi, dan Gaple** (lihat 14.1).
- Main 1 lawan 1 atau grup, **tanpa lawan komputer**. Undang teman dari chat, lalu langsung main.
- Selama bermain bisa ngobrol lewat voice atau chat, seperti bermain langsung.
- Motivasi awal: main kartu paling seru karena berinteraksi langsung dengan teman.
- Gamifikasi: trofi, liga, turnamen. Monetisasi: Koin (kosmetik), emoji, iklan, dan nantinya game premium.
- Hipotesis pertumbuhan: game sosial bisa dapat traksi tanpa biaya iklan besar.

## 2. Penilaian awal

**Kuat:** positioning "main bareng, bukan produk game"; tanpa lawan komputer memaksa interaksi manusia dan menghemat biaya; game klasik yang aturannya sudah dikenal.

**Risiko utama:**
1. Trofi yang dibeli + hadiah uang = risiko perjudian (lihat bagian 3).
2. Mekanik trofi awal menghukum pemain (kalah = kehilangan trofi, habis = bayar).
3. Klaim "tanpa biaya iklan besar" terlalu optimistis: loop viral game privat lebih lemah dari feed publik, dan tiap pemain baru harus memasang aplikasi.
4. Cold start: aplikasi butuh minimal 2 orang.
5. Persaingan dengan WhatsApp dan Telegram: strategi realistis adalah undangan lewat link WhatsApp, bukan meminta orang pindah.

## 3. Trofi dan turnamen yang aman hukum

### Garis hukum
- Perjudian = pertaruhan + untung-untungan/kemahiran. Menurut hukumonline, game online tidak termasuk judi selama tidak memuat taruhan uang/harta atau keuntungan uang yang didasarkan pada peruntungan. Lomba catur berhadiah uang tidak dapat dikatakan judi.
- Pasal 27 ayat (2) UU ITE (UU 1/2024): ancaman penjara sampai 10 tahun dan/atau denda sampai Rp10 miliar. KUHP baru juga disebut menggantikan Pasal 303/303 bis dengan Pasal 426 dan 427.
- Preseden Higgs Domino: jual-beli chip permainan yang memuat unsur pertaruhan dan untung-untungan dipermasalahkan.
- Permenkominfo 2/2024: penerbit wajib melakukan klasifikasi gim secara mandiri dan mencantumkannya; ada sanksi administratif.

**Tiga unsur yang tidak boleh bertemu:** (1) pemain membayar uang, (2) hasil dipengaruhi peruntungan (dadu, kartu), (3) pemain bisa memenangkan uang atau sesuatu yang bisa diuangkan.

### Tiga mata uang terpisah (ditambah Bintang, di bawah)

| | Trofi | Koin | Tiket Turnamen |
|---|---|---|---|
| Cara dapat | Hanya dari bermain | Dibeli (Rp) atau hadiah | Hanya dari prestasi |
| Bisa dibeli? | Tidak | Ya | Tidak |
| Dipakai untuk | Rank, liga, status | Kosmetik (avatar, emoji) | Masuk turnamen |
| Bisa dikirim/dijual/diuangkan? | Tidak | Tidak | Tidak |

Aturan emas: uang hanya masuk lewat Koin, dan Koin hanya keluar menjadi kosmetik. Tidak ada jalur dari Rupiah ke hadiah uang.

### Aturan trofi (hanya mode Ranked; mode santai tidak mengubah trofi)

| Format | Hasil | Perubahan |
|---|---|---|
| 1 vs 1 | Menang / Kalah | +10 / -5 |
| 4 pemain | Peringkat 1 / 2 / 3 / 4 | +10 / +4 / -2 / -5 |

Pelindung: lantai liga (tidak turun di bawah batas liga yang dicapai), perisai kekalahan (setelah 3 kalah beruntun, kekalahan berikutnya bernilai 0), bonus game pertama harian +2, disconnect dihitung kalah tanpa hukuman tambahan.

### Liga (perkiraan dengan 20 game ranked/minggu, win rate 50%, termasuk bonus harian)

| Liga | Trofi minimum | Perkiraan waktu |
|---|---|---|
| Perunggu | 0 | Awal |
| Perak | 100 | ~1,7 minggu |
| Emas | 300 | ~5 minggu |
| Platinum | 600 | ~10 minggu |
| Legenda | 1000 | ~17 minggu |

Musim 1 bulan dengan reset lunak (turun satu liga); lencana musim permanen. Titik impas trofi ada di win rate sekitar 33%: pemain dengan win rate 40% tetap naik.

### Bintang (mata uang gratis untuk bermain bersama)
Selesai 1 game +1 (maks 10/hari); main dengan teman yang belum dimainkan minggu ini +3; teman undangan menyelesaikan 3 game +10 (untuk keduanya); misi harian +5; nonton iklan rewarded +5 (maks 5/hari). Bintang untuk kosmetik dasar dan pembeku streak.

### Koin dan item (awal)
Paket: Rp5.000 = 50 Koin, Rp10.000 = 110, Rp25.000 = 300, Rp50.000 = 650, Rp100.000 = 1.400. Item: emote 20-30 Koin, skin dadu/punggung kartu 50-80, bingkai avatar 80, kostum avatar 100-150, avatar animasi/langka 300, pass musim 150.

### Turnamen
1. **Masuk gratis**, tanpa jalur bayar. Syarat: liga minimal Emas dan 30+ game ranked per bulan.
2. Hadiah dibiayai **sponsor/anggaran promosi**, nilainya tetap dan diumumkan sejak awal; tidak bergantung pada jumlah peserta atau uang pemain. Jangan mengiklankan hubungan penjualan Koin dengan hadiah.
3. Game **dominan keterampilan** untuk hadiah uang (Ludo bergantung dadu, jadi risikonya paling tinggi; Remi dan Gaple juga mengandung kartu acak, jadi tetap perlu opini hukum).
4. **Hadiah non-uang dulu** (voucher, pulsa, merchandise, item eksklusif). Hadiah uang tunai setelah ada opini hukum tertulis.
5. Hadiah uang hanya untuk 18+ dengan verifikasi identitas dan kesiapan pajak hadiah.
6. Jika kualifikator melebihi slot, seleksi lewat peringkat atau babak kualifikasi, **bukan undian**.
7. Syarat dan ketentuan tertulis, anti-curang, dan aturan sengketa.
8. **Game premium tidak boleh menjadi syarat masuk turnamen berhadiah uang** (lihat bagian 11).

Contoh hadiah bulanan (64 peserta): juara 1 Rp600.000; 2 Rp300.000; 3-4 Rp150.000 masing-masing; 5-8 Rp50.000 masing-masing; total Rp1.400.000. Ditambah turnamen mingguan terbuka berhadiah non-uang (sekitar Rp400.000/bulan).

### Aman vs hindari

**Aman (relatif):** jual Koin untuk kosmetik; rewarded ads; turnamen gratis berhadiah sponsor; liga dan lencana berbasis trofi.

**Hindari:** menjual trofi atau apa pun yang menjadi syarat turnamen; biaya masuk turnamen; hadiah yang bisa diuangkan lewat jual-beli antarpemain; taruhan antarteman dengan Koin atau uang (taruhan 1 Tiket gratis: lihat 14.4); tebakan berhadiah di Live; marketing "bayar untuk menang uang".

### Pertanyaan untuk konsultan hukum
1. Apakah turnamen gratis berhadiah uang dari sponsor aman, dan game mana yang dianggap dominan keterampilan?
2. Apakah ada izin penyelenggaraan turnamen berhadiah, dan bagaimana pajaknya?
3. Apakah perlu badan hukum PT dan pendaftaran PSE sebelum peluncuran?
4. Apakah Koin kosmetik yang tidak bisa dipindahtangankan aman sepenuhnya?
5. Bagaimana pengaturan pemain di bawah 18 tahun, termasuk kewajiban perlindungan anak di platform digital?
6. Apakah menjual game premium (yang mungkin berunsur dadu) aman bila dipisah dari turnamen berhadiah uang?
7. Apa kewajiban sebagai penyelenggara platform bila memuat game dari pihak ketiga (perancang/penerbit)?
8. Apakah Taruhan 1 Tiket antarteman (Tiket tidak bisa dibeli atau diuangkan) berisiko dianggap pertaruhan? (butir baru, lihat 14.4)

## 4. Ekonomi (asumsi awal, 1.000 pemain aktif per bulan)

Parameter utama: 40% pemain bermain Ranked; 4% pembeli avatar (belanja Rp30.000/bulan); 2% pembeli emoji (Rp10.000/bulan); potongan toko + PPN 27,5%; rewarded ads 2 tampilan/hari, 15 hari aktif, eCPM Rp25.000; 25% pemain memakai voice; 30% sesi voice lewat TURN; 15% menonton Live (60 menit/bulan); biaya tetap Rp5 juta/bulan (belum termasuk gaji).

### Fase 1-2 (tanpa game premium)

| Item | Nilai/bulan |
|---|---|
| Pendapatan bersih | Rp1.819.000 |
| Total biaya | Rp7.137.440 |
| Laba/rugi | -Rp5.318.440 |
| Pendapatan per pemain (ARPU) | Rp1.819 |
| Biaya variabel per pemain | ~Rp337 |
| Bandwidth TURN (voice P2P) | ~Rp19.440 |
| Pemain aktif untuk impas | ~4.590 |

### Fase 3 (dengan blok game premium)

Asumsi premium: 1% pemain membeli game premium (Rp50.000), 1,5% membeli pass satu malam (Rp7.000), 0,5% berlangganan klub (Rp25.000/bulan), bagi hasil perancang/penerbit 40% dari penjualan premium setelah potongan toko, dan amortisasi pengembangan/lisensi Rp3 juta/bulan (placeholder).

| Item | Nilai/bulan |
|---|---|
| Penjualan premium kotor | Rp730.000 |
| Pendapatan premium bersih (setelah potongan toko dan bagi hasil) | ~Rp317.550 |
| Pendapatan bersih total | Rp2.136.550 |
| Total biaya | Rp10.137.440 |
| Laba/rugi pada 1.000 pemain | -Rp8.000.890 |
| Pendapatan per pemain (ARPU) | Rp2.137 |
| Kontribusi per pemain | ~Rp1.799 |
| Pemain aktif untuk impas | ~5.450 |

Skenario skala (rata-rata per pemain tetap, hadiah tetap): 5.000 pemain aktif -Rp804.450; 10.000 pemain +Rp8.191.100; 50.000 pemain +Rp80.155.500 per bulan.

**Catatan:** hadiah (Rp1,8 juta) memakan sebagian besar pendapatan organik di skala awal, jadi hadiah uang baru masuk akal dengan sponsor. Pendapatan Live hanya ~Rp54.000/bulan di asumsi bawaan dan belum terbukti. Pembeli avatar, emoji, dan premium dihitung terpisah, sehingga ada kemungkinan tumpang tindih (angka sedikit optimistis). Blok premium menaikkan pendapatan per pemain tetapi juga titik impas (dari ~4.590 ke ~5.450) karena biaya amortisasi katalog; itu harga dari memperluas ke segmen hobi. Semua angka premium belum terbukti.

## 5. Voice P2P dan mode ruang

**Arsitektur:** voice lewat WebRTC peer-to-peer; server hanya untuk signaling, chat teks, status game, dan TURN relay cadangan. Status game dan trofi tetap divalidasi server (anti-curang).

- Voice dibatasi **4 pemain** di versi awal (mesh makin berat di atas 6).
- **Indikator jaringan tiga status:** hijau (voice normal), kuning (bitrate diturunkan), merah (voice nonaktif, otomatis ke chat). Pantau terus-menerus (packet loss, delay), indikator per pemain; satu pemain merah tidak mematikan voice yang lain.
- TURN diperkirakan menangani 20-40% sesi (NAT operator seluler); ukur dari data nyata. Untuk match acak (Ranked), paksa lewat TURN agar IP pemain tidak bocor.
- Moderasi voice lebih sulit; sediakan tombol lapor, mute/blokir, dan voice default hanya untuk teman.
- **Tiga mode per room:** Suara, Chat, **Senyap** (tanpa suara game, tanpa getar, hanya reaksi cepat dan stiker). Notifikasi netral ("Pesan baru"), timer giliran lebih panjang di mode santai, status Siap main / Sibuk / Senyap terlihat teman.
- Di Ranked: konfirmasi "siap" di awal; kekalahan karena waktu habis tidak mengurangi trofi untuk beberapa kali pertama per hari.

## 6. Emoji

- Emoji standar gratis; emoji premium dibeli dengan Koin (sekitar Rp2.000-3.000 per emoji, paket tema 6-8 emoji).
- Emoji terhubung ke kejadian game (menutup jalan, memakan bidak, nyaris menang). Penerima emoji premium bisa mencoba gratis 24 jam atau langsung membeli.
- **Sundul vs mode Senyap:** pemain di mode Senyap hanya melihat sundul secara visual, tanpa suara/getar. Batasi satu sundul per 30 detik per target; ada tombol sembunyikan emoji dari pemain tertentu.
- Sundul dasar gratis; premium hanya mengubah tampilan (bukan pay-to-pressure). Emoji ejekan dibatasi ke teman atau dapat dimatikan di Ranked.
- Hindari konten SARA dan pelecehan, terutama karena ada pengguna muda.
- Uji: persentase pembeli emoji pertama dalam 7 hari (dengan dan tanpa percobaan 24 jam), emoji per sesi.

## 7. Struktur tab dan fase

| Tab | Fungsi | Fase |
|---|---|---|
| Chat | Inti hubungan sosial | 1 |
| Games | Tempat bermain, room, mode suara/chat/senyap; katalog game premium menyusul | 1 (katalog premium di Fase 3) |
| Komunitas | Cari lawan, cari teman baru | Versi ringan di Fase 1 ("Cari Lawan" di Games), penuh di Fase 3 |
| Live | Nonton pertandingan, ruang iklan | 2 |

**Komunitas:** forum penuh berat (moderasi, keamanan anak). Fase 1 cukup papan "Cari Lawan" di Games. Kirim pesan pribadi hanya setelah kedua pihak saling menerima; pengguna di bawah 18 tahun tidak menerima kontak dari orang asing di luar room.

**Live:** kirim status game (bukan video) ke penonton, jadi biaya sangat kecil. Game kartu: beri jeda tayang 30-60 detik atau sembunyikan kartu agar tidak ada kolusi. Iklan di sela pertandingan, **blokir kategori iklan judi/taruhan** di jaringan iklan.

**Tahta:** satu "Raja/Ratu" per game per musim, Tantang Raja, pertandingan unggulan otomatis di Live, ikuti pemain, sorakan berbayar. Karena trofi tidak bisa dibeli, tahta bermakna. Hindari tebakan berhadiah; hadiah pemain tahta tinggi non-uang dulu (pencairan uang butuh pajak, pembayaran, dan verifikasi). Anti-curang di papan atas harus lebih ketat (win-trading, akun ganda). Beri pemain top kontrol chat penonton. Cold start Live: undang 10-20 pemain jago dan kreator game dulu.

## 8. Roadmap tiga fase

### Fase 1: Buktikan orang mau main bareng (±2-3 bulan, 50-100 pemain)
**Dibangun:** Chat; Games dengan **Ludo, Remi, dan Gaple** (Remi menunggu varian dikunci; lihat 14.1); room dengan link undangan; voice P2P maks 4 dengan indikator; mode Suara/Chat/Senyap; trofi dan liga (Ranked + santai); papan "Cari Lawan" ringan; emoji dasar gratis dan beberapa berbayar; Koin untuk avatar; Ajak Main, giliran asinkron, dan Streak Main (bagian 12). Klaster beta: mahasiswa ITB Bandung.

**Diuji:** persentase pemain yang kembali minggu berikutnya dengan teman yang sama; rata-rata teman yang diajak; proporsi sesi Suara/Chat/Senyap; persentase sesi voice yang jatuh ke TURN dan kualitas suaranya; apakah rasio +10/-5 terasa adil; pembeli emoji pertama dalam 7 hari; **jumlah kelompok aktif** (metrik tunggal, 14.2); uji UX tiga metode (14.5).

**Lanjut jika:** pemain yang kembali setelah seminggu cukup tinggi dan ada tanda orang mengajak teman baru. Tentukan ambang sebelum mulai.

### Fase 2: Tambah daya tarik dan skala (±3-4 bulan, ribuan pemain)
**Dibangun:** Live; Tahta dan Tantang Raja; pertandingan unggulan; sorakan berbayar; turnamen berhadiah non-uang (termasuk turnamen mahasiswa Bandung); anti-curang lebih ketat; game tambahan; iklan rewarded dan Live.

**Diuji:** persentase penonton Live dan menit tonton; iklan per menit tonton dan eCPM nyata; apakah tahta menambah aktivitas pemain top; tingkat kecurangan; apakah syarat tiket menghasilkan cukup kualifikator; konversi Koin dan emoji di skala lebih besar; **minat game premium** (daftar tunggu atau pra-pesan satu game, wawancara 5-10 pengelola kafe board game dan komunitas, survei game yang diinginkan); distribusi ke game kedua.

**Lanjut jika:** pendapatan per pemain mendekati asumsi dan titik impas terjangkau.

### Fase 3: Komunitas, game premium, dan hadiah uang (setelah ada tim dan opini hukum)
**Dibangun:** Komunitas penuh; **katalog game premium** (mulai 1-2 game); turnamen berhadiah uang dari sponsor; tim moderasi; verifikasi identitas untuk hadiah uang; kemitraan kreator dan perancang.

**Syarat:** opini hukum tertulis; sistem moderasi siap; sponsor yang membiayai hadiah; perlindungan pengguna di bawah 18 tahun; kesepakatan lisensi atau bagi hasil untuk game premium.

**Diuji:** tingkat toksik dan laporan; biaya moderasi per pengguna; apakah komunitas menambah retensi dibanding biayanya; konversi game premium, pass, dan langganan.

**Catatan:** Fase 1 paling menentukan. Seluruh model bergantung pada satu asumsi: orang mau main berulang dengan teman yang sama.

## 9. Penilaian: bisa jadi sosmed baru?

Sebagai media sosial umum (Facebook, Instagram, TikTok): kemungkinan kecil. Mereka menemukan bentuk konten baru yang otomatis disiarkan ke banyak orang; "momen bermain bersama" terjadi antar orang di dalam room, bukan siaran.

| Kriteria | Penilaian |
|---|---|
| Hubungan sinkron (hadir bersama) | Kuat |
| Identitas dan status | Kuat |
| Kebiasaan harian | Lemah-sedang (butuh dua orang online bersamaan) |
| Pasokan konten | Lemah (gameplay, bukan konten buatan pengguna) |
| Efek jaringan | Sedang (lingkar kecil) |
| Viral keluar | Sedang (harus memasang aplikasi) |
| Moderasi dan keamanan | Berat |

Preseden (sepengetahuan saya): game di dalam aplikasi chat yang sudah ramai berhasil; membangun jaringan sendiri dari nol lebih sulit; Houseparty melonjak saat orang terkurung lalu memudar ketika bisa bertemu langsung. Hasil realistis terbaik: **platform sosial gaming niche berskala jutaan pengguna**.

**Pendorong ke arah sosmed:** momen game yang mudah dibagikan ke WhatsApp/Story; mode asinkron; geng/klan dengan liga mingguan; profil sebagai mata uang status; konteks lokal (arisan, nongkrong).

**Tanda awal:** rata-rata pemain mengajak lebih dari tiga teman; persentase pemain aktif harian terhadap bulanan jauh di atas pola game casual; pemain membagikan momen keluar aplikasi tanpa diminta.

**Analogi Snapchat** (lebih pas): kekuatannya adalah ritual harian dengan teman dekat. Pinjam: lingkar teman dekat, pesan ringan satu ketuk ("giliran main" sebagai alat komunikasi), streak harian, avatar, tekanan rendah, status aktif. Posisi yang tajam: **"Snapchat-nya main bareng"**, bukan "aplikasi chat dengan tab game". Perbandingan rinci ada di bagian 10.

## 10. Perbandingan dengan Snapchat: apa yang bisa kita buat lebih baik

**Gambaran Snapchat** (sepengetahuan saya dan hasil pencarian; tidak memuat data pengguna terkini): kamera-pertama, pesan yang menghilang, Snapstreak, avatar Bitmoji, Snap Map, Spotlight dan Lenses, **Snap Games dan Snap Minis** (game dan aplikasi mini di dalam aplikasi), langganan berbayar Snapchat+, dan pendapatan terutama dari iklan.

| Dimensi | Snapchat | Gmers | Peluang lebih baik |
|---|---|---|---|
| Alat komunikasi utama | Foto/video singkat (snap) | "Giliran main" dan Ajak Main | Tidak perlu kamera, tampil, atau kreativitas. Cocok untuk yang pemalu atau di tempat yang tidak boleh berisik (mode Senyap). |
| Streak | Snapstreak harian; sering dikritik menimbulkan tekanan, dan pemulihannya sepengetahuan saya bisa berbayar | Streak Main yang pemaaf, berbasis permainan nyata | Streak berarti aktivitas bersama yang menyenangkan, bukan sekadar kirim snap kosong. Pemulihan gratis; pembekuan hanya dengan Bintang. |
| Identitas | Bitmoji (tampilan) | Avatar + Tahta, liga, lencana yang tidak bisa dibeli | Status dari kemampuan dan kebersamaan, bukan hanya penampilan. |
| Konten publik | Spotlight dan Stories | Live pertandingan dan sorotan otomatis | Ada alasan menonton (kompetisi) dan pemain tidak perlu membuat konten: permainan itu sendiri yang menghasilkannya. |
| Game | Tambahan di aplikasi sosial yang sudah ada | Game adalah inti produk | Seluruh pengalaman (chat, status, notifikasi) dirancang untuk bermain bareng, bukan fitur sampingan. |
| Monetisasi | Iklan dan langganan Snapchat+ | Kosmetik, emoji, game premium, iklan rewarded | Pendapatan datang dari hal yang disukai pemain (ekspresi, game). Pemain bisa memperoleh nilai tanpa melihat iklan. |
| Keamanan pengguna muda | Skala besar dengan banyak remaja; pesan menghilang menyulitkan moderasi | Mulai dari dewasa muda; kontak orang asing dibatasi; jejak laporan disimpan | Keamanan sebagai fitur sejak awal, bukan tambalan setelah skala. |
| Lokal | Global | Bahasa, humor, game tradisional (Congklak, gaple), kebiasaan nongkrong, metode bayar lokal | Rasa lokal yang sulit ditiru platform global. Periksa kebijakan toko aplikasi soal metode pembayaran alternatif. |
| Kebersamaan | Umumnya 1-1 atau siaran | Multiplayer sinkron dan asinkron | Kehadiran bersama secara real-time dan "main nanti" dalam satu produk. |

**Di mana Snapchat lebih kuat (jangan bersaing di sana):** kamera dan AR Lens, jangkauan jaringan dan basis pengguna yang sangat besar, konten kurasi, dan anggaran. Fokus pada satu hal: main bareng dengan teman dekat.

**Peringatan:** "lebih baik" di atas masih hipotesis. Syaratnya semua hal di bagian 12 (Ajak Main, asinkron, Streak Main) terbukti dipakai dan tidak terasa menekan. Ukur di Fase 1 sebelum mengklaimnya.

## 11. Game premium (modern board game)

**Istilah:** *modern board game*, *hobby game*, atau *tabletop game*: game papan strategi yang lebih dalam dari Ludo atau Monopoli, biasanya untuk 2-5 orang dan berlangsung satu sampai tiga jam (contoh: Catan, Ticket to Ride, Carcassonne). Dungeons & Dragons adalah *tabletop RPG* (butuh pemandu cerita), jenis berbeda yang jauh lebih sulit didigitalkan.

**Rencana:** dijual setelah komunitas terbentuk (Fase 3), validasi minat dulu di Fase 2.

**Kenapa cocok:**
- Game panjang dimainkan sambil ngobrol, persis suasana "main kartu dengan teman" dan cocok dengan voice dan chat.
- Cocok dengan giliran asinkron dan streak (dicicil satu giliran per hari).
- Penggemarnya cenderung dewasa muda dengan daya beli lebih tinggi, melengkapi iklan dan emoji dari pemain casual.
- Komunitas sudah ada, termasuk kafe board game, sebagai benih komunitas awal di satu kota.

**Hambatan terbesar: hak cipta dan lisensi.** Aturan main umumnya tidak dilindungi, tetapi nama, ilustrasi, dan teks aturan dilindungi. Pilihan:
1. Lisensi dari penerbit (kuat, tapi lama dan mahal; game populer sudah punya adaptasi digital resmi).
2. Bermitra dengan perancang indie dan perancang Indonesia dengan bagi hasil (paling masuk akal; platform sebagai rumah perancang lokal).
3. Game domain publik dan tradisional: catur, Go, backgammon, Congklak, gaple, ular tangga.
4. Game rancangan sendiri.

Mulai dari opsi 2 dan 3 sambil menjajaki opsi 1.

**Model monetisasi:**
- **Pemilik room membeli, tamu main gratis:** satu orang yang menyelenggarakan malam bermain membeli game; teman-temannya ikut tanpa bayar. Mendorong pembelian sekaligus menyebar ke pemain baru.
- **Pass satu malam** murah untuk mencoba.
- **Langganan klub** untuk seluruh katalog.
- **Bagi hasil** dengan perancang untuk game pihak ketiga (dinegosiasikan, tidak ada patokan tunggal).

**Garis hukum:** game premium **jangan jadi syarat masuk turnamen berhadiah uang**. Jika pemain harus membeli game dulu untuk ikut turnamen berhadiah uang, itu menyambungkan kembali "bayar uang → kesempatan menang uang". Pilihan: turnamen uang hanya di game dasar gratis, atau turnamen game premium dengan akses tamu gratis dan hadiah non-uang. Konfirmasikan dengan pengacara.

**Kenyataan yang perlu diingat:**
- Mendigitalkan satu game mahal: mesin aturan, antarmuka, pengujian, dan klasifikasi usia per game (Permenkominfo 2/2024). Mulai dengan 1-2 game sederhana untuk 2-4 pemain (sesuai batas voice).
- Pasar hobi lebih kecil dari pasar Ludo. Jangan dimasukkan ke Fase 1.
- Memuat game pihak ketiga membuat kamu penyelenggara platform dengan kewajiban tambahan.

**Yang diuji lebih awal (Fase 2):** daftar tunggu atau pra-pesan satu game premium, wawancara dengan pengelola kafe board game dan komunitas, survei singkat game yang diinginkan pemain aktif.

## 12. Mekanik Fase 1: Ajak Main, giliran asinkron, Streak Main

### Ajak Main (satu ketuk)
- Dari chat atau profil teman, ketuk ikon dadu; game default adalah yang terakhir dimainkan berdua.
- Undangan muncul sebagai kartu di chat: **Main sekarang** (live) atau **Main nanti** (asinkron). Penerima: **Gabung** (pilih Suara/Chat/Senyap), **Nanti**, atau **Lagi sibuk** (balasan halus otomatis).
- Kedaluwarsa: 15 menit (live), 24 jam (asinkron).
- Pengirim melihat status penerima; undangan ke yang berstatus Senyap tiba tanpa suara/getar.
- Undangan ke orang bukan teman dibatasi (misalnya 5 per jam).
- Opsional: link undangan WhatsApp untuk mencoba lewat browser sebelum memasang aplikasi.

### Giliran asinkron
- Untuk game berbasis giliran; notifikasi netral ("Giliranmu dengan Rina"), tanpa menyebut game.
- Timer default 24 jam (12 atau 48 pilihan). Giliran terlewat dilewati; setelah 2 kali berturut-turut game dijeda, bukan dikalahkan.
- Mode santai tidak ada kekalahan karena waktu habis. **Ranked hanya live** di Fase 1.
- Game asinkron bisa ditingkatkan jadi live kapan saja ("Dika sedang online, main live sekarang?").

### Streak Main
**Definisi:** jumlah hari berturut-turut ketika setiap anggota pasangan menyelesaikan minimal satu giliran atau satu game bersama. Hari dihitung 03:00-03:00 WIB.

**Aturan pemaaf:**
1. Pembeku streak: satu gratis per minggu (terpakai otomatis, bisa ditabung sampai 2). Tambahan hanya dengan **Bintang, bukan Koin**.
2. Pemulihan tanpa bayar dalam 24 jam dengan menyelesaikan dua game bersama.
3. Mode Senyap dan giliran asinkron tetap dihitung.
4. Streak grup (maks 4): naik jika minimal 2 anggota bermain bersama; yang absen tidak memutusnya.
5. Pengingat satu per hari, hanya jika streak 3 hari atau lebih, bernada netral, tidak dikirim 22:00-07:00, bisa dimatikan.
6. Hadiah milestone (3, 7, 30, 100 hari): Bintang, lencana pasangan, bingkai bersama (kosmetik).
7. **Streak tidak memengaruhi trofi, Ranked, atau tiket turnamen.**
8. Hanya antar teman yang saling menerima (bukan lawan dari "Cari Lawan").
9. Pengguna di bawah 18 tahun: pengingat lebih terbatas, tanpa penjualan item streak.

### Metrik Fase 1

| Metrik | Kenapa penting |
|---|---|
| % undangan diterima dan waktu respons median | Apakah "Ajak main" terasa ringan |
| % giliran asinkron yang diselesaikan | Apakah "main nanti" benar-benar dimainkan |
| % pasangan dengan streak 3 dan 7 hari | Bukti ritual harian |
| % streak yang putus lalu dipulihkan | Apakah aturan pemaaf cukup |
| Survei "apakah streak terasa menekan?" | Menjaga agar tidak jadi beban |
| Retensi hari ke-7 per pasangan | Apakah pasangan, bukan hanya individu, kembali |
| Kelompok aktif (≥3 orang, tiap orang ≥2 sesi bersama dalam 14 hari) | Metrik tunggal peluncuran (14.2) |

Tetapkan ambang keputusan sebelum uji dimulai.

## 13. Pertanyaan terbuka dan langkah berikut

- Mengunci varian Remi lewat wawancara mahasiswa ITB (bagian 14.1).
- Menentukan format yang dominan keterampilan untuk turnamen berhadiah uang (Gaple, Remi, dan Ludo semuanya mengandung unsur acak).
- Konsultasi hukum (daftar di bagian 3, termasuk butir 8).
- Memilih jalur lisensi/kemitraan untuk game premium (bagian 11).
- Validasi harga voice/TURN dan angka monetisasi lewat uji beta 50-100 pemain.
- Jadwal MVP multi-perangkat dan kebijakan privasi sebelum daftar tunggu.

## Sumber
- hukumonline: [perbedaan game online dengan judi online](https://www.hukumonline.com/klinik/a/perbedaan-igame-online-i-dengan-judi-ionline-i-lt4fc475308e6a0), [bunyi Pasal 27 ayat (2) UU ITE 2024](https://www.hukumonline.com/klinik/a/bunyi-pasal-27-ayat-2-uu-ite-2024-tentang-ijudi-online-i-lt65afa86471ccc/), [judi](https://www.hukumonline.com/klinik/a/judi-lt4fc475308e6a0/)
- [Permenkominfo 2/2024 (JDIH Komdigi)](https://jdih.komdigi.go.id/produk_hukum/unduh-abstrak/512)
- [Analisis kasus Higgs Domino (UPN Jatim)](https://repository.upnjatim.ac.id/52337/5/BAB%204.pdf)
- [Jurnal Aladalah soal KUHP baru](https://ejurnalqarnain.stisnq.ac.id/index.php/ALADALAH/article/download/1238/1346)
- [Bisnis.com: audit klasifikasi game](https://teknologi.bisnis.com/read/20240610/564/1772686/klasifikasi-usia-game-tak-cukup-dengan-tempel-logo-kemenkominfo-kami-audit)
- Snapchat: [Pocket-lint tentang Snap Games](https://www.pocket-lint.com/what-are-snap-games/), [Snap Inc. soal Snap Kit, Games, Minis, Bitmoji (2021)](https://www.businesswire.com/news/home/20210520005127/en/Snap-Inc.-Announces-New-Partnerships-and-Developer-Tools-Across-Snap-Kit-Games-Minis-Bitmoji-and-Snap-Map), [Fossbytes tentang Snapchat+](https://fossbytes.com/?p=319762)
- Remi: [Pagat](https://pagat.com/rummy/indonesian_remi.html), [GameRules](https://gamerules.com/rules/indonesian-remi/), [Liputan6](https://www.liputan6.com/citizen6/read/7926097/cara-main-remi)
