# Tahap 09: Tiket

**Tujuan:** Progres 20 kemenangan, beri dan minta Tiket, taruhan 1 Tiket, dan semua pembatasan anti-penyalahgunaan.

**Butuh keputusan manusia sebelum mulai:** Opini hukum tertulis tentang Taruhan 1 Tiket (fitur boleh dibangun di balik flag, jangan dirilis sebelum jelas).

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 9
- docs/02-erd.md bagian 3

## Tugas
1. Progres: setiap kemenangan Ranked peringkat 1 yang memenuhi syarat menambah `win_progress`; mencapai 20 menghasilkan 1 Tiket lewat `applyLedger` (alasan `ranked_wins`) dan mereset ke 0.
2. Syarat hitung: **maksimal 1 kemenangan dihitung per lawan per hari** dan game pasif tidak dihitung (`counted_for_ticket`).
3. Beri Tiket: batas 10 per minggu (dari `ticket_gift`); minta Tiket: satu per teman per hari, menjadi kartu di chat, bisa Beri atau Tolak. Hanya antar teman.
4. Taruhan 1 Tiket: hanya 1-1 dan game Sekarang; Tiket ditahan (escrow) saat masuk room; pemenang di antara dua orang mengambil keduanya; keluar dini dianggap kalah; satu taruhan per pasangan per hari; hanya Tiket, tidak pernah Koin atau uang.
5. Deteksi pola: akun yang menerima banyak Tiket dari banyak akun baru ditandai dan dibatasi.
6. Layar mobile: kartu Tiket di tab Turnamen (progres, minta, beri), kartu Tiket di sheet Ajak main, kartu permintaan di chat, taruhan di sheet Ajak main.

## Kriteria penerimaan
- [ ] Setiap batas di spesifikasi 9.2, 9.3, 9.4 punya uji gagal-bila-dihapus.
- [ ] Tidak ada jalur dari Koin atau Rupiah ke Tiket (uji + tinjauan kode).
- [ ] Saldo Tiket selalu sama dengan jumlah `ledger_entry` Tiket (uji invarian).

## Uji yang harus ada
- Uji win-trading: dua akun saling mengalah hanya menghasilkan 1 kemenangan dihitung per hari; uji batas beri 10 per minggu; uji permintaan ganda; uji taruhan (menang, kalah, keluar dini, ganda); uji invarian ledger lewat 1.000 operasi acak.

## Prompt siap tempel

```
Kerjakan Tahap 09 (docs/tahap/09-tiket.md). Bangun progres 20 kemenangan, beri dan minta Tiket, taruhan 1 Tiket dengan escrow, dan semua pembatasan anti-penyalahgunaan di spesifikasi bagian 9. Semua perubahan saldo lewat applyLedger. Tulis uji gagal-bila-dihapus untuk setiap batas, uji win-trading, dan uji invarian saldo sama dengan jumlah ledger. Pastikan tidak ada jalur Koin ke Tiket. Laporkan bila ada bagian taruhan yang berisiko hukum.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-09`.
