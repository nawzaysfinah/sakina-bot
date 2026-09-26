-- Sakina baby log: adapted migration for Option A (no separate babies table).
-- The "baby ID" is the primary caregiver's Telegram user ID (bigint).
-- Run both blocks in order in the Supabase SQL editor.
--
-- ── BLOCK 1: extend the users table ──────────────────────────────────────────

alter table users
  add column if not exists baby_name     text,
  add column if not exists baby_role     text not null default 'mother',
  add column if not exists baby_join_code text unique;

-- ── BLOCK 2: paper-log tables (baby_id = telegram user id, bigint) ───────────

create extension if not exists pgcrypto;

-- One scan attempt per chat: photos collected → read → saved or discarded.
-- File IDs are cleared once the scan closes (photos stay in the Telegram chat).
create table if not exists paper_scans (
  id            bigint generated always as identity primary key,
  baby_id       bigint not null,               -- users.id of primary caregiver
  chat_id       bigint not null,
  month         date not null,                 -- first day of the month on the spread
  file_ids      text[] not null default '{}',
  status        text not null default 'collecting'
                check (status in ('collecting', 'review', 'saved', 'discarded')),
  result        jsonb,
  skipped_rows  int[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists paper_scans_open on paper_scans (chat_id, status, updated_at desc);

-- Confirmed notebook rows, one per day.
-- sleep: 48 chars, 'S' asleep / '.' awake, starting 7pm the evening before.
create table if not exists paper_rows (
  baby_id       bigint not null,
  row_date      date not null,
  sleep         text not null check (sleep ~ '^[S.]{48}$'),
  feeds         smallint[] not null default '{}',
  wet           smallint,
  dirty         smallint,
  uncertain     smallint[] not null default '{}',
  scan_id       bigint references paper_scans(id) on delete set null,
  confirmed_by  bigint,
  confirmed_at  timestamptz not null default now(),
  primary key (baby_id, row_date)
);

-- Events from any source. Paper events are rebuilt on each scan save;
-- tap events come from /log quick-logging.
create table if not exists baby_events (
  id             bigint generated always as identity primary key,
  baby_id        bigint not null,
  kind           text not null check (kind in ('sleep', 'feed', 'diaper', 'note')),
  start_at       timestamptz not null,
  end_at         timestamptz,
  source         text not null check (source in ('paper', 'tap')),
  row_date       date,
  logged_by      bigint,
  precision_min  smallint,
  detail         jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists baby_events_time  on baby_events (baby_id, start_at);
create index if not exists baby_events_paper on baby_events (baby_id, source, row_date);

-- At most one open (ongoing) tap sleep per baby.
create unique index if not exists baby_events_one_open_sleep
  on baby_events (baby_id) where kind = 'sleep' and source = 'tap' and end_at is null;

-- Job dedup table: each (job, key) pair is claimed at most once.
create table if not exists job_runs (
  job      text not null,
  run_key  text not null,
  ran_at   timestamptz not null default now(),
  primary key (job, run_key)
);

-- ── BLOCK 3: functions & views ────────────────────────────────────────────────

-- The notebook line a moment belongs to (7pm boundary, Singapore time).
create or replace function sgt_row_date(ts timestamptz)
returns date language sql immutable parallel safe as $$
  select ((ts at time zone 'Asia/Singapore') + interval '5 hours')::date
$$;

-- 7pm on the evening before d, as timestamptz.
create or replace function sgt_row_start(d date)
returns timestamptz language sql immutable parallel safe as $$
  select ((d - 1)::timestamp + time '19:00') at time zone 'Asia/Singapore'
$$;

-- Atomic photo append (album photos arrive concurrently).
create or replace function paper_scan_add_photo(p_scan_id bigint, p_file_id text)
returns paper_scans language sql as $$
  update paper_scans
     set file_ids   = (array_append(file_ids, p_file_id))[greatest(array_length(file_ids,1),1):],
         updated_at = now()
   where id = p_scan_id
  returning *;
$$;

-- Auto-fill row_date on tap events.
create or replace function baby_events_fill_row_date()
returns trigger language plpgsql as $$
begin
  if new.row_date is null then
    new.row_date := sgt_row_date(new.start_at);
  end if;
  return new;
end $$;

drop trigger if exists baby_events_row_date on baby_events;
create trigger baby_events_row_date
  before insert or update of start_at on baby_events
  for each row execute function baby_events_fill_row_date();

-- Paper wins for any day that has a confirmed notebook row.
create or replace view baby_events_effective with (security_invoker = true) as
select e.*
from baby_events e
where e.source = 'paper'
   or not exists (
       select 1 from paper_rows p
        where p.baby_id = e.baby_id and p.row_date = e.row_date
   );

-- One row per notebook line, in 48-cell form. Source: paper | tap | none.
drop function if exists baby_grid(bigint, date, date);
create function baby_grid(p_baby bigint, p_from date, p_to date)
returns table (row_date date, source text, sleep text, feeds smallint[], wet int, dirty int)
language sql stable as $$
  with days as (
    select d::date as row_date
    from generate_series(p_from, p_to, interval '1 day') d
  ),
  tap as (
    select e.*, coalesce(e.end_at, now()) as end_eff
    from baby_events e
    where e.baby_id = p_baby and e.source = 'tap'
      and e.row_date between p_from - 1 and p_to
  )
  select
    d.row_date,
    case when p.row_date is not null then 'paper'
         when exists (
           select 1 from tap t
           where t.row_date = d.row_date
              or (t.kind = 'sleep'
                  and t.start_at < sgt_row_start(d.row_date + 1)
                  and t.end_eff  > sgt_row_start(d.row_date))
         ) then 'tap'
         else 'none' end,
    coalesce(p.sleep, (
      select string_agg(
        case when exists (
          select 1 from tap t
          where t.kind = 'sleep'
            and t.start_at <= sgt_row_start(d.row_date) + (i * 30 + 15) * interval '1 minute'
            and t.end_eff  >  sgt_row_start(d.row_date) + (i * 30 + 15) * interval '1 minute'
        ) then 'S' else '.' end, '' order by i)
      from generate_series(0, 47) i
    )),
    coalesce(p.feeds, (
      select coalesce(
        array_agg(distinct
          floor(extract(epoch from t.start_at - sgt_row_start(d.row_date)) / 1800)::smallint
        ), '{}'
      )
      from tap t where t.kind = 'feed' and t.row_date = d.row_date
    )),
    case when p.row_date is not null then p.wet
         else (
           select count(*) filter (where (t.detail->>'wet')::boolean)
           from tap t where t.kind = 'diaper' and t.row_date = d.row_date
         )::int end,
    case when p.row_date is not null then p.dirty
         else (
           select count(*) filter (where (t.detail->>'dirty')::boolean)
           from tap t where t.kind = 'diaper' and t.row_date = d.row_date
         )::int end
  from days d
  left join paper_rows p on p.baby_id = p_baby and p.row_date = d.row_date
  order by d.row_date
$$;

-- Per-day stats.
drop function if exists baby_days(bigint, date, date);
create function baby_days(p_baby bigint, p_from date, p_to date)
returns table (
  row_date date, source text, sleep text,
  sleep_min int, night_sleep_min int, day_sleep_min int,
  naps int, longest_stretch_min int,
  feeds int, feed_cells smallint[], wet int, dirty int
)
language sql stable as $$
  select
    g.row_date, g.source, g.sleep,
    (length(g.sleep) - length(replace(g.sleep, 'S', ''))) * 30,
    (24 - length(replace(substr(g.sleep, 1, 24), 'S', ''))) * 30,
    (24 - length(replace(substr(g.sleep, 25, 24), 'S', ''))) * 30,
    (select count(*) from regexp_matches(substr(g.sleep, 25, 24), 'S+', 'g'))::int,
    coalesce(
      (select max(length(m[1])) from regexp_matches(g.sleep, '(S+)', 'g') m), 0
    ) * 30,
    coalesce(cardinality(g.feeds), 0),
    g.feeds,
    case when g.source = 'none' then null else g.wet end,
    case when g.source = 'none' then null else g.dirty end
  from baby_grid(p_baby, p_from, p_to) g
$$;

-- Averages over the last p_days complete lines.
create or replace function baby_averages(p_baby bigint, p_days int)
returns jsonb language sql stable as $$
  with d as (
    select * from baby_days(p_baby, sgt_row_date(now()) - p_days, sgt_row_date(now()) - 1)
    where source <> 'none'
  )
  select jsonb_build_object(
    'days',                p_days,
    'days_with_data',      count(*),
    'sleep_min',           round(avg(sleep_min)),
    'night_sleep_min',     round(avg(night_sleep_min)),
    'longest_stretch_min', round(avg(longest_stretch_min)),
    'naps',                round(avg(naps), 1),
    'feeds',               round(avg(feeds), 1),
    'wet',                 round(avg(wet), 1),
    'dirty',               round(avg(dirty), 1)
  ) from d
$$;

-- Right-now status.
create or replace function baby_status(p_baby bigint)
returns jsonb language sql stable as $$
  with e as (select * from baby_events_effective where baby_id = p_baby)
  select jsonb_build_object(
    'now',              now(),
    'current_row_date', sgt_row_date(now()),
    'last_paper_row',   (select max(row_date) from paper_rows where baby_id = p_baby),
    'last_feed', (
      select to_jsonb(x) from (
        select start_at, source from e where kind = 'feed'
        order by start_at desc limit 1
      ) x
    ),
    'last_diaper', (
      select to_jsonb(x) from (
        select start_at, source, detail from e where kind = 'diaper'
        order by start_at desc limit 1
      ) x
    ),
    'sleep', (
      select to_jsonb(x) from (
        select start_at, end_at, source, (end_at is null) as ongoing
        from e where kind = 'sleep' order by start_at desc limit 1
      ) x
    )
  )
$$;

-- Job dedup: returns true exactly once per (job, key).
create or replace function claim_job(p_job text, p_key text)
returns boolean language sql as $$
  with ins as (
    insert into job_runs (job, run_key) values (p_job, p_key)
    on conflict do nothing returning 1
  )
  select exists (select 1 from ins)
$$;

-- ── BLOCK 4: RLS (service-role key bypasses this; protects anon access) ───────

alter table paper_scans  enable row level security;
alter table paper_rows   enable row level security;
alter table baby_events  enable row level security;
alter table job_runs     enable row level security;
