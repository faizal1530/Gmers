# Tahap 12: Komunitas

**Tujuan:** Feed utas dengan komunitas, postingan foto dan video, balasan, moderasi, dan iklan native.

**Butuh keputusan manusia sebelum mulai:** Batas usia dan kebijakan moderasi unggahan video.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 10
- docs/02-erd.md bagian 4
- prototipe: tab Untukmu, Mengikuti, Teman, komunitas, kartu iklan

## Tugas
1. Endpoint feed (Untukmu, Mengikuti, Teman), komunitas, bergabung, room komunitas, postingan, balasan, suka dan simpan, bagikan ke chat.
2. Unggah media lewat URL bertanda tangan ke penyimpanan S3; batas durasi 60 detik dan 50 MB; status moderasi `pending` sampai lolos pemindaian otomatis.
3. Moderasi: lapor, sembunyikan, blokir; antrean laporan untuk admin; pemindaian konten otomatis lewat antarmuka `ContentScanner` (adapter palsu dulu).
4. Iklan native: kartu 'Bersponsor' setiap 3 postingan, opsi sembunyikan, pembatasan frekuensi, catat `ad_impression` dengan placement 'feed' atau 'live' saja; kategori judi dan taruhan ditolak.
5. Kenalan hari ini: rekomendasi sederhana (game sama, kota sama).
6. Layar mobile sesuai prototipe, termasuk menulis postingan dari galeri.

## Kriteria penerimaan
- [ ] Alur lihat, tulis, balas, ikuti, dan bergabung berjalan di dua perangkat.
- [ ] Tidak ada iklan di respons chat atau room (diuji); kategori terlarang ditolak.
- [ ] Media pending tidak tampil ke publik.

## Uji yang harus ada
- Uji penempatan iklan; uji batas unggah; uji moderasi pending; uji laporan; E2E tulis dan baca postingan.

## Prompt siap tempel

```
Kerjakan Tahap 12 (docs/tahap/12-komunitas.md). Bangun feed Komunitas (Untukmu, Mengikuti, Teman), komunitas dan room komunitas, postingan foto dan video dengan moderasi pending, balasan, lapor, dan iklan native sesuai spesifikasi bagian 10. Iklan tidak pernah di chat atau game, dan kategori judi atau taruhan ditolak; tulis uji untuk itu. Ikuti tampilan prototipe.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-12`.
