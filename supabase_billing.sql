-- Billing layer: plan column on users + payments audit log
-- Run in Supabase SQL editor

-- Add plan fields to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan            TEXT    NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;

-- Index for fast entitlement checks
CREATE INDEX IF NOT EXISTS idx_users_plan ON users (plan);

-- Payments audit log (idempotent — keyed on Telegram's charge ID)
CREATE TABLE IF NOT EXISTS payments (
  id                        BIGSERIAL    PRIMARY KEY,
  user_id                   BIGINT       NOT NULL REFERENCES users (id),
  telegram_payment_charge_id TEXT        NOT NULL UNIQUE,
  currency                  TEXT         NOT NULL,          -- 'XTR' for Stars
  total_amount              INTEGER      NOT NULL,          -- Stars count
  invoice_payload           TEXT,                           -- e.g. 'pro_monthly'
  plan_granted              TEXT,                           -- 'pro'
  plan_expires_at           TIMESTAMPTZ,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id);
