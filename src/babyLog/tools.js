// Gemini function-calling tools for baby log questions.
// Sakina uses a direct REST call to Gemini (no SDK), so BABY_TOOLS are plain
// JSON Schema declarations passed in the REST body's tools array.

import { clock, statusLine, hrs, addDays } from './format.js';

export const BABY_TOOLS = [
  {
    name: 'get_baby_status',
    description: 'Right-now status of the baby from the log: last feed, whether asleep or awake and for how long, last diaper. Use for "when did baby last feed/sleep/poop" questions.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_daily_log',
    description: 'Per-day totals from the log for a date range. Each day is a notebook line from 7pm the evening before to 7pm on that date (Singapore time). Returns sleep minutes (total, night 7pm-7am, day), naps, longest stretch, feeds, wet and dirty diapers, and whether the day came from the paper notebook or quick taps.',
    parameters: {
      type: 'object',
      properties: {
        from_date: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
        to_date: { type: 'string', description: 'YYYY-MM-DD, inclusive. At most 31 days are returned (the most recent ones).' },
      },
      required: ['from_date', 'to_date'],
    },
  },
  {
    name: 'get_averages',
    description: 'Average per day over the last N complete days (today is excluded because it is still being written).',
    parameters: {
      type: 'object',
      properties: { days: { type: 'integer', enum: [3, 7, 14, 30] } },
      required: ['days'],
    },
  },
];

export const BABY_TOOLS_PROMPT = `You can read this family's baby log with tools. For any question about logged sleep, feeds or diapers, call a tool; never estimate from memory.
Times are Singapore time. A "day" in the log runs 7pm the evening before to 7pm.
Describe patterns plainly and warmly, without judging the parents or scoring the day.
Do not diagnose. If a question is about health (fewer wet diapers, feeding refusal, fever, unusual sleepiness), share what the log shows and suggest contacting their doctor or polyclinic; for anything urgent, the nearest A&E.`;

const round = (min) => (min == null ? null : hrs(Math.round(min)));

export async function runBabyTool(name, args, { queries, babyId, now = new Date() }) {
  if (name === 'get_baby_status') {
    const st = await queries.status(babyId);
    return {
      now: clock(now),
      summary: statusLine(st, now),
      last_feed_at: st.last_feed ? clock(st.last_feed.start_at) : null,
      asleep: Boolean(st.sleep?.ongoing),
      notebook_scanned_up_to: st.last_paper_row,
    };
  }
  if (name === 'get_daily_log') {
    let { from_date: from, to_date: to } = args;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
      return { error: 'Dates must be YYYY-MM-DD' };
    }
    if (to > addDays(from, 30)) from = addDays(to, -30);
    const rows = await queries.days(babyId, from, to);
    return rows.map((r) => ({
      date: r.row_date,
      source: r.source,
      sleep: r.source === 'none' ? null : round(r.sleep_min),
      night_sleep: r.source === 'none' ? null : round(r.night_sleep_min),
      longest_stretch: r.source === 'none' ? null : round(r.longest_stretch_min),
      naps: r.source === 'none' ? null : r.naps,
      feeds: r.source === 'none' ? null : r.feeds,
      wet: r.wet,
      dirty: r.dirty,
    }));
  }
  if (name === 'get_averages') {
    const a = await queries.averages(babyId, args.days || 7);
    return {
      days_with_data: a.days_with_data,
      sleep: round(a.sleep_min),
      night_sleep: round(a.night_sleep_min),
      longest_stretch: round(a.longest_stretch_min),
      naps: a.naps, feeds: a.feeds, wet: a.wet, dirty: a.dirty,
    };
  }
  return { error: `Unknown tool ${name}` };
}
