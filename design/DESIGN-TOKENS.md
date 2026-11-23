# Design tokens Gmers (diambil dari prototipe v14)

Sumber: `design/gmers-prototipe-v14.html` (blok `:root` di baris 7 sampai 19). Prototipe adalah referensi tampilan dan alur, **bukan kode untuk disalin**. Bila spesifikasi dan prototipe berbeda, spesifikasi menang.

## Font
`'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif` (bobot 400, 600, 700, 800; Google Fonts).

## Warna

| Token | Terang | Gelap | Pakai untuk |
|---|---|---|---|
| `--stage` | #E7E1D3 | #091213 | Latar luar bingkai |
| `--bg` | #F7F3EA | #0F1D1E | Latar halaman |
| `--card` | #FFFFFF | #162A2B | Kartu |
| `--ink` | #1B2A2F | #EDE9DE | Teks utama |
| `--muted` | #5E6D70 | #9DB0B1 | Teks sekunder |
| `--line` | #E4DDCC | #28423F | Garis pemisah |
| `--accent` | #0F6B63 | #3FB5A8 | Tombol utama, tautan |
| `--on-accent` | #FFFFFF | #06201E | Teks di atas aksen |
| `--deep` | #0F3D3E | #0F3D3E | Latar gelap pekat |
| `--coral` | #C7401C | #F0794F | Peringatan, aksen kedua |
| `--gold` | #F2B33D | #F2B33D | Koin, sorotan |
| `--good` | #2E8B57 | #4CC38A | Berhasil, daring |
| `--warn` | #D99A12 | #E8B230 | Waspada |
| `--bad` | #C7401C | #F0794F | Gagal |
| `--soft` | #EFE8D8 | #1D3436 | Latar lembut |
| `--tile` | #FBF8F0 | (sama) | Badan kartu domino |
| `--tile-pip` | #1B2A2F | (sama) | Titik kartu domino |

Tema gelap mengikuti `prefers-color-scheme: dark`. Dua tema didesain sama seriusnya; jangan hanya membalik warna.

## Kartu Gaple di prototipe
Kartu domino: badan `--tile` (#FBF8F0), garis tengah #B7AE98, titik `--tile-pip`, sudut membulat sekitar 5 px. Meja bernuansa hijau (#1F6B4E dengan lingkaran #2A8A64). Lihat fungsi `art('gaple')` di prototipe.

## Aturan tampilan MVP Room Web
- Mobile-first, lebar uji 360 px. Semua teks Bahasa Indonesia.
- Hanya kartu yang sah yang bisa diketuk (dari `legalMoves`); kartu lain diredupkan.
- Ujung kiri dan kanan rantai harus jelas terlihat dan menunjukkan angka yang dicari.
- Chat teks tidak boleh menutupi meja; tampilkan sebagai lapisan yang bisa dibuka-tutup.
- Status koneksi tiap pemain (daring, terputus) terlihat di kursinya.
- Target sentuh minimal 44 px.
