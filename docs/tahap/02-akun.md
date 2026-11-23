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
