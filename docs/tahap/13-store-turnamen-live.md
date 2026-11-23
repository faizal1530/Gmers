# Tahap 13: Games Store, Turnamen, dan Live

**Tujuan:** Tab Games lengkap (Main, Turnamen, Store) dan Live dengan Tonton dan Gabung.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 7.1, 9.5, 11

## Tugas
1. Store: aktivasi game bawaan dan 'segera'; game premium dengan pembelian Koin dan akses tamu gratis di room pemilik (kerangka, tanpa konten game baru).
2. Tab Turnamen: kartu Tiket dan progres, daftar turnamen (kerangka, tanpa hadiah uang); masuk dengan Tiket dicatat `tournament_entry`.
3. Live: daftar room yang tayang; Tonton (penonton, chat penonton, tangan tersembunyi, jeda tayang); Gabung ke kursi kosong. Iklan di sela, bukan di tengah giliran.
4. Kontrol pemain top atas chat penonton.

## Kriteria penerimaan
- [ ] Penonton tidak pernah menerima kartu tangan pemain (diuji di server).
- [ ] Penonton tidak bisa mengirim langkah.
- [ ] Aktivasi game dan kepemilikan premium bekerja.

## Uji yang harus ada
- Uji server: payload penonton tanpa tangan; uji penonton menolak langkah; uji akses tamu game premium.

## Prompt siap tempel

```
Kerjakan Tahap 13 (docs/tahap/13-store-turnamen-live.md). Bangun tab Games (Main, Turnamen, Store) dan Live (Tonton dan Gabung) sesuai spesifikasi 7.1, 9.5, dan 11. Server tidak boleh mengirim kartu tangan ke penonton dan harus menolak langkah dari penonton; tulis uji. Turnamen hanya kerangka tanpa hadiah uang.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-13`.
