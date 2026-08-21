-- Run this in your Supabase SQL editor

create table if not exists users (
  id          bigint primary key,           -- telegram user id
  chat_id     bigint not null,
  name        text,
  timezone    text    default 'Asia/Singapore',
  mode        text    default 'recover',    -- 'prepare' | 'recover' | 'tumbuh'
  due_date    date,                         -- prepare mode: expected delivery date
  baby_dob    date,                         -- recover + tumbuh: baby's date of birth
  onboarding  text    default 'start',      -- onboarding step tracker
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists task_completions (
  id           uuid primary key default gen_random_uuid(),
  user_id      bigint references users(id) on delete cascade,
  task_id      text not null,               -- e.g. 'w1-m1', 'w32-wknd-1', 'd7'
  mode         text not null,               -- 'prepare' | 'recover' | 'tumbuh'
  completed_at timestamptz default now()
);

-- Index for fast daily lookups
create index if not exists idx_completions_user_mode
  on task_completions(user_id, mode, task_id);

-- Prevent duplicate completions per day
create unique index if not exists idx_completions_unique
  on task_completions(user_id, task_id, mode);
