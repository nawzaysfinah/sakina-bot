-- Run this in Supabase SQL Editor to add reminders support

create table if not exists reminders (
  id         uuid primary key default gen_random_uuid(),
  user_id    bigint references users(id) on delete cascade,
  text       text not null,
  remind_on  date not null,
  done       boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_reminders_user_date
  on reminders(user_id, remind_on)
  where done = false;
