// Baby log scheduler helpers.
// sendScanReminders is called from sakina-bot's existing scheduler at 9pm SGT.
// startDailyJobs is exported for completeness but NOT used — the existing
// Sakina scheduler (src/scheduler.js) owns the timing.

import { Markup } from 'telegraf';
import { currentRowDateStr } from './format.js';
import { sendMorningBriefs } from './brief.js';

export async function sendScanReminders(bot, supabase, queries) {
  // The line that just finished is "today" in the notebook (7pm boundary).
  // At 9pm we look at today's line date (still 3 hours ago the 7pm boundary).
  const lineDate = currentRowDateStr(new Date(Date.now() - 3 * 3600e3));
  const caregivers = await queries.allCaregivers();
  const { data: done } = await supabase.from('paper_rows').select('baby_id').eq('row_date', lineDate);
  const scanned = new Set((done || []).map((r) => r.baby_id));
  for (const c of caregivers) {
    if (scanned.has(c.babies.id)) continue;
    try {
      await bot.telegram.sendMessage(
        c.telegram_user_id,
        `🌙 Time to snap today's page for ${c.babies.name}.`,
        Markup.inlineKeyboard([Markup.button.callback('📷 Scan the notebook', 'pl:start')]));
    } catch (e) {
      console.error('scan reminder failed for', c.telegram_user_id, e.description || e.message);
    }
  }
}

// ── Overnight sleep report — sent at 7am SGT ─────────────────────────────────

export async function sendOvernightReport(bot, supabase, queries) {
  const caregivers = await queries.allCaregivers();
  const now        = new Date(); // ~7am SGT when cron fires

  // 9pm SGT yesterday to 7am SGT today = 10-hour window ending now
  const windowEnd   = new Date(now.getTime());
  const windowStart = new Date(now.getTime() - 10 * 3600 * 1000);

  for (const c of caregivers) {
    try {
      const { data: events } = await supabase.from('baby_events_effective')
        .select('kind, start_at, end_at, detail')
        .eq('baby_id', c.babies.id)
        .gte('start_at', windowStart.toISOString())
        .lt('start_at', windowEnd.toISOString())
        .order('start_at', { ascending: true });

      const sleeps = (events || []).filter(e => e.kind === 'sleep');
      const feeds  = (events || []).filter(e => e.kind === 'feed');

      // Header date: the evening date (9pm side of the window)
      const evDate = new Date(windowStart.getTime() + 8 * 3600 * 1000);
      const dateLabel = evDate.toLocaleDateString('en-SG', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
      });

      if (!sleeps.length && !feeds.length) {
        await bot.telegram.sendMessage(
          c.telegram_user_id,
          `🌙 *Overnight — ${dateLabel}*\n\nNo events recorded during the night.`,
          { parse_mode: 'Markdown' },
        );
        continue;
      }

      const lines = [`🌙 *Overnight — ${dateLabel}*`];

      if (sleeps.length) {
        let totalMs = 0, longestMs = 0, wakeUps = 0;
        for (const s of sleeps) {
          const endAt = s.end_at ? new Date(s.end_at) : windowEnd;
          const dur   = Math.max(0, endAt - new Date(s.start_at));
          totalMs   += dur;
          if (dur > longestMs) longestMs = dur;
          if (s.end_at) wakeUps++;
        }
        const fmt = (ms) => {
          const h = Math.floor(ms / 3600000);
          const m = Math.round((ms % 3600000) / 60000);
          return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };
        lines.push('');
        lines.push(`😴 Total sleep: ${fmt(totalMs)}`);
        lines.push(`⏱ Longest stretch: ${fmt(longestMs)}`);
        lines.push(`☀️ Wake-ups: ${wakeUps}`);
      }

      if (feeds.length) {
        lines.push('');
        lines.push('*Night feeds:*');
        for (const f of feeds) {
          const t  = new Date(f.start_at).toLocaleString('en-SG', {
            hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore',
          }).toLowerCase().replace(/ /g, '');
          const d  = f.detail;
          let fl;
          if (d?.type === 'formula')     fl = `🍶 ${t}${d.amount_ml ? ` · ${d.amount_ml}ml` : ''}`;
          else if (d?.type === 'breast') fl = `🍼 ${t}${d.amount_ml ? ` · ${d.amount_ml}ml` : ''}`;
          else if (d?.type === 'latch')  fl = `🤱 ${t}${d.duration_min ? ` · ${d.duration_min}m` : ''}`;
          else                           fl = `🍼 ${t}`;
          lines.push(fl);
        }
      }

      await bot.telegram.sendMessage(c.telegram_user_id, lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('overnight report failed for', c.telegram_user_id, e.description || e.message);
    }
  }
}

// ── Newborn feed alerts — called from hourlyCheck every hour ─────────────────

export async function checkNewbornFeedAlerts(bot, supabase, queries) {
  const now        = new Date();
  const caregivers = await queries.allCaregivers();

  for (const c of caregivers) {
    try {
      const { birth_date: birthDate } = c.babies;
      if (!birthDate) continue;

      const ageDays = (now - new Date(birthDate)) / 86400000;
      if (ageDays > 14 || ageDays < 0) continue; // outside newborn window

      const st = await queries.status(c.babies.id);
      const sinceLastFeed = st?.last_feed
        ? now - new Date(st.last_feed.start_at)
        : null; // null = no feed logged yet (new user, skip silently)

      if (sinceLastFeed === null || sinceLastFeed <= 3.5 * 3600 * 1000) continue;

      // At-most-one alert per caregiver per SGT hour slot
      const sgNow  = new Date(now.getTime() + 8 * 3600 * 1000);
      const sgDate = sgNow.toISOString().slice(0, 10);
      const sgHour = sgNow.getUTCHours();
      if (!(await queries.claimJob('newborn_feed_alert', `${c.telegram_user_id}_${sgDate}_${sgHour}`))) continue;

      const h   = Math.floor(sinceLastFeed / 3600000);
      const m   = Math.floor((sinceLastFeed % 3600000) / 60000);
      const ago = `${h}h ${m}m ago`;
      const day = Math.floor(ageDays) + 1;

      await bot.telegram.sendMessage(
        c.telegram_user_id,
        `⚠️ *${c.babies.name} was last fed ${ago}*\n\n_Day ${day} newborns need feeding every 2–4h — even when asleep._\n\nTap /log to record the feed.`,
        { parse_mode: 'Markdown' },
      );
    } catch (e) {
      console.error('newborn feed alert failed for', c.telegram_user_id, e.description || e.message);
    }
  }
}

// Not called in sakina-bot — kept for reference and standalone use only.
export function startDailyJobs(bot, supabase, queries, {
  reminderAt = '21:00',
  focusFor,
  enabled = { reminder: true, brief: false },
} = {}) {
  const [rH, rM] = reminderAt.split(':').map(Number);
  const reminderMin = rH * 60 + rM;
  const CATCH_UP = 45;

  async function tick() {
    const now = new Date();
    const sg = new Date(now.getTime() + 8 * 3600e3);
    const nowMin = sg.getUTCHours() * 60 + sg.getUTCMinutes();
    const today = sg.toISOString().slice(0, 10);
    if (enabled.reminder && nowMin >= reminderMin && nowMin <= reminderMin + CATCH_UP) {
      if (await queries.claimJob('scan_reminder', today)) {
        await sendScanReminders(bot, supabase, queries).catch((e) => console.error('scan_reminder failed', e));
      }
    }
    if (enabled.brief) {
      if (await queries.claimJob('baby_brief', today)) {
        await sendMorningBriefs(bot, queries, { focusFor }).catch((e) => console.error('baby_brief failed', e));
      }
    }
  }

  tick();
  return setInterval(tick, 30 * 1000);
}
