# Tahap 14: Notifikasi dan streak

**Tujuan:** Notifikasi push netral dan streak yang pemaaf.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 8, 13

## Tugas
1. Push lewat FCM dan APNs; token perangkat; jenis notifikasi dan pengaturan per jenis; teks netral tidak menyebut game; jam tenang 22:00 sampai 07:00; Jangan ganggu menahan.
2. Streak per pasangan teman: hari 03:00 sampai 03:00 WIB, pembeku gratis mingguan (tabung maks 2), pemulihan 24 jam dengan dua game, mode Senyap dan asinkron dihitung, pengingat maks 1 per hari, hanya bila streak 3 hari atau lebih.
3. Milestone 3, 7, 30, 100 hari memberi Bintang (`streak_milestone`).

## Kriteria penerimaan
- [ ] Aturan streak terbukti oleh uji termasuk batas hari dan pembeku.
- [ ] Tidak ada push di jam tenang dan saat Jangan ganggu (diuji).

## Uji yang harus ada
- Uji tabel streak dengan jam tiruan; uji penjadwal pengingat; uji pengaturan notifikasi.

## Prompt siap tempel

```
Kerjakan Tahap 14 (docs/tahap/14-notifikasi-streak.md). Bangun push netral dengan jam tenang dan pengaturan, serta streak pemaaf sesuai spesifikasi bagian 8 dan 13. Gunakan jam yang bisa disuntik agar uji batas hari WIB mudah. Streak tidak memengaruhi trofi atau Tiket.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-14`.
