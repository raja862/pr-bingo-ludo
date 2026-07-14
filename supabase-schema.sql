-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- 1. Create the rooms table
CREATE TABLE IF NOT EXISTS rooms (
  code       TEXT PRIMARY KEY,
  host       TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 5,
  player_count INTEGER NOT NULL DEFAULT 2,
  status     TEXT NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMPTZ DEFAULT now(),
  numbers    JSONB NOT NULL DEFAULT '[]',
  current_turn INTEGER NOT NULL DEFAULT 1,
  callers    JSONB NOT NULL DEFAULT '{}',
  calls      JSONB NOT NULL DEFAULT '[]',
  players    JSONB NOT NULL DEFAULT '{}',
  turn_deadline TIMESTAMPTZ DEFAULT NULL,
  game_type TEXT NOT NULL DEFAULT 'bingo'
);

-- 1b. Add turn timer deadline column (run if upgrading existing schema)
-- ALTER TABLE rooms ADD COLUMN turn_deadline TIMESTAMPTZ DEFAULT NULL;

-- 1c. Add game_type column (run if upgrading existing schema)
-- ALTER TABLE rooms ADD COLUMN game_type TEXT NOT NULL DEFAULT 'bingo';

-- 2. Disable RLS so anonymous clients can read/write (fine for a game)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to rooms"
  ON rooms FOR ALL
  USING (true)
  WITH CHECK (true);

-- 3. Enable Realtime for the rooms table
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
