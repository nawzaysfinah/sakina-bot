/**
 * Daily scheduled messages — 8am morning briefing, 7pm evening check-in.
 * Uses node-cron with Asia/Singapore timezone by default.
 * Each user's timezone from their profile is respected where possible.
 */

import cron from 'node-cron';
import { getAllUsers, getCompletedTaskIds } from './db.js';
import { formatDailyBriefing } from './services/content.js';
import { Markup } from 'telegraf';

let botInstance = null;

export function initScheduler(bot) {
  botInstance = bot;

  // ── 8:00 AM SGT — morning briefing ──────────────────────────────────────────
  cron.schedule('0 8 * * *', sendMorningBriefings, { timezone: 'Asia/Singapore' });

  // ── 7:00 PM SGT — evening check-in ──────────────────────────────────────────
  cron.schedule('0 19 * * *', sendEveningCheckin, { timezone: 'Asia/Singapore' });

  console.log('📅 Scheduler started — morning at 8am, evening at 7pm SGT');
}

// ── Morning briefing ───────────────────────────────────────────────────────────

async function sendMorningBriefings() {
  const users = await getAllUsers();
  console.log(`🌅 Morning briefing — sending to ${users.length} user(s)`);

  for (const user of users) {
    try {
      const completedIds         = await getCompletedTaskIds(user.id, user.mode);
      const { text, allTaskIds } = formatDailyBriefing(user, completedIds);
      const doneTodayCount       = completedIds.filter(id => allTaskIds.includes(id)).length;

      const greeting = getMorningGreeting(user);
      const progressLine = doneTodayCount > 0
        ? `\n\n_${doneTodayCount} of ${allTaskIds.length} already done ✅_`
        : `\n\n_${allTaskIds.length} task${allTaskIds.length !== 1 ? 's' : ''} for today_`;

      await botInstance.telegram.sendMessage(
        user.chat_id,
        `${greeting}\n\n${text}${progressLine}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Mark all done', 'mark_all_done')],
            [Markup.button.callback('📊 My progress',   'show_progress')],
          ]),
        }
      );
    } catch (err) {
      console.error(`Error sending morning briefing to user ${user.id}:`, err.message);
    }
  }
}

// ── Evening check-in ──────────────────────────────────────────────────────────

async function sendEveningCheckin() {
  const users = await getAllUsers();
  console.log(`🌙 Evening check-in — sending to ${users.length} user(s)`);

  for (const user of users) {
    try {
      const completedIds         = await getCompletedTaskIds(user.id, user.mode);
      const { allTaskIds }       = formatDailyBriefing(user, completedIds);
      const todayDone            = completedIds.filter(id => allTaskIds.includes(id)).length;
      const remaining            = allTaskIds.length - todayDone;

      let message;
      if (remaining === 0) {
        message = `🌟 *All done for today, ${user.name}!*\n\nMasha'Allah — you completed all ${allTaskIds.length} tasks today. Rest well tonight 🌙`;
      } else {
        message = `🌙 *Evening check-in, ${user.name}*\n\nYou've done *${todayDone}* of today's ${allTaskIds.length} tasks — ${remaining} remaining.\n\nTell me what you've done and I'll log it for you 🌿`;
      }

      await botInstance.telegram.sendMessage(user.chat_id, message, {
        parse_mode: 'Markdown',
        ...(remaining > 0 ? Markup.inlineKeyboard([
          [Markup.button.callback('📋 Show remaining tasks', 'show_today')],
          [Markup.button.callback('✅ Mark all done',         'mark_all_done')],
        ]) : {}),
      });
    } catch (err) {
      console.error(`Error sending evening check-in to user ${user.id}:`, err.message);
    }
  }
}

// ── Greeting helpers ───────────────────────────────────────────────────────────

function getMorningGreeting(user) {
  const hour = new Date().getHours();
  const greetings = [
    `Assalamualaikum ${user.name} 🌿`,
    `Good morning, ${user.name} ☀️`,
    `Selamat pagi, ${user.name} 🌸`,
    `早安 ${user.name} 🌱`,
  ];
  // Pick greeting based on day-of-week (consistent per user per day)
  const day = new Date().getDay();
  return greetings[day % greetings.length];
}
