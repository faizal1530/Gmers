# Tahap 15: Pengerasan dan rilis

**Tujuan:** Keamanan, beban, kepatuhan, dan beta tertutup 50 sampai 100 pemain.

**Butuh keputusan manusia sebelum mulai:** Klasifikasi gim, pendaftaran PSE, kebijakan privasi, dan ambang keputusan beta.

## Masukan (baca dulu)
- Seluruh dokumen
- rancangan lengkap bagian 3 dan 8

## Tugas
1. Tinjauan keamanan: OWASP Mobile dan API, rate limit semua endpoint publik, pemeriksaan otorisasi per sumber daya (uji IDOR), rotasi rahasia, pencadangan basis data.
2. Uji beban: 500 room bersamaan, 5.000 koneksi; pantau latensi gerakan di bawah 300 ms median.
3. Pemantauan: log terstruktur tanpa data pribadi, metrik (retensi, undangan diterima, suara jatuh ke TURN), pelacak galat.
4. Kepatuhan: kebijakan privasi dan persetujuan (UU PDP), halaman syarat, klasifikasi gim (Permenkominfo 2/2024), pendaftaran PSE, label usia di toko.
5. Pengujian oleh Claude: jalankan seluruh suite, E2E semua alur utama di dua perangkat, uji eksplorasi bermodal daftar risiko, dan laporan cacat.
6. Beta tertutup: TestFlight dan jalur uji Google Play, formulir umpan balik, ambang keputusan Fase 1 ditetapkan sebelum mulai (lihat rancangan lengkap bagian 8).

## Kriteria penerimaan
- [ ] Tidak ada temuan keamanan tingkat tinggi yang terbuka.
- [ ] Uji beban memenuhi target.
- [ ] Daftar periksa kepatuhan lengkap dan disetujui manusia.
- [ ] Build beta terpasang di perangkat nyata Android dan iOS.

## Uji yang harus ada
- Uji IDOR untuk semua sumber daya; uji rate limit; uji beban; E2E penuh.

## Prompt siap tempel

```
Kerjakan Tahap 15 (docs/tahap/15-pengerasan-rilis.md). Lakukan tinjauan keamanan API dan mobile, uji otorisasi per sumber daya (IDOR), rate limit, uji beban 500 room, pemantauan tanpa data pribadi, dan daftar periksa kepatuhan. Jalankan seluruh suite dan E2E, tulis laporan cacat, dan siapkan build beta. Jangan menyatakan siap rilis; serahkan daftar periksa kepatuhan untuk keputusan manusia.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-15`.
