# Panduan deploy Gmers MVP (untuk non-teknis)

Terakhir diperbarui: Tahap D (24 Nov 2026). Panduan ini ditulis supaya Faizal bisa memasang dan merawat server tanpa Claude. Belum pernah dicoba di layanan hosting sungguhan (sandbox pengembangan tidak punya akun hosting); langkah di bawah sudah diuji sejauh yang mungkin dan bagian yang belum diuji ditandai.

## 1. Apa yang dijalankan

Satu proses Node (di dalam satu kontainer Docker) yang melayani **situs** dan **WebSocket** sekaligus, di satu port.

Tiga aturan yang tidak boleh dilanggar:

1. **Hanya SATU instance/replika.** Room Gaple disimpan di memori proses. Dua instance akan memecah room (pemain satu tautan bisa terpisah).
2. **Wajib ada disk yang bertahan** (Volume) di `/data`. Di sana tersimpan log langkah (`rooms.jsonl`, agar game selamat dari restart) dan catatan peristiwa (`events.csv`, bahan metrik). Tanpa disk bertahan, semua hilang tiap deploy ulang.
3. **Server harus selalu menyala.** Layanan yang menidurkan aplikasi saat sepi (umum pada paket gratis) akan memutus WebSocket dan menghentikan game. Untuk uji kelompok pakai paket yang selalu menyala.

## 2. Variabel lingkungan

| Variabel | Wajib | Isi |
|---|---|---|
| `ADMIN_TOKEN` | ya | Kata sandi rahasia untuk mengunduh CSV. Buat acak, minimal 32 karakter. **Tanpa ini, ekspor mati.** |
| `HASH_SALT` | ya | Garam untuk menyamarkan token perangkat di CSV. Buat acak. Jangan diubah di tengah uji (ID perangkat akan berubah dan pemain yang sama dihitung sebagai orang baru). |
| `DATA_DIR` | ya (di kontainer sudah `/data`) | Folder data. Arahkan ke lokasi Volume. |
| `PORT` | otomatis | Port yang dibaca server. Kebanyakan layanan mengisinya sendiri; bawaan 8787. |
| `GMERS_TURN_TIMEOUT_MS` | tidak | Batas waktu giliran, bawaan `60000` (60 detik). |
| `GMERS_ROOM_IDLE_TTL_MS` | tidak | Sesi room tak aktif dibersihkan setelah ini, bawaan `86400000` (24 jam). Kode tautan kelompok tetap hidup. |
| `GMERS_HEARTBEAT_MS` | tidak | Selang ping koneksi, bawaan `25000`. |
| `GMERS_EVENTS_CSV` | tidak | Nama berkas catatan peristiwa, bawaan `events.csv`. Kosongkan untuk mematikan pencatatan. |
| `GMERS_HOST`, `GMERS_STATIC_DIR` | tidak | Biasanya jangan diubah. |

Membuat nilai acak (di terminal Mac/Linux/WSL):

```bash
openssl rand -hex 32
```

Jalankan dua kali: satu untuk `ADMIN_TOKEN`, satu untuk `HASH_SALT`. **Jangan menulis nilai ini di berkas repo, chat, atau dokumen.** Simpan hanya di pengaturan variabel layanan hosting dan di pengelola kata sandi Anda.

## 3. Railway (jalur utama)

Konfigurasi sebagai kode ada di `railway.toml` (builder Dockerfile, healthcheck `/healthz`, restart saat gagal, 1 replika). Region dan Volume diatur di dasbor/CLI.

**Peringatan paket:** paket Free membuat layanan tidur dan menghentikan WebSocket sehingga game terputus. Uji kelompok butuh paket yang selalu menyala. Akun Trial menghapus volume 30 hari setelah kredit habis.

1. Di dasbor Railway: **New Project > Deploy from GitHub repo** > `faizal1530/Gmers`, cabang `main`. Railway membaca `railway.toml` dan membangun dengan `Dockerfile`.
2. Satu layanan saja, **1 replika** (jangan naikkan). Jangan tambah Postgres/Redis/add-on.
3. **Settings > Region**: pilih Southeast Asia (Singapura).
4. **Volume**: klik kanan layanan > Attach Volume, mount path `/data`. Set `DATA_DIR=/data`.
5. **Variables**: `ADMIN_TOKEN` dan `HASH_SALT` (acak, `openssl rand -hex 32`, masing-masing), `DATA_DIR=/data`. `PORT` diisi Railway sendiri.
6. **Settings > Networking > Generate Domain** (domain bawaan, bukan domain kustom).
7. Lakukan uji asap (bagian 8).

Log: tab **Deployments > View Logs**. Mulai ulang: menu titik tiga deployment > Restart. Ekspor CSV: lihat bagian 6 dengan `ADMIN_TOKEN` yang dibaca dari tab Variables. Cadangan rutin: bagian 7.

## 3b. Opsi lain: layanan hosting yang menjalankan Dockerfile

Cocok bila Anda tidak mau mengurus server sendiri. Syaratnya layanan harus bisa: membangun dari `Dockerfile` di repo, memasang disk bertahan (Volume), mengatur jumlah instance = 1, menjalankan WebSocket, dan memberi HTTPS otomatis. Periksa syarat itu di dokumentasi layanan yang Anda pilih sebelum membayar. (Tahap E akan menyiapkan langkah khusus untuk Railway; bagian ini sengaja umum.)

1. Hubungkan repo GitHub `faizal1530/Gmers` ke layanan, pilih metode build **Dockerfile** (bukan buildpack otomatis).
2. Buat satu layanan/aplikasi dengan **1 instance**. Jangan aktifkan penskalaan otomatis.
3. Pasang **Volume** dan arahkan titik mount ke `/data`. Set `DATA_DIR=/data`.
4. Isi variabel: `ADMIN_TOKEN`, `HASH_SALT`, `DATA_DIR`.
5. Atur **health check** ke jalur `/healthz` (harus menjawab 200).
6. Deploy. Buka alamat publik yang diberikan (HTTPS). Layar "Main Gaple bareng teman" harus muncul.
7. Lakukan uji asap (bagian 8).

## 4. Opsi B: VPS kecil (cadangan)

Contoh dengan Ubuntu dan Docker. Server kecil sudah cukup untuk puluhan room; memori adalah batas utamanya.

```bash
# di VPS, sebagai pengguna biasa dengan sudo
curl -fsSL https://get.docker.com | sudo sh
git clone https://github.com/faizal1530/Gmers.git && cd Gmers
sudo docker build -t gmers .
sudo docker volume create gmers-data
sudo docker run -d --name gmers --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v gmers-data:/data \
  -e ADMIN_TOKEN='ISI-HASIL-OPENSSL-1' -e HASH_SALT='ISI-HASIL-OPENSSL-2' \
  gmers
```

HTTPS lewat proksi balik. Cara paling mudah memakai Caddy (mengurus sertifikat sendiri dan meneruskan WebSocket tanpa pengaturan tambahan). Arahkan DNS domain/subdomain ke IP VPS lebih dulu, lalu:

```bash
sudo apt-get install -y caddy
printf 'contoh.domainmu.id {\n  reverse_proxy 127.0.0.1:8787\n}\n' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

(Ganti `contoh.domainmu.id` dengan domain Anda. Port 80 dan 443 harus terbuka di firewall VPS.)

Memperbarui ke versi baru:

```bash
cd Gmers && git pull
sudo docker build -t gmers .
sudo docker rm -f gmers
# lalu jalankan perintah docker run yang sama seperti di atas (volume gmers-data tetap utuh)
```

## 5. Melihat log, memulai ulang

- Layanan hosting (Opsi A): buka halaman **Logs/Deployments** layanan Anda di dasbor. Mulai ulang lewat tombol **Restart/Redeploy**.
- VPS (Opsi B): `sudo docker logs --tail 200 -f gmers` untuk melihat log; `sudo docker restart gmers` untuk memulai ulang.

Memulai ulang **aman**: room dan game yang sedang berjalan dibangun kembali dari log di `/data`. Pemain yang sambung ulang kembali ke kursi dan kartu yang sama (klien menyambung ulang otomatis dalam beberapa detik).

Server tidak menulis nama, isi chat, nomor HP, atau alamat IP ke log mana pun.

## 6. Mengekspor CSV peristiwa

Ganti `ALAMAT` dengan alamat situs dan `TOKEN` dengan nilai `ADMIN_TOKEN`:

```bash
curl -H "Authorization: Bearer TOKEN" https://ALAMAT/admin/events.csv -o events.csv
```

Alternatif dari peramban: buka `https://ALAMAT/admin/events.csv?token=TOKEN` (hati-hati: token ikut tertulis di riwayat peramban; lebih baik pakai perintah di atas). Tanpa token yang benar, jawabannya 401. Berkas `*.csv` sudah diabaikan git, jadi tidak ikut ter-commit tanpa sengaja.

Menghitung "kelompok aktif" dari CSV (di komputer yang punya klon repo, setelah `pnpm install`):

```bash
pnpm hitung events.csv --out hasil.csv
```

Perintah itu mencetak tabel per kelompok dan ringkasan (kelompok aktif, selesai game pertama, konversi tautan, main lagi dalam 7 hari), dan menulis `hasil.csv`. Definisi lengkap ada di `docs/LAPORAN-MVP.md`.

## 7. Cadangan rutin

Yang berharga adalah `events.csv` (bahan metrik). Unduh rutin, misalnya tiap hari, dan simpan di tempat lain. Contoh cron di komputer Anda atau VPS lain (jalan tiap hari 02.00; token diambil dari variabel lingkungan, bukan ditulis di berkas):

```bash
# crontab -e
0 2 * * * curl -sf -H "Authorization: Bearer $GMERS_ADMIN_TOKEN" https://ALAMAT/admin/events.csv -o "$HOME/gmers-backup/events-$(date +\%F).csv"
```

Pastikan `GMERS_ADMIN_TOKEN` tersedia untuk cron (mis. dengan menaruhnya di berkas `~/.gmers-env` berizin 600 dan memuatnya di awal baris cron). Log langkah (`rooms.jsonl`) cukup dibackup lewat fitur snapshot/backup Volume layanan Anda, atau di VPS: `sudo docker run --rm -v gmers-data:/data -v "$PWD":/out busybox tar czf /out/gmers-data.tgz /data`.

Retensi: kebijakan privasi (draf) menyebut catatan peristiwa disimpan paling lama 90 hari. Hapus baris yang lebih tua secara berkala (hentikan server sebentar agar berkas tidak sedang ditulis, saring berkas di `/data/events.csv` berdasarkan kolom `ts_utc`, lalu nyalakan lagi).

## 8. Uji asap setelah deploy

1. `https://ALAMAT/healthz` menjawab `ok`.
2. `https://ALAMAT/` menampilkan beranda; `https://ALAMAT/admin/events.csv` menjawab 401 tanpa token dan CSV dengan token.
3. Di dua HP berbeda (data seluler, bukan WiFi yang sama): buat room di HP 1, buka tautan di HP 2, mulai, mainkan satu game sampai selesai.
4. Di HP 2, muat ulang halaman di tengah game: harus kembali ke kursi dengan kartu yang sama.
5. Mulai ulang layanan saat game berjalan: setelah beberapa detik pemain tersambung kembali dan game berlanjut.
6. Unduh CSV: harus ada baris `group_created`, `player_joined`, `game_started`, `game_finished`.

## 9. Jalan pintas pemecahan masalah

| Gejala | Kemungkinan sebab |
|---|---|
| Pemain terputus dan game berhenti tiap beberapa menit | Layanan menidurkan aplikasi (paket gratis) atau proksi memutus WebSocket nganggur. Pakai paket yang selalu menyala. |
| Pemain satu tautan masuk ke room yang berbeda | Lebih dari satu instance berjalan. Turunkan menjadi 1. |
| Setelah deploy ulang semua game dan CSV hilang | Volume belum terpasang di `/data` (atau `DATA_DIR` salah). |
| `/admin/events.csv` menjawab 503 | `ADMIN_TOKEN` belum diisi. |
| `/admin/events.csv` menjawab 401 | Token salah, atau ada spasi/baris baru yang ikut tersalin. |
| Halaman putih | Buka konsol peramban; biasanya build klien tidak ada (`apps/web/dist`). Bangun ulang image. |
