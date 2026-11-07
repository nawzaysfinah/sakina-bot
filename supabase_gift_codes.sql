-- Gift codes table — run in Supabase SQL editor
CREATE TABLE IF NOT EXISTS gift_codes (
  id          BIGSERIAL    PRIMARY KEY,
  code        TEXT         NOT NULL UNIQUE,
  plan        TEXT         NOT NULL DEFAULT 'pro',
  days        INTEGER      NOT NULL DEFAULT 30,
  created_by  BIGINT,
  claimed_by  BIGINT       REFERENCES users (id),
  claimed_at  TIMESTAMPTZ,
  code_expires_at TIMESTAMPTZ,          -- when the code itself expires (NULL = no expiry)
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_codes_code ON gift_codes (code);
