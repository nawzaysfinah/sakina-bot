-- Extend baby_days with formula_ml, breast_ml, latch_min per day.
-- Run this once in the Supabase SQL editor.

drop function if exists baby_days(bigint, date, date);
create function baby_days(p_baby bigint, p_from date, p_to date)
returns table (
  row_date date, source text, sleep text,
  sleep_min int, night_sleep_min int, day_sleep_min int,
  naps int, longest_stretch_min int,
  feeds int, feed_cells smallint[], wet int, dirty int,
  formula_ml int, breast_ml int, latch_min int
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
    case when g.source = 'none' then null else g.dirty end,
    -- formula ml for this day
    (select coalesce(sum((detail->>'amount_ml')::numeric), 0)::int
     from baby_events
     where baby_id = p_baby and kind = 'feed' and source = 'tap'
       and detail->>'type' = 'formula' and row_date = g.row_date),
    -- expressed breast milk ml for this day
    (select coalesce(sum((detail->>'amount_ml')::numeric), 0)::int
     from baby_events
     where baby_id = p_baby and kind = 'feed' and source = 'tap'
       and detail->>'type' = 'breast' and row_date = g.row_date),
    -- latch minutes for this day
    (select coalesce(sum((detail->>'duration_min')::numeric), 0)::int
     from baby_events
     where baby_id = p_baby and kind = 'feed' and source = 'tap'
       and detail->>'type' = 'latch' and row_date = g.row_date)
  from baby_grid(p_baby, p_from, p_to) g
$$;
