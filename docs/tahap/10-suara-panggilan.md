# Tahap 10: Suara dan panggilan

**Tujuan:** Suara di room (maks 4) dan panggilan suara dan video 1-1 lewat WebRTC dengan TURN.

**Butuh keputusan manusia sebelum mulai:** Kebijakan rekaman suara pemain lain.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 5.3, 7.3
- rancangan lengkap bagian 5

## Tugas
1. Signaling lewat WebSocket; WebRTC P2P mesh maks 4 untuk room; TURN (coturn) otomatis sebagai cadangan, wajib untuk match acak.
2. Indikator jaringan per pemain (hijau, kuning, merah) dari statistik WebRTC; kuning menurunkan bitrate; merah mematikan suara pemain itu dan memindahkan game ke chat tanpa mengganggu pemain lain.
3. Mute, mikrofon, izin perangkat, penanganan audio saat aplikasi di latar.
4. Panggilan 1-1 suara dan video dengan layar panggilan; tombol Ajak main dari layar panggilan membuka sheet dengan mode Suara.
5. Kebijakan rekaman: suara pemain lain hanya direkam bila mereka mengizinkan (sesuai keputusan).
6. Panggilan ke teman Jangan ganggu atau Sibuk tidak berdering.

## Kriteria penerimaan
- [ ] Panggilan dan suara room berfungsi di dua perangkat nyata, termasuk lewat TURN (uji dengan jaringan seluler).
- [ ] Satu pemain merah tidak mematikan suara pemain lain (diuji).
- [ ] Match acak selalu lewat relay (diuji dengan memeriksa jenis kandidat ICE).

## Uji yang harus ada
- Uji logika indikator jaringan dengan statistik tiruan; uji manual di perangkat nyata dengan catatan hasil; uji pilihan TURN.

## Prompt siap tempel

```
Kerjakan Tahap 10 (docs/tahap/10-suara-panggilan.md). Bangun suara room (maks 4, WebRTC mesh, coturn sebagai cadangan, relay wajib untuk match acak), indikator jaringan tiga status per pemain, dan panggilan 1-1 suara dan video, sesuai spesifikasi 5.3 dan 7.3. Logika indikator harus bisa diuji dengan statistik tiruan. Catat hasil uji di perangkat nyata di docs/CATATAN-TAHAP.md.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-10`.
