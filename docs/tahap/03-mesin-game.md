# Tahap 03: Mesin game

**Tujuan:** Aturan Ludo, Remi, dan Gaple sebagai paket TypeScript murni yang dipakai server dan klien.

**Catatan Remi (12 Nov 2026):** Ludo dan Gaple dikerjakan lebih dulu. Remi menunggu varian aturan dikunci (spesifikasi 7.4 dan pertanyaan terbuka 7; draf di `docs/04-aturan-remi-draf.md`). Mesin dibuat berbasis parameter aturan, jadi varian bisa disesuaikan tanpa membongkar mesin.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 7.4
- prototipe: logika Ludo, Remi, dan Gaple di berkas HTML (referensi perilaku)

## Tugas
1. Antarmuka umum: `init(config, seed) -> State`, `legalMoves(state, seat) -> Move[]`, `apply(state, move) -> State | Error`, `status(state) -> {over, ranking}`. State serializable JSON, deterministik dengan seed, tanpa `Math.random` langsung (injeksi RNG).
2. Ludo: 52 petak, 4 bidak, keluar dengan 6, giliran tambahan untuk 6 dan memakan, petak aman, finish tepat 56, 2-4 pemain.
3. Gaple: 28 kartu, 7 per pemain, 6|6 membuka, ujung kiri dan kanan, lewat, game terkunci dihitung sisa titik, 2-4 pemain.
4. Klien memakai mesin yang sama untuk menampilkan langkah sah; server yang memutuskan.

## Kriteria penerimaan
- [ ] Semua aturan di spesifikasi 7.4 punya uji unit.
- [ ] Simulasi 10.000 game acak per game dan per jumlah pemain selesai tanpa pelanggaran aturan dan tanpa kebuntuan.
- [ ] Peringkat akhir selalu urutan lengkap 1..n, termasuk game terkunci Gaple.

## Uji yang harus ada
- Uji properti: konservasi kartu (28 selalu), bidak tidak melewati finish, tidak ada langkah ilegal diterima, `apply` murni (state lama tidak berubah), replay log langkah menghasilkan state akhir yang sama.

## Prompt siap tempel

```
Kerjakan Tahap 03 (docs/tahap/03-mesin-game.md). Bangun packages/game-engine untuk Ludo, Remi, dan Gaple sebagai TypeScript murni dan deterministik (RNG diinjeksi), sesuai spesifikasi bagian 7.4. Tulis uji unit dan simulasi 10.000 game acak per game per jumlah pemain, plus uji properti dan uji replay. Tidak ada I/O atau dependensi platform di paket ini.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-03`.
