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
