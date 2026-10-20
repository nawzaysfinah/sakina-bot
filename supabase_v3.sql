-- ══════════════════════════════════════════════════════════════════════════════
-- Sakina Bot — Schema Migration v3
-- Run this in Supabase SQL Editor AFTER supabase_schema.sql + supabase_reminders.sql
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Extend users table ──────────────────────────────────────────────────────

alter table users
  add column if not exists delivery_type   text    default 'vaginal',   -- 'vaginal' | 'cesarean'
  add column if not exists streak_days     int     default 0,
  add column if not exists last_active_date date,
  add column if not exists tumbuh_week_id  text;                         -- null = auto by baby age

-- ── 2. Health logs — feeding, weight, nappy ────────────────────────────────────

create table if not exists health_logs (
  id         uuid       primary key default gen_random_uuid(),
  user_id    bigint     references users(id) on delete cascade,
  log_type   text       not null,   -- 'feed_breast' | 'feed_bottle' | 'weight' | 'nappy_wet' | 'nappy_dirty'
  value      numeric,               -- duration (min), weight (kg), or count
  unit       text,                  -- 'min', 'ml', 'kg', 'g'
  note       text,
  side       text,                  -- 'left' | 'right' | 'both' (breastfeeding)
  logged_at  timestamptz default now()
);

create index if not exists idx_health_logs_user_type
  on health_logs(user_id, log_type, logged_at desc);

-- ── 3. EPDS screening sessions ────────────────────────────────────────────────

create table if not exists epds_sessions (
  id               uuid    primary key default gen_random_uuid(),
  user_id          bigint  references users(id) on delete cascade,
  day_marker       int     not null,              -- 7, 14, or 30
  current_question int     default 1,             -- 1-10, 11 = complete
  responses        jsonb   default '{}',          -- {"1": 0, "2": 1, ...}
  score            int,                           -- filled on completion
  started_at       timestamptz default now(),
  completed_at     timestamptz,
  unique(user_id, day_marker)                     -- one session per milestone
);

-- ── 4. Milestone completions for Tumbuh phase gating ─────────────────────────

create table if not exists milestone_completions (
  id           uuid    primary key default gen_random_uuid(),
  user_id      bigint  references users(id) on delete cascade,
  week_id      text    not null,   -- 'w1', 'w2-3', 'm4', etc.
  tasks_done   int     default 0,
  tasks_total  int     default 0,
  unlocked_at  timestamptz default now(),
  unique(user_id, week_id)
);

-- ── 5. Share tokens — partner/doula read access ───────────────────────────────

create table if not exists share_tokens (
  token          text    primary key,
  owner_user_id  bigint  references users(id) on delete cascade,
  created_at     timestamptz default now(),
  expires_at     timestamptz default (now() + interval '30 days')
);

create index if not exists idx_share_tokens_owner
  on share_tokens(owner_user_id);

-- ── 6. Vaccination schedule reference ────────────────────────────────────────

-- No table needed — computed from baby_dob in code.
-- Stored reminders go into the existing reminders table.

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Summary of new columns + tables:
--   users.delivery_type        — 'vaginal' | 'cesarean'
--   users.streak_days          — consecutive days with ≥1 task done
--   users.last_active_date     — date of last task completion
--   users.tumbuh_week_id       — override for milestone-gated Tumbuh
--   health_logs                — feeding, weight, nappy tracking
--   epds_sessions              — Edinburgh Postnatal Depression Scale state
--   milestone_completions      — Tumbuh phase unlock tracking
--   share_tokens               — partner/doula read access
