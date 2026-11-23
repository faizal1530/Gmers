# Tahap 04: Realtime dan wasit

**Tujuan:** Server menjalankan room: pemain terhubung lewat WebSocket, langkah divalidasi mesin, dan game bisa disambung ulang.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 7.2 sampai 7.5
- docs/02-erd.md bagian game
- Tahap 01 dan 03

## Tugas
1. Gateway WebSocket dengan autentikasi JWT, heartbeat, dan sambung ulang dengan nomor urut pesan.
2. Layanan room: buat room, duduk, mulai, kirim `move` (niat), server memvalidasi lewat game-engine, menulis `game_move`, menyiarkan state ke pemain dan penonton.
3. Giliran dan batas waktu (`turn_deadline`); pemain putus dihitung terputus lalu timeout sesuai aturan; game asinkron (giliran 24 jam) dijalankan dari pekerja terjadwal.
4. Penonton: menerima state dengan kartu tangan disembunyikan dan jeda tayang yang dapat dikonfigurasi.
5. Pemulihan: server dimulai ulang tidak kehilangan game (state dibangun ulang dari log langkah).
6. Hasil akhir ditulis ke `game_result` dan `result_player` (trofi dan Tiket dihitung di Tahap 08 dan 09; di sini hanya peringkat).

## Kriteria penerimaan
- [ ] Dua klien uji bisa menyelesaikan game Ludo, Remi, dan Gaple penuh lewat WebSocket.
- [ ] Langkah ilegal atau di luar giliran ditolak dan tidak mengubah state.
- [ ] Memutus dan menyambung ulang klien di tengah game memulihkan state yang benar.
- [ ] Restart server di tengah game tidak kehilangan state (diuji).

## Uji yang harus ada
- Uji integrasi dengan klien WebSocket palsu; uji replay dari log; uji beban sederhana 200 room bersamaan.

## Prompt siap tempel

```
Kerjakan Tahap 04 (docs/tahap/04-realtime.md). Bangun gateway WebSocket dan layanan room di apps/server dengan server sebagai wasit (memakai packages/game-engine), log langkah di game_move, sambung ulang, giliran asinkron, mode penonton dengan kartu tersembunyi, dan pemulihan dari log. Tulis uji integrasi dua klien palsu menyelesaikan game penuh, uji langkah ilegal, uji putus-sambung, dan uji restart server.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-04`.
