# Tahap 06: Pertemanan dan chat

**Tujuan:** Mengikuti, menyimpan kontak, pertemanan turunan, dan chat 1-1, grup, serta room sekali pakai.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 5, 6
- docs/02-erd.md bagian 2

## Tugas
1. Endpoint ikuti, berhenti mengikuti, simpan kontak, hapus kontak, blokir; semuanya memanggil `recomputeFriendship`.
2. Pencocokan kontak lewat hash nomor HP dengan persetujuan pengguna (unggah hash, bukan nomor).
3. Percakapan: 1-1 (hanya teman), grup (maks 50), room sekali pakai dengan `expires_at` 24 jam dari aktivitas terakhir; penyapu terjadwal menghapus room kedaluwarsa permanen.
4. Pesan realtime lewat WebSocket, status terbaca, riwayat dengan paginasi, antrean luring di klien.
5. Semua endpoint chat menolak non-teman di server (uji).
6. Layar mobile: daftar chat, chat 1-1, grup baru, chat baru (hanya teman), tab Teman di Komunitas (daftar teman, Menunggu saling), layar profil orang lain (Ikuti, Simpan kontak, status hubungan).
7. Pertemanan putus: riwayat tetap terlihat, kolom tulis diganti pesan, tombol ajak hilang.

## Kriteria penerimaan
- [ ] Skenario pertemanan di prototipe terbukti: ikuti satu arah bukan teman; saling ikuti atau saling simpan kontak jadi teman; hapus syarat terakhir memutus.
- [ ] Non-teman tidak bisa membuat chat, mengirim pesan, atau mengajak main lewat API (diuji).
- [ ] Room kedaluwarsa terhapus oleh penyapu dan aktivitas menggeser `expires_at`.

## Uji yang harus ada
- Uji integrasi aturan teman dan chat; uji penyapu room; uji pembatasan blokir; E2E dua perangkat mengobrol.

## Prompt siap tempel

```
Kerjakan Tahap 06 (docs/tahap/06-pertemanan-chat.md). Bangun pertemanan turunan (follow dan contact_save) dan chat 1-1, grup, serta room sekali pakai sesuai spesifikasi bagian 5 dan 6, termasuk layar mobile. Pastikan setiap endpoint chat memeriksa pertemanan di server dan tulis uji untuk skenario putus pertemanan. Hash nomor HP hanya untuk pencocokan kontak, tidak pernah diekspos.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-06`.
