# Hand-over ke Claude Code: MVP Room Web Gmers (Gaple)

Tanggal: 23 Nov 2026. Pemilik: Faizal (Bahasa Indonesia untuk semua komunikasi; kode, nama variabel, dan commit boleh Inggris; teks yang dilihat pengguna Bahasa Indonesia).

## 1. Tujuan satu kalimat

Bangun **Room Web**: halaman web tanpa install dan tanpa akun (hanya nama panggilan) tempat 2 sampai 4 orang main **Gaple** bersama sambil chat teks, supaya kita bisa mengukur apakah kelompok mahasiswa ITB Bandung mau main lagi di hari yang berbeda.

Ini **eksperimen, bukan produk**. Tujuannya menguji asumsi paling berisiko: apakah kelompok bisa dijangkau dan mau kembali (efek jaringan). Jangan membangun fondasi untuk aplikasi penuh.

## 2. Batas lulus (dikunci sebelum uji, jangan diubah)

- Metrik utama: **kelompok aktif** = minimal 3 orang bermain bersama pada minimal 2 hari kalender berbeda (WIB) dalam 14 hari. Rematch di hari yang sama tidak menambah hitungan.
- Lulus: minimal 4 dari 10 kelompok aktif. 1 sampai 3 = perbaiki satu putaran. 0 = pivot.
- Pagar: minimal 6 dari 10 kelompok menyelesaikan sesi pertama tanpa bantuan kita.
- Aplikasi harus **mencatat peristiwa** yang cukup untuk menghitung ini (bagian 6).

## 3. Cakupan

**Dibangun:**
1. Buat room: tombol "Buat room" menghasilkan tautan pendek yang bisa dibagikan ke grup WhatsApp.
2. Masuk lewat tautan: isi nama panggilan (tanpa akun, tanpa OTP). Duduk di kursi kosong.
3. Gaple 2 sampai 4 pemain dengan aturan dari `docs/05-aturan-gaple-draf.md` (parameter, default usulan).
4. Chat teks dalam room.
5. **Sambung ulang saat refresh atau putus**: pemain kembali ke kursi dan state yang sama (pakai token perangkat di penyimpanan lokal).
6. Tombol **rematch** (game baru dengan pemain yang sama).
7. Pencatatan peristiwa ke berkas CSV (bagian 6).
8. Tampilan mobile-first (sebagian besar mahasiswa buka dari HP lewat WhatsApp), Bahasa Indonesia.

**TIDAK dibangun (jangan tambah walau mudah):** Trofi, Koin, Tiket, Bintang, Remi, Ludo, aplikasi native, login Google atau OTP, daftar teman, game asinkron, iklan, taruhan apa pun, lawan komputer (bot hanya untuk uji otomatis), suara (panggilan WhatsApp berjalan terpisah), pengingat otomatis (dikirim manual lewat WhatsApp).

## 4. Keputusan teknis (usulan; ubah hanya dengan alasan)

- Monorepo pnpm, TypeScript.
  - `packages/game-engine`: **TypeScript murni**, deterministik (RNG diinjeksi, seed tercatat), tanpa I/O. Ini satu-satunya bagian yang akan dipakai ulang di produk penuh.
  - `apps/server`: Node + WebSocket (`ws`), room di memori, **server sebagai wasit** (klien hanya mengirim niat langkah; server memvalidasi lewat game-engine).
  - `apps/web`: klien statis (Vite, tanpa kerangka berat bila tidak perlu).
- Antarmuka mesin: `init(config, seed) -> State`, `legalMoves(state, seat) -> Move[]`, `apply(state, move) -> State | Error`, `status(state) -> {over, ranking}`. State serializable JSON. `apply` murni.
- Aturan Gaple disimpan sebagai **parameter konfigurasi** (lihat tabel di draf aturan), bukan konstanta, karena varian belum dikunci.
- Server dapat dimulai ulang tanpa kehilangan game: state dibangun ulang dari log langkah (cukup berkas lokal atau SQLite; jangan pasang Postgres/Redis untuk MVP).
- Host belum diputuskan. Buat server **tidak bergantung pada platform** (satu proses Node yang bisa jalan di VPS kecil atau layanan Node). Cloudflare Durable Objects hanya dipertimbangkan bila Faizal meminta.
- Tidak ada akun: identitas = token acak per perangkat + nama panggilan. Nomor HP tidak pernah dikumpulkan.

## 5. Urutan kerja (satu tahap per sesi, commit per tahap)

**Tahap A, kerangka dan mesin.**
Buat repo, struktur monorepo, `CLAUDE.md` repo, skrip `pnpm verify` (lint, tipe, uji). Tulis `packages/game-engine` untuk Gaple dengan parameter aturan. Kriteria:
- [ ] Semua aturan di draf aturan punya uji unit (bagian 6 draf).
- [ ] Simulasi 10.000 game acak per jumlah pemain (2, 3, 4) selesai tanpa pelanggaran aturan dan tanpa kebuntuan.
- [ ] Peringkat akhir selalu urutan lengkap 1..n.
- [ ] Uji properti: konservasi 28 kartu, `apply` murni, replay log dari seed menghasilkan state akhir sama.

**Tahap B, server room.**
WebSocket: buat room, duduk, mulai, kirim langkah, siaran state (kartu tangan hanya ke pemiliknya), chat, heartbeat, sambung ulang dengan token, batas waktu giliran (default 60 detik, bila habis: lewat bila memang tidak ada langkah sah, selain itu mainkan kartu sah pertama). Kriteria:
- [ ] Langkah ilegal atau di luar giliran ditolak dan tidak mengubah state.
- [ ] Putus dan sambung ulang memulihkan state yang benar (diuji).
- [ ] Restart server di tengah game tidak kehilangan state (diuji).
- [ ] Uji integrasi dengan klien WebSocket palsu; beban sederhana 50 room bersamaan.

**Tahap C, klien web.**
Layar: beranda (buat room), masuk (nama panggilan), meja Gaple, chat, hasil dengan tombol rematch. Mobile-first. Kriteria:
- [ ] Uji Playwright: 4 "pemain" membuka satu room, bermain sampai selesai, satu pemain refresh di tengah dan kembali, rematch berjalan.
- [ ] Tampil benar di lebar 360 px; semua teks Bahasa Indonesia.
- [ ] Hanya langkah sah yang bisa diketuk (diturunkan dari `legalMoves`).

**Tahap D, pencatatan dan rilis uji.**
Peristiwa ke CSV, titik ekspor, skrip yang menghitung "kelompok aktif" dari CSV, halaman kebijakan privasi singkat, panduan deploy. Kriteria:
- [ ] Skrip menghitung kelompok aktif dengan benar pada data contoh, termasuk kasus rematch di hari yang sama (tidak dihitung) dan batas tengah malam WIB.
- [ ] Panduan deploy satu halaman yang bisa diikuti Faizal tanpa Claude.

## 6. Peristiwa yang dicatat (CSV)

Kolom: `ts_utc`, `ts_wib`, `room_id`, `device_id` (hash), `event`, `game_no`, `detail`.
Peristiwa: `room_created`, `player_joined`, `player_left`, `reconnected`, `game_started`, `game_finished` (peringkat, lewat/terkunci), `rematch_clicked`, `message_sent` (hanya hitungan, **jangan simpan isi chat**), `invite_link_opened`.
Aturan: jangan simpan nomor HP, isi chat, atau alamat IP. Berkas ekspor dilindungi token rahasia dari variabel lingkungan.

## 7. Aturan yang tidak boleh dilanggar

1. Server menetapkan hasil. Klien tidak pernah menjadi sumber kebenaran.
2. Tidak ada taruhan, uang, atau mata uang dalam bentuk apa pun di MVP.
3. Tidak ada lawan komputer di produksi.
4. Jangan menebak aturan Gaple yang belum ada di draf: biarkan sebagai parameter dan catat pertanyaan di `docs/CATATAN-TAHAP.md`. Bila menyangkut privasi atau keselamatan, **berhenti dan tanya**.
5. Satu tahap per sesi. Setelah tiap tahap: perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `mvp-A`, `mvp-B`, dan seterusnya.
6. Jangan menambah fitur di luar bagian 3 "TIDAK dibangun".

## 8. Hal yang Claude Code tidak bisa lakukan (tugas Faizal)

- Membuat repo GitHub (kosong, nama `gmers`) dan menyambungkannya ke sesi.
- Memasang hosting dan domain, mengisi variabel lingkungan, menayangkan situs.
- Mengunci aturan Gaple setelah wawancara ITB, dan mengonfirmasi pilihan [USUL] di draf aturan.
- Mengirim pengingat lewat WhatsApp dan merekrut kelompok.
- Konsultasi hukum dan kebijakan privasi final sebelum daftar tunggu publik.

Sandbox cloud hanya bisa mengakses registri paket dan GitHub, dan proses latar belakang berhenti beberapa menit setelah balasan selesai. Jadi uji dilakukan dengan proses jangka pendek di dalam sesi.

## 9. Bacaan wajib (urut)

1. `docs/05-aturan-gaple-draf.md` (aturan, parameter, uji mesin)
2. `docs/03-rencana-tahap.md`, bagian "Tahap MVP Uji"
3. `docs/tahap/03-mesin-game.md` (antarmuka mesin, uji properti)
4. `docs/01-spesifikasi.md` bagian 7.4 (bila berbeda dengan draf, tanya)
5. `CLAUDE.md` (keputusan terkini)

Bagian lain spesifikasi (Tiket, Trofi, ledger, ERD, Expo) **bukan** untuk MVP ini; abaikan.

## 10. Prompt siap tempel (sesi pertama, setelah repo tersambung)

```
Baca docs/06-handover-claude-code-mvp.md dan docs/05-aturan-gaple-draf.md sampai habis. Kerjakan Tahap A saja: buat kerangka monorepo pnpm (packages/game-engine, apps/server, apps/web kosong), CLAUDE.md repo, skrip pnpm verify, lalu tulis mesin Gaple TypeScript murni berbasis parameter sesuai draf aturan, lengkap dengan uji unit, uji properti, uji replay, dan simulasi 10.000 game acak untuk 2, 3, dan 4 pemain. Jangan menebak aturan yang belum ada di draf; catat pertanyaan di docs/CATATAN-TAHAP.md. Jangan membangun fitur di luar cakupan (bagian 3). Komunikasi dengan saya dalam Bahasa Indonesia. Di akhir: jalankan pnpm verify, perbarui CATATAN-TAHAP.md, buat tag mvp-A, dan laporkan ringkas apa yang lulus dan apa yang perlu saya putuskan.
```
