# Aturan Remi (draf untuk mesin game)

Status: **DRAF, belum dikunci.** Disusun dari sumber di internet tanggal 12 Nov 2026. Varian yang dimainkan mahasiswa ITB Bandung harus dikonfirmasi lewat wawancara sebelum mesin dibangun (spesifikasi 01, bagian 7.4 dan pertanyaan terbuka nomor 7). Setelah dikunci, isi dokumen ini dipindahkan ke bagian 7.4 spesifikasi.

Versi lengkap (perbandingan dua varian, tabel parameter, aturan, pertanyaan wawancara, uji mesin, sumber) ada di Project Claude: `spec/04-aturan-remi-draf.md`.

## Ringkas

Dua varian ditemukan. **Remi Indonesia** (Pagat, GameRules): 2 sampai 4 pemain, 7 kartu, 52 kartu tanpa joker; meld pertama harus urutan (tanpa As), set baru sah setelah ada urutan; meld di meja tidak bisa ditambah; boleh ambil dari 3 kartu teratas buangan bila langsung dipakai; menutup dengan menyusun semua kartu kecuali satu lalu membuangnya; poin 2 sampai 10 = 5, J/Q/K = 10, As = 15, penutup bonus 10 kali nilai kartu penutup. **Rummy umum** (Liputan6): 2 sampai 6 pemain, 10 kartu untuk 2 pemain dan 7 untuk 3 sampai 4, boleh menambah ke meld (lay off), menang saat kartu habis, As 1 poin.

Mesin dibuat berbasis parameter (`handSize`, `firstMeldMustBeSequence`, `aceInSequence`, `allowLayOff`, `discardPickDepth`, `closeRule`, `cardValue`, `closeBonusMultiplier`, `targetScore`) supaya varian bisa disesuaikan tanpa membongkar mesin.

## Sumber
- https://pagat.com/rummy/indonesian_remi.html
- https://gamerules.com/rules/indonesian-remi/
- https://www.liputan6.com/citizen6/read/7926097/cara-main-remi
