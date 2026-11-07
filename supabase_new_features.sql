-- New features: feedback, feed combos, pump interval setting
-- Run in Supabase SQL editor

-- User feedback
CREATE TABLE IF NOT EXISTS feedback (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    BIGINT       NOT NULL,
  message    TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);

-- Feed combos (Pro only) — saved formula+breast pairs
CREATE TABLE IF NOT EXISTS feed_combos (
  id          BIGSERIAL    PRIMARY KEY,
  baby_id     BIGINT       NOT NULL,
  user_id     BIGINT       NOT NULL,
  name        TEXT         NOT NULL DEFAULT 'My Mix',
  formula_ml  INTEGER      NOT NULL DEFAULT 0,
  breast_ml   INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_combos_baby ON feed_combos (baby_id);

-- Pump reminder interval (stored per user)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pump_interval_hours INTEGER NOT NULL DEFAULT 3;
