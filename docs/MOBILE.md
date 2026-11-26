# Aplikasi Android dan iOS (Capacitor)

Keputusan 25 Nov 2026 (menggantikan "Expo/React Native" di CLAUDE.md untuk tahap ini): aplikasi native **membungkus klien web yang sudah ada** memakai Capacitor 8 (`apps/mobile`). Alasan: tidak menulis ulang UI, semua uji web tetap berlaku, satu basis kode. Dependensi baru: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/assets` (alat bantu).

## Cara kerja
`apps/mobile/capacitor.config.json` memakai `server.url` = `https://gmers-production.up.railway.app`: WebView memuat situs langsung dari server, jadi pembaruan situs langsung terlihat di aplikasi tanpa rilis ulang, dan tidak ada masalah CORS/origin untuk API dan WebSocket. Konsekuensi: **aplikasi tidak jalan tanpa internet**, dan Apple App Review bisa menolak aplikasi yang hanya membungkus situs ("minimum functionality", pedoman 4.2). Untuk rilis App Store pertimbangkan: aset web dibundel (`webDir`) + CORS di server + URL server lewat konfigurasi, serta fitur native (notifikasi push, Sign in with Apple bila ada login pihak ketiga). Ganti alamat server dengan mengubah `server.url` lalu `pnpm --filter @gmers/mobile sync`.

Izin Android: hanya INTERNET dan ACCESS_NETWORK_STATE. Tidak ada kamera, mikrofon, lokasi, atau kontak.

## Unduhan APK dari situs
APK debug disajikan oleh server di `/download/gmers-debug.apk` (berkas sumber: `apps/web/public/download/`, ikut ke `dist` saat `pnpm build`), dan ada tautan "Unduh APK Android" di tab Profil (disembunyikan di dalam aplikasi native). Setelah membuild APK baru, salin ke `apps/web/public/download/gmers-debug.apk`, perbarui `.sha256`-nya (`sha256sum`), lalu commit dan deploy. Ini APK **debug** (kunci debug), hanya untuk uji; jangan dibagikan luas sebelum ada build rilis bertanda tangan.

## Build Android (APK debug)
Butuh JDK 21 dan Android SDK (platform 36, build-tools 36.0.0).
```bash
pnpm install
pnpm --filter @gmers/web build
cd apps/mobile
echo "sdk.dir=$HOME/Android/Sdk" > android/local.properties   # sesuaikan lokasi SDK
pnpm android:debug
# hasil: apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```
Pasang di HP: aktifkan "Pasang dari sumber tidak dikenal", salin APK ke HP, buka. Atau `adb install -r app-debug.apk`.

**Rilis Play Store** (tindakan Anda): akun Google Play Developer (biaya sekali bayar), keystore penanda tangan **yang Anda simpan sendiri dan tidak pernah masuk repo**, `./gradlew bundleRelease` menghasilkan `.aab`, kebijakan privasi final (teks sekarang DRAF), formulir Data Safety, dan peringkat konten.

## Build iOS
Tidak bisa dibuat di Linux. Proyek `apps/mobile/ios` (Swift Package Manager, tanpa CocoaPods) sudah dibuat. Di Mac dengan Xcode:
```bash
pnpm install
cd apps/mobile && npx cap sync ios && npx cap open ios
```
Di Xcode: pilih Team (akun Apple Developer, berbayar tahunan), atur Bundle Identifier bila `id.gmers.app` dipakai pihak lain, jalankan di simulator atau perangkat, lalu Product > Archive untuk TestFlight/App Store. **Belum pernah dibuka atau dibuild di Xcode** oleh siapa pun; mungkin perlu penyesuaian kecil.

## Ikon dan splash
Sumber: `apps/mobile/assets/icon.svg` (placeholder: dadu di latar hijau, bukan identitas merek final). `pnpm --filter @gmers/mobile icons` membuat PNG, lalu `npx capacitor-assets generate --android --ios --assetPath assets` mengisi semua ukuran.

## Yang belum diuji
APK sudah berhasil dibuild di sini tetapi **belum pernah dijalankan** (tidak ada emulator atau HP): tampilan di WebView, bunyi, status bar, dan tombol kembali Android belum dilihat. Uji di HP asli sebelum dibagikan.
