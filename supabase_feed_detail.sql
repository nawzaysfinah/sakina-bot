-- Feed detail: expose detail column in baby_status for tap-logged feeds.
-- Run in Supabase SQL editor after supabase_baby_log.sql.
-- No table changes needed — baby_events.detail (jsonb) already exists.

create or replace function baby_status(p_baby bigint)
returns jsonb language sql stable as $$
  with e as (select * from baby_events_effective where baby_id = p_baby)
  select jsonb_build_object(
    'now',              now(),
    'current_row_date', sgt_row_date(now()),
    'last_paper_row',   (select max(row_date) from paper_rows where baby_id = p_baby),
    'last_feed', (
      select to_jsonb(x) from (
        select start_at, source, detail from e where kind = 'feed'
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
