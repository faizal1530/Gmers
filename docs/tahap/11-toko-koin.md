# Tahap 11: Toko dan Koin

**Tujuan:** Beli paket Koin lewat toko aplikasi, dan belanja kosmetik: avatar, emoji, skin dadu.

**Butuh keputusan manusia sebelum mulai:** Akun Google Play dan Apple Developer, serta harga paket Koin final.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 12
- docs/02-erd.md bagian 1

## Tugas
1. Integrasi RevenueCat (Google Play Billing dan Apple IAP); verifikasi di server lewat webhook; `purchase.store_txn` unik mencegah ganda; Koin masuk lewat `applyLedger` (`purchase_pack`).
2. Katalog `item` dan `owned_item`; beli dengan Koin (`buy_item`), tidak bisa dibeli dua kali.
3. Layar Profil: tab Avatar, Emoji, Skin dadu. Emoji store dengan paket tema dan percobaan 24 jam bila ada. Penggantian avatar.
4. Pemulihan pembelian (restore).
5. Koin tidak bisa dikirim, ditarik, atau dipakai untuk Tiket (tidak ada endpoint).

## Kriteria penerimaan
- [ ] Pembelian sandbox lulus di Android dan iOS; pembelian ganda tidak menambah Koin dua kali.
- [ ] Pembelian item mengurangi Koin atomik; saldo tidak pernah negatif.
- [ ] Tidak ada endpoint yang memindahkan Koin antar pengguna.

## Uji yang harus ada
- Uji webhook (idempoten); uji beli item (saldo cukup, kurang, ganda); uji restore.

## Prompt siap tempel

```
Kerjakan Tahap 11 (docs/tahap/11-toko-koin.md). Integrasi RevenueCat dengan webhook server idempoten, paket Koin, katalog kosmetik (avatar, emoji, skin dadu), layar toko bertab di Profil, restore purchase. Koin hanya untuk kosmetik; pastikan tidak ada jalur Koin ke Tiket dan tidak ada transfer Koin. Gunakan sandbox untuk uji.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-11`.
