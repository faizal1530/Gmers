/** Semua teks yang dilihat pengguna ada di sini (Bahasa Indonesia). */
export const id = {
  appName: "Gmers",
  tagline: "Main Gaple bareng teman. Cukup satu tautan, tanpa instal dan tanpa akun.",

  home: {
    title: "Main Gaple bareng teman",
    nameLabel: "Nama panggilan",
    namePlaceholder: "Mis. Andi",
    create: "Buat room",
    creating: "Membuat room...",
    howTitle: "Cara main",
    how: [
      "Buat room dan bagikan tautannya ke grup WhatsApp.",
      "Teman membuka tautan, mengisi nama panggilan, lalu duduk.",
      "Kalau sudah 2 sampai 4 orang, pemilik room menekan Mulai.",
    ],
    privacy: "Kebijakan privasi",
  },

  name: {
    hint: "2 sampai 16 karakter",
    tooShort: "Nama panggilan minimal 2 karakter.",
    tooLong: "Nama panggilan maksimal 16 karakter.",
    invalid: "Nama panggilan tidak boleh berisi karakter khusus yang tak terlihat.",
  },

  link: {
    opening: "Membuka tautan...",
    title: "Gabung ke room",
    join: "Duduk dan gabung",
    joining: "Bergabung...",
    playing: "Game di room ini sedang berjalan. Kamu bisa gabung setelah game selesai.",
    full: "Room ini sudah penuh (4 pemain).",
    retry: "Cek lagi",
    returning: (name: string) => `Selamat datang kembali, ${name}`,
  },

  lobby: {
    title: "Ruang tunggu",
    shareTitle: "Ajak teman",
    shareHint: "Bagikan tautan ini ke grup WhatsApp.",
    copy: "Salin tautan",
    copied: "Tersalin",
    copyFailed: "Gagal menyalin. Tekan lama pada tautan lalu salin.",
    whatsapp: "Bagikan ke WhatsApp",
    shareText: (url: string) => `Ayo main Gaple bareng di Gmers! Buka tautan ini: ${url}`,
    seatsTitle: "Kursi",
    empty: "Kursi kosong",
    ready: "Siap",
    offline: "Terputus",
    owner: "Pemilik room",
    you: "Kamu",
    start: "Mulai game",
    needMore: "Butuh minimal 2 pemain untuk mulai.",
    waitHost: (name: string) => `Menunggu ${name} memulai game.`,
    leave: "Keluar dari kursi",
  },

  table: {
    yourTurn: "Giliranmu",
    turnOf: (name: string) => `Giliran ${name}`,
    secondsLeft: (n: number) => `${n} dtk`,
    left: "Kiri",
    right: "Kanan",
    emptyBoard: "Meja masih kosong",
    cardsLeft: (n: number) => `${n} kartu`,
    pass: "Lewat",
    passHint: "Tidak ada kartu yang cocok. Tekan Lewat.",
    pickCard: "Pilih kartu yang menyala.",
    waiting: "Tunggu giliranmu.",
    opening: "Kamu pembuka. Pasang kartu pertama.",
    openingRequired: (card: string) => `Kamu pembuka. Pasang kartu ${card}.`,
    handTitle: "Kartumu",
    pickEnd: "Pasang di ujung mana?",
    atLeft: (n: number) => `Kiri (${n})`,
    atRight: (n: number) => `Kanan (${n})`,
    cancel: "Batal",
    cardLabel: (a: number, b: number) => `Kartu ${a} dan ${b}`,
    cardOff: "tidak bisa dipasang sekarang",
    chainLabel: "Rantai kartu di meja",
    playersLabel: "Pemain",
    autoNote: "Waktu habis: giliran dimainkan otomatis.",
  },

  result: {
    title: "Game selesai",
    winner: (name: string) => `${name} menang`,
    reasonOut: "Kartu habis",
    reasonBlocked: "Game terkunci",
    rank: "Peringkat",
    points: (n: number) => `${n} titik sisa`,
    again: "Main lagi",
    againing: "Memulai...",
    againHint: "Game baru dengan pemain yang sama. Pemenang membuka duluan.",
  },

  chat: {
    open: "Buka chat",
    close: "Tutup chat",
    title: "Chat",
    placeholder: "Tulis pesan",
    send: "Kirim",
    empty: "Belum ada pesan.",
    unread: (n: number) => `${n} pesan belum dibaca`,
    tooFast: "Terlalu cepat. Tunggu sebentar.",
    tooLong: "Pesan terlalu panjang.",
  },

  conn: {
    connecting: "Menyambung...",
    reconnecting: "Menyambung kembali...",
    offline: "Tidak ada internet. Mencoba lagi otomatis.",
    replaced: "Kamu masuk dari tab atau perangkat lain. Tutup tab ini atau muat ulang untuk pindah ke sini.",
    reload: "Muat ulang",
  },

  notFound: {
    title: "Halaman tidak ditemukan",
    body: "Alamat ini tidak ada. Periksa tautannya, atau buat room baru.",
    linkBody: "Tautan room ini tidak dikenal. Minta tautan baru dari temanmu, atau buat room sendiri.",
    home: "Ke beranda",
  },

  errors: {
    generic: "Terjadi kesalahan. Coba lagi.",
    connection: "Tidak bisa terhubung ke server. Periksa internetmu, lalu coba lagi.",
    roomFull: "Room sudah penuh.",
    gameRunning: "Game sedang berjalan. Tunggu game selesai untuk bergabung.",
    retry: "Coba lagi",
    dismiss: "Tutup",
  },

  privacy: {
    title: "Kebijakan privasi",
    draft: "DRAF. Belum ditinjau ahli hukum dan belum final. Jangan dianggap sebagai kebijakan yang berlaku sampai ada versi final.",
    back: "Kembali",
    sections: [
      {
        heading: "Data apa yang kami catat",
        items: [
          "Nama panggilan yang kamu ketik.",
          "Token perangkat acak yang disimpan di peramban kamu (bukan nomor HP, bukan email). Di server hanya disimpan versi hash-nya.",
          "Peristiwa permainan: kapan room dibuat, siapa (lewat token acak) bergabung atau keluar, game dimulai dan selesai, peringkat, dan tombol main lagi.",
          "Jumlah pesan chat. Isi chat tidak disimpan di server dan tidak masuk catatan peristiwa.",
        ],
      },
      {
        heading: "Yang tidak kami kumpulkan",
        items: ["Nomor HP, email, lokasi, kontak, dan alamat IP tidak dicatat. Tidak ada akun dan tidak ada iklan."],
      },
      {
        heading: "Untuk apa",
        items: ["Menjalankan permainan dan memahami apakah kelompok teman mau main lagi di hari yang berbeda (uji produk Gmers). Data tidak dijual dan tidak dibagikan."],
      },
      {
        heading: "Berapa lama",
        items: ["Catatan peristiwa disimpan paling lama 90 hari, lalu dihapus. Isi chat tidak disimpan."],
      },
      {
        heading: "Minta hapus data",
        items: ["Kirim pesan ke tim Gmers lewat orang yang mengajakmu bermain, sebutkan nama panggilan dan kode room pada tautanmu. Kami hapus catatan yang terkait."],
      },
    ],
  },
} as const;

export type Strings = typeof id;
