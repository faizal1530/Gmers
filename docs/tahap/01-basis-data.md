# Tahap 01: Basis data

**Tujuan:** Skema PostgreSQL berjalan lewat migrasi dan batasan datanya terbukti oleh uji.

## Masukan (baca dulu)
- docs/02-erd.md
- docs/schema.sql

## Tugas
1. Ubah `docs/schema.sql` menjadi migrasi bernomor di `apps/server/migrations` (jangan menyalin buta: tinjau dan perbaiki bila ada celah).
2. Generator tipe Kysely dari skema.
3. Seed pengembangan: 8 pengguna, beberapa pertemanan, komunitas Gaple Bandung dan lainnya, katalog item, game, paket Koin.
4. Modul `ledger`: fungsi tunggal `applyLedger(tx, userId, currency, amount, reason, refId)` yang menulis `ledger_entry` dan memperbarui `wallet` dalam satu transaksi; menolak saldo negatif.
5. Modul `friendship`: `recomputeFriendship(tx, a, b)` memanggil fungsi SQL dan dipanggil dari semua perubahan follow, kontak, dan blokir.

## Kriteria penerimaan
- [ ] Migrasi naik dan turun tanpa galat pada basis data kosong.
- [ ] Semua batasan di `docs/02-erd.md` bagian 'Aturan integritas' punya uji yang gagal bila batasan dihapus.
- [ ] Tidak ada jalur kode yang mengubah `wallet` selain `applyLedger`.

## Uji yang harus ada
- Uji: saldo negatif ditolak; `ledger_entry` tidak bisa diubah; alasan lintas mata uang ditolak (Koin ke Tiket); nomor HP ganda ditolak; iklan kategori judi ditolak; penempatan iklan 'chat' ditolak; pertemanan terbentuk dan putus sesuai `follow` dan `contact_save`; room dengan `expires_at` hanya untuk jenis room.

## Prompt siap tempel

```
Kerjakan Tahap 01 (docs/tahap/01-basis-data.md). Ubah docs/schema.sql menjadi migrasi di apps/server/migrations, tambahkan tipe Kysely, seed, modul ledger (applyLedger) dan friendship (recomputeFriendship). Tulis uji integrasi di Postgres nyata untuk setiap aturan di docs/02-erd.md bagian Aturan integritas, termasuk bahwa Koin tidak bisa menjadi Tiket. Tinjau skema kritis dan laporkan bila ada celah sebelum membangun di atasnya.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-01`.
