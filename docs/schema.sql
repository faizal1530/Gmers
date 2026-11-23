-- Gmers: skema PostgreSQL 16. Sumber kebenaran data (lihat docs/02-erd.md).
-- Catatan: entitas USER di diagram bernama app_user di sini.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== Akun =====
CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub    text NOT NULL UNIQUE,
  email         text NOT NULL,
  phone_hash    text UNIQUE,            -- hash nomor HP untuk pencocokan, satu nomor satu akun
  phone_enc     bytea,                  -- nomor terenkripsi, hanya untuk kirim OTP
  phone_verified_at timestamptz,
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 20),
  avatar_id     text NOT NULL DEFAULT 'a1',
  trophies      integer NOT NULL DEFAULT 0 CHECK (trophies >= 0),
  status        text NOT NULL DEFAULT 'siap' CHECK (status IN ('siap','sibuk','senyap','dnd')),
  birth_year    integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  banned_at     timestamptz
);

CREATE TABLE otp_code (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  attempts   integer NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  platform   text NOT NULL CHECK (platform IN ('android','ios')),
  push_token text,
  fingerprint text,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- ===== Keuangan (empat mata uang terpisah) =====
CREATE TABLE wallet (
  user_id      uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  coins        integer NOT NULL DEFAULT 0 CHECK (coins >= 0),
  stars        integer NOT NULL DEFAULT 0 CHECK (stars >= 0),
  tickets      integer NOT NULL DEFAULT 0 CHECK (tickets >= 0),
  win_progress integer NOT NULL DEFAULT 0 CHECK (win_progress BETWEEN 0 AND 19),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entry (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user(id),
  currency   text NOT NULL CHECK (currency IN ('coin','star','ticket')),
  amount     integer NOT NULL CHECK (amount <> 0),
  reason     text NOT NULL,
  ref_id     uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Tiap mata uang hanya boleh punya alasan miliknya. Tidak ada jalur Koin/Rupiah ke Tiket.
  CONSTRAINT ledger_reason_ok CHECK (
    (currency = 'coin'   AND reason IN ('purchase_pack','buy_item','buy_game','refund'))
 OR (currency = 'star'   AND reason IN ('game_done','daily_mission','streak_milestone','buy_freeze','rewarded_ad'))
 OR (currency = 'ticket' AND reason IN ('ranked_wins','gift_in','gift_out','bet_escrow','bet_win','bet_forfeit','tournament_entry'))
  )
);
CREATE INDEX ledger_user_time ON ledger_entry (user_id, created_at DESC);

CREATE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger_entry hanya boleh ditambah'; END $$;
CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

CREATE TABLE coin_pack (
  id        text PRIMARY KEY,
  price_idr integer NOT NULL CHECK (price_idr > 0),
  coins     integer NOT NULL CHECK (coins > 0),
  active    boolean NOT NULL DEFAULT true
);
CREATE TABLE purchase (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user(id),
  pack_id    text NOT NULL REFERENCES coin_pack(id),
  store      text NOT NULL CHECK (store IN ('google','apple')),
  store_txn  text NOT NULL UNIQUE,      -- cegah pembelian ganda
  state      text NOT NULL CHECK (state IN ('pending','verified','refunded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE item (
  id       text PRIMARY KEY,
  kind     text NOT NULL CHECK (kind IN ('avatar','emoji_pack','dice_skin','frame')),
  name     text NOT NULL,
  price_coins integer NOT NULL DEFAULT 0 CHECK (price_coins >= 0),
  active   boolean NOT NULL DEFAULT true
);
CREATE TABLE owned_item (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES item(id),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

-- ===== Hubungan sosial =====
CREATE TABLE follow (
  follower_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE TABLE contact_save (
  saver_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  saved_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (saver_id, saved_id),
  CHECK (saver_id <> saved_id)
);
CREATE TABLE block (
  blocker_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
-- Turunan dari follow/contact_save. Jangan diisi manual; pakai recompute_friendship().
CREATE TABLE friendship (
  user_a uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  basis  text NOT NULL CHECK (basis IN ('follow','contact')),
  since  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE FUNCTION recompute_friendship(p uuid, q uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a uuid := LEAST(p,q); b uuid := GREATEST(p,q); mf boolean; mk boolean; blocked boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM block WHERE (blocker_id=p AND blocked_id=q) OR (blocker_id=q AND blocked_id=p)) INTO blocked;
  SELECT EXISTS(SELECT 1 FROM follow WHERE follower_id=p AND followee_id=q)
     AND EXISTS(SELECT 1 FROM follow WHERE follower_id=q AND followee_id=p) INTO mf;
  SELECT EXISTS(SELECT 1 FROM contact_save WHERE saver_id=p AND saved_id=q)
     AND EXISTS(SELECT 1 FROM contact_save WHERE saver_id=q AND saved_id=p) INTO mk;
  IF blocked OR NOT (mf OR mk) THEN
    DELETE FROM friendship WHERE user_a=a AND user_b=b;
  ELSE
    INSERT INTO friendship(user_a,user_b,basis) VALUES (a,b,CASE WHEN mf THEN 'follow' ELSE 'contact' END)
    ON CONFLICT (user_a,user_b) DO UPDATE SET basis = EXCLUDED.basis;
  END IF;
END $$;

CREATE TABLE streak (
  user_a uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  count integer NOT NULL DEFAULT 0,
  last_day date,
  freezes integer NOT NULL DEFAULT 0 CHECK (freezes BETWEEN 0 AND 2),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

-- ===== Chat =====
CREATE TABLE conversation (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind  text NOT NULL CHECK (kind IN ('direct','group','room')),
  title text,
  created_by uuid REFERENCES app_user(id),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,                -- hanya untuk kind='room'
  CHECK ((kind='room') = (expires_at IS NOT NULL))
);
CREATE TABLE conversation_member (
  conversation_id uuid NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  last_read_message_id uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES app_user(id),
  kind text NOT NULL CHECK (kind IN ('text','emoji','invite','ticket','system','image')),
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX message_conv_time ON message (conversation_id, created_at DESC);

-- ===== Game =====
CREATE TABLE game (
  id text PRIMARY KEY,                   -- 'ludo','remi','gaple',...
  name text NOT NULL,
  min_players integer NOT NULL DEFAULT 2,
  max_players integer NOT NULL DEFAULT 4,
  premium boolean NOT NULL DEFAULT false,
  price_coins integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE game_ownership (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  game_id text NOT NULL REFERENCES game(id),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE community (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  game_id text REFERENCES game(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_member (
  community_id uuid NOT NULL REFERENCES community(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','mod','owner')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE room (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL REFERENCES game(id),
  conversation_id uuid REFERENCES conversation(id) ON DELETE SET NULL,
  community_id uuid REFERENCES community(id) ON DELETE SET NULL,
  host_id uuid REFERENCES app_user(id),
  state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','playing','finished','cancelled')),
  ranked boolean NOT NULL DEFAULT false,
  live boolean NOT NULL DEFAULT true,
  random_match boolean NOT NULL DEFAULT false,   -- true => wajib lewat TURN
  turn_deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT ranked OR live)             -- Ranked hanya live
);
CREATE TABLE room_player (
  room_id uuid NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  seat smallint NOT NULL CHECK (seat BETWEEN 0 AND 3),
  voice_mode text NOT NULL DEFAULT 'suara' CHECK (voice_mode IN ('suara','chat','senyap')),
  connected boolean NOT NULL DEFAULT true,
  PRIMARY KEY (room_id, user_id),
  UNIQUE (room_id, seat)
);
CREATE TABLE game_move (
  room_id uuid NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  seat smallint NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, seq)
);
CREATE TABLE game_result (
  room_id uuid PRIMARY KEY REFERENCES room(id) ON DELETE CASCADE,
  end_reason text NOT NULL CHECK (end_reason IN ('finished','blocked','forfeit','timeout')),
  ended_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE result_player (
  room_id uuid NOT NULL REFERENCES game_result(room_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  rank smallint NOT NULL CHECK (rank BETWEEN 1 AND 4),
  trophy_delta integer NOT NULL DEFAULT 0,
  stars_earned integer NOT NULL DEFAULT 0,
  counted_for_ticket boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE game_invite (
  message_id uuid PRIMARY KEY REFERENCES message(id) ON DELETE CASCADE,
  game_id text NOT NULL REFERENCES game(id),
  mode text NOT NULL CHECK (mode IN ('suara','chat','senyap')),
  live boolean NOT NULL,
  ranked boolean NOT NULL DEFAULT false,
  bet_ticket boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','held','joined','later','busy','expired','cancelled')),
  room_id uuid REFERENCES room(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  CHECK (NOT ranked OR live),
  CHECK (NOT bet_ticket OR live)
);

-- ===== Tiket =====
CREATE TABLE ticket_request (
  message_id uuid PRIMARY KEY REFERENCES message(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES app_user(id),
  target_id uuid NOT NULL REFERENCES app_user(id),
  day date NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','given','declined')),
  UNIQUE (requester_id, target_id, day)       -- satu permintaan per teman per hari
);
CREATE TABLE ticket_gift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giver_id uuid NOT NULL REFERENCES app_user(id),
  receiver_id uuid NOT NULL REFERENCES app_user(id),
  request_message_id uuid REFERENCES ticket_request(message_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (giver_id <> receiver_id)
);
CREATE INDEX ticket_gift_giver_time ON ticket_gift (giver_id, created_at DESC); -- batas 10 per minggu
CREATE TABLE ticket_bet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES room(id),
  user_a uuid NOT NULL REFERENCES app_user(id),
  user_b uuid NOT NULL REFERENCES app_user(id),
  day date NOT NULL,
  state text NOT NULL DEFAULT 'escrowed' CHECK (state IN ('escrowed','settled','cancelled')),
  winner_id uuid REFERENCES app_user(id),
  CHECK (user_a < user_b)
);
CREATE UNIQUE INDEX ticket_bet_pair_day ON ticket_bet (user_a, user_b, day);

-- ===== Komunitas dan iklan =====
CREATE TABLE post (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid REFERENCES community(id) ON DELETE SET NULL,
  author_id uuid NOT NULL REFERENCES app_user(id),
  kind text NOT NULL DEFAULT 'post' CHECK (kind IN ('post','intro')),
  body text NOT NULL CHECK (char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX post_time ON post (created_at DESC);
CREATE TABLE post_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image','video')),
  url text NOT NULL,
  duration_s integer,
  moderation text NOT NULL DEFAULT 'pending' CHECK (moderation IN ('pending','ok','rejected'))
);
CREATE TABLE post_reply (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES app_user(id),
  body text NOT NULL CHECK (char_length(body) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE post_reaction (
  post_id uuid NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('like','save')),
  PRIMARY KEY (post_id, user_id, kind)
);
CREATE TABLE ad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser text NOT NULL,
  title text NOT NULL,
  body text,
  image_url text,
  category text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CHECK (category NOT IN ('judi','taruhan'))
);
CREATE TABLE ad_impression (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid NOT NULL REFERENCES ad(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  placement text NOT NULL CHECK (placement IN ('feed','live')),   -- tidak pernah 'chat' atau 'game'
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== Keselamatan dan notifikasi =====
CREATE TABLE report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES app_user(id),
  target_kind text NOT NULL CHECK (target_kind IN ('user','post','message','room')),
  target_id uuid NOT NULL,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','reviewed','actioned','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
