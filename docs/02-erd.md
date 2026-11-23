# Gmers: ERD dan Skema Data

Basis data: PostgreSQL 16. Semua kunci utama `uuid` (v7, urut waktu). Waktu `timestamptz` (UTC). Uang dalam Rupiah bulat (`integer`), Koin, Bintang, Tiket, dan Trofi selalu bilangan bulat. Skema SQL lengkap ada di `docs/schema.sql` dan menjadi sumber kebenaran; diagram ini untuk dibaca manusia.

## Prinsip desain

1. **Buku besar (ledger) untuk semua mata uang.** Saldo Koin, Bintang, Tiket, dan Trofi tidak disimpan sebagai angka yang diubah sembarangan. Setiap perubahan adalah baris di `ledger_entry` (hanya ditambah, tidak pernah diubah). Saldo di `wallet` adalah salinan yang diperbarui dalam transaksi yang sama dengan baris ledger.
2. **Tiga mata uang tidak boleh berpindah.** Ada batasan data: `ledger_entry.currency` dan `reason` dibatasi daftar, dan tidak ada alasan yang menukar Koin ke Tiket atau Rupiah ke Tiket.
3. **Pertemanan bukan tabel yang diisi manual.** Dihitung dari `follow` dan `contact_save`, dan disimpan sebagai `friendship` (turunan) agar kueri cepat dan bisa diaudit.
4. **Game disimpan sebagai log langkah** (`game_move`) agar bisa diputar ulang, divalidasi ulang, dan dipakai deteksi curang.
5. **Konten dan pesan** memakai penghapusan lunak (`deleted_at`), kecuali room sekali pakai yang dihapus permanen oleh penyapu terjadwal.

## Diagram

Empat diagram per domain. File sumber ada di `docs/erd/*.mmd` dan hasil render di `docs/erd/*.svg`. Entitas `APP_USER` muncul di beberapa diagram supaya hubungan terbaca; tabelnya satu. Hanya kolom penting yang ditampilkan; daftar penuh ada di `schema.sql`.

### 1. Akun dan keuangan

```mermaid
erDiagram
    APP_USER ||--|| WALLET : punya
    APP_USER ||--o{ LEDGER_ENTRY : mencatat
    APP_USER ||--o{ DEVICE : memakai
    APP_USER ||--o{ OTP_CODE : verifikasi
    APP_USER ||--o{ PURCHASE : membeli
    COIN_PACK ||--o{ PURCHASE : paket
    APP_USER ||--o{ OWNED_ITEM : memiliki
    ITEM ||--o{ OWNED_ITEM : kosmetik
    APP_USER ||--o{ GAME_OWNERSHIP : membuka
    GAME ||--o{ GAME_OWNERSHIP : premium
    APP_USER {
        uuid id PK
        text google_sub UK
        text email
        text phone_hash UK
        bytea phone_enc
        text display_name
        text avatar_id
        int trophies
        text status
    }
    WALLET {
        uuid user_id PK
        int coins
        int stars
        int tickets
        int win_progress
    }
    LEDGER_ENTRY {
        uuid id PK
        uuid user_id FK
        text currency
        int amount
        text reason
        uuid ref_id
    }
    PURCHASE {
        uuid id PK
        uuid user_id FK
        text pack_id FK
        text store_txn UK
        text state
    }
    ITEM {
        text id PK
        text kind
        int price_coins
    }
    GAME {
        text id PK
        bool premium
        int price_coins
    }
```

### 2. Hubungan sosial dan chat

```mermaid
erDiagram
    APP_USER ||--o{ FOLLOW : mengikuti
    APP_USER ||--o{ CONTACT_SAVE : menyimpan
    APP_USER ||--o{ BLOCK : memblokir
    APP_USER ||--o{ FRIENDSHIP : berteman
    APP_USER ||--o{ STREAK : berstreak
    CONVERSATION ||--o{ CONVERSATION_MEMBER : anggota
    APP_USER ||--o{ CONVERSATION_MEMBER : ikut
    CONVERSATION ||--o{ MESSAGE : berisi
    APP_USER ||--o{ MESSAGE : kirim
    MESSAGE ||--o| GAME_INVITE : kartu_undangan
    MESSAGE ||--o| TICKET_REQUEST : kartu_tiket
    FOLLOW {
        uuid follower_id PK
        uuid followee_id PK
    }
    CONTACT_SAVE {
        uuid saver_id PK
        uuid saved_id PK
    }
    FRIENDSHIP {
        uuid user_a PK
        uuid user_b PK
        text basis
        timestamptz since
    }
    STREAK {
        uuid user_a PK
        uuid user_b PK
        int count
        date last_day
        int freezes
    }
    CONVERSATION {
        uuid id PK
        text kind
        text title
        timestamptz last_activity_at
        timestamptz expires_at
    }
    MESSAGE {
        uuid id PK
        uuid conversation_id FK
        uuid sender_id FK
        text kind
        text body
        timestamptz deleted_at
    }
    GAME_INVITE {
        uuid message_id PK
        text game_id FK
        text mode
        bool live
        bool ranked
        bool bet_ticket
        text state
    }
    TICKET_REQUEST {
        uuid message_id PK
        uuid requester_id FK
        uuid target_id FK
        date day
        text state
    }
```

### 3. Game dan Tiket

```mermaid
erDiagram
    GAME ||--o{ ROOM : dimainkan
    CONVERSATION ||--o{ ROOM : menyelenggarakan
    COMMUNITY ||--o{ ROOM : menyelenggarakan
    ROOM ||--o{ ROOM_PLAYER : kursi
    APP_USER ||--o{ ROOM_PLAYER : bermain
    ROOM ||--o{ GAME_MOVE : log
    ROOM ||--o| GAME_RESULT : berakhir
    GAME_RESULT ||--o{ RESULT_PLAYER : peringkat
    APP_USER ||--o{ RESULT_PLAYER : diperingkat
    ROOM ||--o| TICKET_BET : taruhan
    APP_USER ||--o{ TICKET_GIFT : memberi
    ROOM {
        uuid id PK
        text game_id FK
        uuid conversation_id FK
        uuid community_id FK
        text state
        bool ranked
        bool live
        bool random_match
    }
    ROOM_PLAYER {
        uuid room_id PK
        uuid user_id PK
        smallint seat
        text voice_mode
        bool connected
    }
    GAME_MOVE {
        uuid room_id PK
        int seq PK
        smallint seat
        jsonb payload
    }
    GAME_RESULT {
        uuid room_id PK
        text end_reason
        timestamptz ended_at
    }
    RESULT_PLAYER {
        uuid room_id PK
        uuid user_id PK
        smallint rank
        int trophy_delta
        int stars_earned
        bool counted_for_ticket
    }
    TICKET_BET {
        uuid id PK
        uuid room_id FK
        uuid user_a FK
        uuid user_b FK
        date day
        text state
        uuid winner_id
    }
    TICKET_GIFT {
        uuid id PK
        uuid giver_id FK
        uuid receiver_id FK
        timestamptz created_at
    }
```

### 4. Komunitas, iklan, dan keselamatan

```mermaid
erDiagram
    COMMUNITY ||--o{ COMMUNITY_MEMBER : anggota
    APP_USER ||--o{ COMMUNITY_MEMBER : bergabung
    COMMUNITY ||--o{ POST : memuat
    APP_USER ||--o{ POST : menulis
    POST ||--o{ POST_MEDIA : lampiran
    POST ||--o{ POST_REPLY : balasan
    POST ||--o{ POST_REACTION : reaksi
    AD ||--o{ AD_IMPRESSION : tampil
    APP_USER ||--o{ AD_IMPRESSION : melihat
    APP_USER ||--o{ REPORT : melapor
    APP_USER ||--o{ NOTIFICATION : menerima
    COMMUNITY {
        uuid id PK
        text slug UK
        text name
        text game_id FK
    }
    POST {
        uuid id PK
        uuid community_id FK
        uuid author_id FK
        text kind
        text body
        timestamptz deleted_at
    }
    POST_MEDIA {
        uuid id PK
        uuid post_id FK
        text kind
        text url
        text moderation
    }
    AD {
        uuid id PK
        text advertiser
        text category
        bool active
    }
    AD_IMPRESSION {
        uuid id PK
        uuid ad_id FK
        uuid user_id FK
        text placement
        bool hidden
    }
    REPORT {
        uuid id PK
        uuid reporter_id FK
        text target_kind
        uuid target_id
        text state
    }
    NOTIFICATION {
        uuid id PK
        uuid user_id FK
        text kind
        jsonb payload
        timestamptz read_at
    }
```

## Kamus tabel

### Akun dan keuangan
| Tabel | Isi | Aturan penting |
|---|---|---|
| `app_user` | Akun. Login Google (`google_sub`), nomor HP (hash untuk pencocokan, terenkripsi untuk kirim OTP), avatar, nama, trofi, status (siap, sibuk, senyap, dnd). | Satu `phone_hash` untuk satu akun (unik). Kelas tidak disimpan; dihitung dari trofi. |
| `otp_code` | Kode verifikasi (hash), percobaan, kedaluwarsa. | Kedaluwarsa 5 menit, maksimal 5 percobaan. |
| `device` | Token push dan sidik perangkat. | Dipakai deteksi akun ganda. |
| `wallet` | Saldo Koin, Bintang, Tiket, dan progres menang menuju Tiket. | Hanya diubah lewat fungsi yang menulis `ledger_entry`. Ada CHECK saldo >= 0. |
| `ledger_entry` | Buku besar mata uang (Koin, Bintang, Tiket). Trofi dicatat di `result_player`. | Hanya INSERT. `reason` dari daftar tetap; tidak ada alasan lintas mata uang. |
| `coin_pack`, `purchase` | Paket Koin dan pembelian dari toko aplikasi, dengan token transaksi. | Token transaksi unik (cegah pembelian ganda). |
| `item`, `owned_item` | Katalog kosmetik (avatar, emoji, skin) dan kepemilikan. | Harga dalam Koin. |
| `game_ownership` | Game premium yang dimiliki pengguna. | Pemilik room membeli; tamu main gratis (dicek lewat room). |

### Hubungan sosial
| Tabel | Isi | Aturan penting |
|---|---|---|
| `follow` | A mengikuti B. | Tidak boleh mengikuti diri sendiri. |
| `contact_save` | A menyimpan kontak B. | Pencocokan lewat nomor HP atau pilihan manual. |
| `friendship` | Turunan: pasangan (a<b) dan dasar (`follow` atau `contact`). | Dibuat/dihapus oleh fungsi `recompute_friendship(a,b)` setiap `follow` atau `contact_save` berubah. |
| `block` | Pemblokiran. | Memutus pertemanan. |
| `streak` | Pasangan teman, hitungan, tanggal terakhir, pembeku tersimpan. | Pasangan terurut (a<b). |

### Chat
| Tabel | Isi | Aturan penting |
|---|---|---|
| `conversation` | Jenis `direct`, `group`, atau `room`. `expires_at` hanya untuk `room`. | Room dihapus penyapu bila `now() > expires_at`. `expires_at` digeser 24 jam saat ada aktivitas. |
| `conversation_member` | Anggota dan pesan terakhir yang dibaca. | `direct` selalu tepat 2 anggota dan keduanya berteman saat dibuat. |
| `message` | Isi pesan. `kind`: teks, emoji, undangan, tiket, sistem. | |
| `game_invite` | Detail kartu undangan: game, mode, kapan, ranked, taruhan, status. | |
| `ticket_request` | Permintaan Tiket antar teman. | Satu per peminta, target, dan hari (UNIQUE). |

### Game
| Tabel | Isi | Aturan penting |
|---|---|---|
| `game` | Katalog: Ludo, Gaple, dan lainnya. Aktif atau tidak, premium atau tidak. | |
| `room` | Sesi bermain. `state`: menunggu, berjalan, selesai, dibatalkan. Bisa terkait `conversation` atau `community`. | |
| `room_player` | Kursi, mode (suara, chat, senyap), status koneksi. | Maksimal 4 per room. |
| `game_move` | Log langkah berurutan (`seq`). | Hanya INSERT. UNIQUE (`room_id`, `seq`). |
| `game_result`, `result_player` | Hasil, peringkat, perubahan trofi, penanda apakah kemenangan dihitung ke Tiket. | `counted_for_ticket` false untuk lawan yang sama pada hari itu atau game pasif. |
| `ticket_bet` | Taruhan 1 Tiket 1-1 dengan escrow. | Satu per pasangan per hari (UNIQUE pada pasangan dan tanggal). |
| `ticket_gift` | Pemberian Tiket. | Batas 10 per minggu dihitung dari baris ini. |

### Komunitas dan iklan
| Tabel | Isi |
|---|---|
| `community`, `community_member` | Komunitas (misal Gaple Bandung) dan anggotanya. Room komunitas memakai `room.community_id`. |
| `post`, `post_media`, `post_reply`, `post_reaction` | Postingan (kind: biasa atau perkenalan), media (foto, video), balasan utas, dan suka atau simpan. |
| `ad`, `ad_impression` | Iklan native dan catatan tampil, untuk pelaporan dan pembatasan frekuensi. |

### Keselamatan
`report` (pelapor, sasaran, alasan, status) dan `notification` (jenis, payload, terbaca).

## Aturan integritas yang harus dijaga basis data

1. `wallet` tidak pernah negatif.
2. `ledger_entry` tidak bisa diubah atau dihapus (pemicu menolak UPDATE dan DELETE).
3. `app_user.phone_hash` unik.
4. `game_move (room_id, seq)` unik.
5. `ticket_request (requester_id, target_id, day)` unik.
6. `ticket_bet (least(user_a,user_b), greatest(user_a,user_b), day)` unik.
7. `conversation.kind='direct'` memiliki tepat 2 anggota.
8. `friendship.user_a < friendship.user_b`.

## Penghitungan yang dilakukan di kode, bukan disimpan

- Kelas dari trofi (tabel kelas ada di konfigurasi).
- Sisa waktu room (`expires_at - now()`).
- Batas memberi Tiket mingguan (jumlah `ticket_gift` 7 hari terakhir).
- Daftar "Menunggu saling" (ada `follow` atau `contact_save` tanpa `friendship`).
