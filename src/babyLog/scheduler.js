// Baby log scheduler helpers.
// sendScanReminders is called from sakina-bot's existing scheduler at 9pm SGT.
// startDailyJobs is exported for completeness but NOT used — the existing
// Sakina scheduler (src/scheduler.js) owns the timing.

import { Markup } from 'telegraf';
import { currentRowDateStr, hrs } from './format.js';
import { sendMorningBriefs, ageDaysOf, defaultFocus } from './brief.js';

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

  const fmt = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const clockSgt = (ts) => new Date(ts).toLocaleString('en-SG', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore',
  }).toLowerCase().replace(/ /g, '');

  // Brief data is per-baby so we cache across caregivers sharing the same baby
  const briefCache = new Map();

  for (const c of caregivers) {
    try {
      // Feeds from tap with logged_by for shift attribution
      const { data: tapFeeds } = await supabase.from('baby_events')
        .select('start_at, detail, logged_by')
        .eq('baby_id', c.babies.id)
        .eq('kind', 'feed')
        .eq('source', 'tap')
        .gte('start_at', windowStart.toISOString())
        .lt('start_at', windowEnd.toISOString())
        .order('start_at', { ascending: true });

      const feeds = tapFeeds || [];

      // ── Estimate sleep from feed gaps (parents don't log sleep at night) ──
      let totalSleepMs = 0, longestSleepMs = 0, feedWakeUps = 0;
      if (feeds.length >= 2) {
        for (let i = 1; i < feeds.length; i++) {
          const gap = new Date(feeds[i].start_at) - new Date(feeds[i - 1].start_at);
          if (gap > 30 * 60 * 1000) {
            totalSleepMs  += gap;
            if (gap > longestSleepMs) longestSleepMs = gap;
            feedWakeUps++;
          }
        }
        // Tail gap: last feed to window end counts as ongoing sleep
        const tailGap = windowEnd - new Date(feeds[feeds.length - 1].start_at);
        if (tailGap > 30 * 60 * 1000) {
          totalSleepMs += tailGap;
          if (tailGap > longestSleepMs) longestSleepMs = tailGap;
        }
      }

      // Header date: the evening date (9pm side of the window)
      const evDate = new Date(windowStart.getTime() + 8 * 3600 * 1000);
      const dateLabel = evDate.toLocaleDateString('en-SG', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
      });

      const lines = [`🌙 *Overnight — ${dateLabel}*`];

      // ── Sleep summary (estimated) ──────────────────────────────────────────
      if (totalSleepMs > 0) {
        lines.push('');
        lines.push(`😴 Est. sleep: ${fmt(totalSleepMs)}`);
        lines.push(`⏱ Longest stretch: ${fmt(longestSleepMs)}`);
        lines.push(`🍼 Feeds: ${feeds.length} (${feedWakeUps} wake-up${feedWakeUps !== 1 ? 's' : ''})`);
      } else if (feeds.length) {
        lines.push('');
        lines.push(`🍼 Feeds: ${feeds.length}`);
      } else {
        lines.push('', 'No feeds logged during the night.');
      }

      // ── Shift coverage ─────────────────────────────────────────────────────
      if (feeds.length) {
        const loggerIds = [...new Set(feeds.map(f => f.logged_by).filter(Boolean))];
        let loggerNames = {};
        if (loggerIds.length) {
          const { data: users } = await supabase.from('users')
            .select('id, name').in('id', loggerIds);
          for (const u of users || []) {
            loggerNames[u.id] = (u.name || '').split(' ')[0] || `User ${u.id}`;
          }
        }

        const shiftCounts = {};
        for (const f of feeds) {
          if (!f.logged_by) continue;
          const who = loggerNames[f.logged_by] ?? `User ${f.logged_by}`;
          shiftCounts[who] = (shiftCounts[who] || 0) + 1;
        }

        if (Object.keys(shiftCounts).length > 1) {
          lines.push('');
          lines.push('*Who was on:*');
          for (const [name, count] of Object.entries(shiftCounts)) {
            lines.push(`  ${name} — ${count} feed${count !== 1 ? 's' : ''}`);
          }
        }

        // ── Feed list with attribution ──────────────────────────────────────
        lines.push('');
        lines.push('*Night feeds:*');
        for (const f of feeds) {
          const t   = clockSgt(f.start_at);
          const d   = f.detail;
          const who = f.logged_by && loggerNames[f.logged_by] ? ` _(${loggerNames[f.logged_by]})_` : '';
          let fl;
          if (d?.type === 'formula')     fl = `🍶 ${t}${d.amount_ml ? ` · ${d.amount_ml}ml` : ''}`;
          else if (d?.type === 'breast') fl = `🍼 ${t}${d.amount_ml ? ` · ${d.amount_ml}ml` : ''}`;
          else if (d?.type === 'latch')  fl = `🤱 ${t}${d.duration_min ? ` · ${d.duration_min}m` : ''}`;
          else                           fl = `🍼 ${t}`;
          lines.push(fl + who);
        }
      }

      // ── Morning brief (merged) ─────────────────────────────────────────────
      if (!briefCache.has(c.babies.id)) {
        const [yesterday, avg7] = await Promise.all([
          queries.lastCompleteDay(c.babies.id, now),
          queries.averages(c.babies.id, 7),
        ]);
        briefCache.set(c.babies.id, { yesterday, avg7 });
      }
      const { yesterday, avg7 } = briefCache.get(c.babies.id);

      lines.push('', '─────────────────');
      lines.push(`*${c.babies.name}'s yesterday*`);

      if (!yesterday || yesterday.source === 'none') {
        lines.push("No line yet — snap the notebook tonight and I'll catch up.");
      } else {
        lines.push(
          `😴 ${hrs(yesterday.sleep_min)} sleep · night ${hrs(yesterday.night_sleep_min)} · longest ${hrs(yesterday.longest_stretch_min)} · ${yesterday.naps} nap${yesterday.naps === 1 ? '' : 's'}`,
          `🍼 ${yesterday.feeds} feed${yesterday.feeds === 1 ? '' : 's'}${yesterday.wet != null ? ` · 🧷 ${yesterday.wet} wet, ${yesterday.dirty} dirty` : ''}`,
        );
        if (avg7 && avg7.days_with_data >= 3) {
          lines.push('', `Last ${avg7.days_with_data} days: ${hrs(avg7.sleep_min)} sleep avg, ${avg7.feeds} feeds avg.`);
        }
      }

      const focus = defaultFocus(ageDaysOf(c.babies, now));
      if (focus) lines.push('', `Today: ${focus}`);
      if (c.role === 'father') lines.push('', 'Check in on mum: water, food, a proper rest if she can.');

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
