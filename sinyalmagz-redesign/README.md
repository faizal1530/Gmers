# Redesign Sinyal Magazine (mockup)

Situs statis. Konten ada di `data/articles.json`, tampilan di `template.html`, `build.mjs` menghasilkan `dist/index.html`.

## Pasang di Cloudflare Pages (update lewat cloud)
1. Taruh folder ini di repo GitHub (boleh repo sendiri, boleh subfolder).
2. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git.
3. Build command: `node build.mjs`. Output directory: `dist`. Root directory: `sinyalmagz-redesign` bila subfolder.
4. Setelah itu, edit `data/articles.json` langsung di github.com (ikon pensil), commit, dan Cloudflare membangun ulang otomatis dalam sekitar 1 menit.
5. Domain: Pages > Custom domains > `www.sinyalmagz.com`. Ubah DNS hanya setelah hasilnya disetujui.

## Catatan
- Gambar masih dimuat langsung (hotlink) dari sinyalmagz.com. Sebelum rilis, unduh ke folder `images/` atau ekspor Media Library WordPress.
- Link artikel masih `#`; isi field `url` per artikel.
- Slider unggulan tidak punya gambar pada halaman asli yang terbaca; hanya artikel pertama yang bergambar.
- Tagline dan teks pengantar Kolom di mockup ditulis baru, bukan dari situs asli.
