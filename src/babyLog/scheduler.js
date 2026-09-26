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
