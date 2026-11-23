# Tahap 05: Cangkang aplikasi

**Tujuan:** Navigasi empat tab, tema, komponen dasar, avatar dengan lencana kelas, dan status pengguna.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 1, 4, 5.4
- prototipe: warna, tipografi, komponen

## Tugas
1. Navigasi: Chat, Komunitas, Games, Live; tombol mengambang di kanan bawah (+ di Chat, pensil di Komunitas).
2. Token desain (terang dan gelap) mengikuti prototipe: warna, tipografi, jarak. Komponen: tombol, kartu, sheet bawah, toast, chip, tab segmen, switch.
3. Komponen `Avatar` (SVG, 6 basic + premium) dengan lencana kelas yang dihitung dari trofi.
4. Status pengguna (Siap main, Sibuk, Senyap, Jangan ganggu) dengan sheet pemilih; disimpan di server.
5. i18n Bahasa Indonesia dari berkas tunggal.

## Kriteria penerimaan
- [ ] Semua tab terbuka dengan data stub.
- [ ] Mode gelap dan terang benar; target sentuh minimal 44 px; label pembaca layar ada.
- [ ] Avatar menampilkan lencana kelas yang benar untuk setiap ambang trofi (diuji).

## Uji yang harus ada
- Uji komponen untuk Avatar (kelas dari trofi), sheet, dan status. Uji snapshot tampilan tema.

## Prompt siap tempel

```
Kerjakan Tahap 05 (docs/tahap/05-cangkang-aplikasi.md). Bangun navigasi 4 tab, tema terang dan gelap, komponen dasar, komponen Avatar dengan lencana kelas (Pemula, Jago, Pro, Master, Raja dari packages/shared config), dan status pengguna. Ikuti tampilan prototipe. Semua teks lewat i18n id.ts.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-05`.
