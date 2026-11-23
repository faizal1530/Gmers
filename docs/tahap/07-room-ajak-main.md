# Tahap 07: Room dan ajak main

**Tujuan:** Dari chat, ajak teman main lalu bermain Ludo atau Gaple sampai selesai di aplikasi.

## Masukan (baca dulu)
- docs/01-spesifikasi.md bagian 7.2, 7.3, 5.4
- prototipe: sheet Ajak main, kartu undangan, room, Jangan ganggu, Rekam

## Tugas
1. Sheet Ajak main: game, kapan (sekarang atau 24 jam), mode, Ranked (ditampilkan; logikanya di Tahap 08), dan taruhan (ditampilkan nonaktif; logikanya di Tahap 09).
2. Kartu undangan di chat dengan status (terbuka, ditahan, bergabung, nanti, sibuk, kedaluwarsa). Aturan Jangan ganggu (ditahan) dan Sibuk (balasan otomatis).
3. UI game Ludo, Remi, dan Gaple memakai `packages/game-engine` untuk menampilkan langkah sah; tangan Gaple, papan Ludo, dadu, giliran, layar hasil.
4. Bar atas room: Mute, Jangan ganggu selama di room (dipulihkan saat keluar), Rekam.
5. Rekam: rekaman layar ke folder lokal (Video/Gmers) memakai API platform, indikator REC dan pewaktu, pemberitahuan ke pemain lain, berhenti otomatis saat keluar atau game selesai.
6. Mode per pemain (Suara, Chat, Senyap). Suara sendiri dikerjakan di Tahap 10; di sini mode Chat dan Senyap lengkap.

## Kriteria penerimaan
- [ ] Dua perangkat bisa bermain Ludo, Remi, dan Gaple penuh dari undangan sampai layar hasil.
- [ ] Undangan ke teman Jangan ganggu ditahan tanpa notifikasi.
- [ ] Rekam menghasilkan file di folder lokal dan pemain lain melihat tanda REC (diuji manual di perangkat nyata; catat hasil).

## Uji yang harus ada
- E2E Maestro dua perangkat; uji komponen kartu undangan; uji aturan penerima Jangan ganggu dan Sibuk di server.

## Prompt siap tempel

```
Kerjakan Tahap 07 (docs/tahap/07-room-ajak-main.md). Bangun sheet Ajak main, kartu undangan di chat, UI Ludo, Remi, dan Gaple (memakai packages/game-engine, server sebagai wasit dari Tahap 04), bar atas room dengan Jangan ganggu dan Rekam sesuai spesifikasi bagian 7. Ranked dan taruhan Tiket hanya tampil, logikanya tahap berikutnya. Uji E2E dua perangkat dari undangan sampai layar hasil.
```

## Setelah selesai
Perbarui `docs/CATATAN-TAHAP.md`, jalankan `pnpm verify`, buat tag `tahap-07`.
