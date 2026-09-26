/**
 * Scheduled messages.
 *
 * Architecture: run ONE cron every hour. For each user, check whether their
 * local time is 8am (morning briefing) or 7pm (evening check-in).
 * This respects the user.timezone field rather than hardcoding SGT.
 *
 * Additional jobs (Sunday 8am SGT):
 *  - Weekly summary
 *  - EPDS screening prompt (Day 7, 14, 30 after baby_dob)
 *  - Vaccination reminders (3 days before due date)
 */

import cron from 'node-cron';
import {
  getAllUsers, getCompletedTaskIds,
  startEpdsSession, getEpdsSession,
  addReminder,
} from './db.js';
import { formatDailyBriefing, getUpcomingVaccinations } from './services/content.js';
import { sendEpdsQuestion } from './handlers/message.js';
import { Markup } from 'telegraf';

let botInstance   = null;
let babyLogRef    = null;
let supabaseRef   = null;

export function initScheduler(bot, { babyLog, supabase } = {}) {
  botInstance = bot;
  babyLogRef  = babyLog  || null;
  supabaseRef = supabase || null;

  // ── Hourly check — morning + evening per user's timezone ──────────────────
  cron.schedule('0 * * * *', hourlyCheck);

  // ── Sunday 8am SGT — weekly summary ──────────────────────────────────────
  cron.schedule('0 8 * * 0', sendWeeklySummaries, { timezone: 'Asia/Singapore' });

  // ── Daily 6am SGT — EPDS + vaccination checks ─────────────────────────────
  cron.schedule('0 6 * * *', runDailyHealthChecks, { timezone: 'Asia/Singapore' });

  // ── Daily 9pm SGT — baby log scan reminders ───────────────────────────────
  cron.schedule('0 21 * * *', async () => {
    if (!babyLogRef || !supabaseRef) return;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    try {
      if (await babyLogRef.queries.claimJob('scan_reminder', today)) {
        const { sendScanReminders } = await import('./babyLog/scheduler.js');
        await sendScanReminders(botInstance, supabaseRef, babyLogRef.queries);
      }
    } catch (e) {
      console.error('scan reminders failed', e);
    }
  }, { timezone: 'Asia/Singapore' });

  console.log('📅 Scheduler started — hourly timezone-aware briefings, weekly Sunday summary, daily health checks, 9pm baby log reminders');
}

// ── Hourly dispatcher ─────────────────────────────────────────────────────────

async function hourlyCheck() {
  const users = await getAllUsers();
  const now   = new Date();

  for (const user of users) {
    try {
      const localHour = getLocalHour(now, user.timezone || 'Asia/Singapore');

      if (localHour === 7) {
        await sendMorningBriefing(user);
      } else if (localHour === 19) {
        await sendEveningCheckin(user);
      }
    } catch (err) {
      console.error(`Hourly check error for user ${user.id}:`, err.message);
    }
  }
}

function getLocalHour(date, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-SG', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    return parseInt(formatter.format(date));
  } catch {
    // Fallback to SGT if timezone is invalid
    return parseInt(new Intl.DateTimeFormat('en-SG', {
      timeZone: 'Asia/Singapore', hour: 'numeric', hour12: false,
    }).format(date));
  }
}

// ── Morning briefing ───────────────────────────────────────────────────────────

async function sendMorningBriefing(user) {
  const completedIds         = await getCompletedTaskIds(user.id, user.mode);
  const { text, allTaskIds } = formatDailyBriefing(user, completedIds);
  const doneTodayCount       = completedIds.filter(id => allTaskIds.includes(id)).length;

  const greeting   = getMorningGreeting(user);
  const streakLine = user.streak_days > 1 ? `\n🔥 *${user.streak_days}-day streak!*` : '';

  const progressLine = doneTodayCount > 0
    ? `\n\n${streakLine}_${doneTodayCount} of ${allTaskIds.length} already done ✅_`
    : `\n\n${streakLine}_${allTaskIds.length} task${allTaskIds.length !== 1 ? 's' : ''} for today_`;

  // Vaccination reminder check
  const vaccinationAlert = await getVaccinationAlert(user);

  await botInstance.telegram.sendMessage(
    user.chat_id,
    `${greeting}\n\n${text}${progressLine}${vaccinationAlert}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Mark all done', 'mark_all_done')],
        [Markup.button.callback('📊 My progress',   'show_progress')],
      ]),
    }
  );

  // Baby brief — sent as a follow-up message if this user is a caregiver
  if (babyLogRef) {
    try {
      const { sendBabyBrief } = await import('./babyLog/brief.js');
      await sendBabyBrief(botInstance, user, babyLogRef.queries);
    } catch (e) {
      console.error(`Baby brief error for user ${user.id}:`, e.message);
    }
  }
}

// ── Evening check-in ──────────────────────────────────────────────────────────

async function sendEveningCheckin(user) {
  const completedIds   = await getCompletedTaskIds(user.id, user.mode);
  const { allTaskIds } = formatDailyBriefing(user, completedIds);
  const todayDone      = completedIds.filter(id => allTaskIds.includes(id)).length;
  const remaining      = allTaskIds.length - todayDone;

  let message;
  if (remaining === 0) {
    const streakLine = user.streak_days > 1 ? `\n🔥 *${user.streak_days} days in a row — masha'Allah!*` : '';
    message = `🌟 *All done for today, ${user.name}!*${streakLine}\n\nYou completed all ${allTaskIds.length} tasks today. Rest well tonight 🌙`;
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
}

// ── Weekly Sunday summary ──────────────────────────────────────────────────────

async function sendWeeklySummaries() {
  const users = await getAllUsers();
  console.log(`📊 Sunday summary — sending to ${users.length} user(s)`);

  for (const user of users) {
    try {
      await sendWeeklySummary(user);
    } catch (err) {
      console.error(`Sunday summary error for user ${user.id}:`, err.message);
    }
  }
}

async function sendWeeklySummary(user) {
  const completedIds         = await getCompletedTaskIds(user.id, user.mode);
  const { allTaskIds }       = formatDailyBriefing(user, completedIds);
  const doneTodayCount       = completedIds.filter(id => allTaskIds.includes(id)).length;

  const modeLabel = { prepare: '🌱 Prepare', recover: '🌿 Recover', tumbuh: '🌸 Tumbuh' }[user.mode];
  const streakText = user.streak_days > 0
    ? `\n🔥 *Current streak:* ${user.streak_days} day${user.streak_days !== 1 ? 's' : ''}`
    : '';

  let contextLine = '';
  if (user.mode === 'recover' && user.baby_dob) {
    const day = Math.min(44, Math.max(1, daysBetween(user.baby_dob) + 1));
    contextLine = `\n📅 Day ${day} of 44`;
  } else if (user.mode === 'prepare' && user.due_date) {
    const daysLeft = Math.ceil((new Date(user.due_date) - new Date()) / 86400000);
    contextLine = daysLeft > 0 ? `\n📅 ${daysLeft} days until due date` : '\n📅 Any day now!';
  } else if (user.mode === 'tumbuh' && user.baby_dob) {
    const weeks = Math.floor(daysBetween(user.baby_dob) / 7);
    contextLine = `\n📅 Baby is ${weeks} weeks old`;
  }

  await botInstance.telegram.sendMessage(
    user.chat_id,
    `🌿 *Weekly check-in, ${user.name}*

Mode: ${modeLabel}${contextLine}${streakText}

Today you have *${doneTodayCount} of ${allTaskIds.length}* tasks done.

Tap /today to see this week's full plan, or /tip for a wellness insight 💡

_Have a restful Sunday_ 🌸`,
    { parse_mode: 'Markdown' }
  );
}

// ── Daily health checks — EPDS + vaccinations ─────────────────────────────────

async function runDailyHealthChecks() {
  const users = await getAllUsers();

  for (const user of users) {
    try {
      if (user.baby_dob) {
        await checkEpdsSchedule(user);
        await checkVaccinationReminders(user);
      }
    } catch (err) {
      console.error(`Health check error for user ${user.id}:`, err.message);
    }
  }
}

// EPDS: prompt at Day 7, 14, 30 after baby_dob

const EPDS_DAYS = [7, 14, 30];

async function checkEpdsSchedule(user) {
  if (!user.baby_dob) return;
  const babyDay = daysBetween(user.baby_dob) + 1;

  for (const marker of EPDS_DAYS) {
    if (babyDay !== marker) continue;

    // Check if already screened for this marker
    const existing = await getEpdsSession(user.id, marker);
    if (existing) continue; // already done or in progress

    // Start session and send first question
    const session = await startEpdsSession(user.id, marker);

    const intro = `💙 *Mood check-in — Day ${marker}*\n\nHi ${user.name}, it's a good time to check in with how you're feeling.\n\nThis is a short 10-question Edinburgh Postnatal Depression Scale (EPDS) — it takes 3 minutes and helps you understand your emotional wellbeing.\n\nAll responses are private to you. Ready?`;

    await botInstance.telegram.sendMessage(user.chat_id, intro, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Yes, start the check-in', `epds_start_${session.id}`)],
        [Markup.button.callback('Not now', 'epds_skip')],
      ]),
    });

    break; // Only trigger one marker per day
  }
}

// Vaccination: send reminder 3 days before due date

async function checkVaccinationReminders(user) {
  if (!user.baby_dob) return;

  const upcoming = getUpcomingVaccinations(user.baby_dob, 3);

  for (const vax of upcoming) {
    if (vax.daysUntil !== 3) continue; // Only send exactly 3 days before

    const dateLabel = new Date(vax.date).toLocaleDateString('en-SG', {
      weekday: 'long', day: 'numeric', month: 'long'
    });

    await botInstance.telegram.sendMessage(
      user.chat_id,
      `💉 *Vaccination reminder*\n\n*${vax.label}*\n\n📅 Due in 3 days — *${dateLabel}*\n\nRemember to book your appointment at KKH, polyclinic, or your paediatrician if you haven't already.\n\n_Singapore NCIS Schedule_`,
      { parse_mode: 'Markdown' }
    );
  }
}

async function getVaccinationAlert(user) {
  if (!user.baby_dob) return '';

  const dueTomorrow = getUpcomingVaccinations(user.baby_dob, 1);
  if (!dueTomorrow.length) return '';

  return `\n\n💉 *Vaccination tomorrow:* ${dueTomorrow[0].label}`;
}

// ── Greeting helpers ───────────────────────────────────────────────────────────

function getMorningGreeting(user) {
  const greetings = [
    `Assalamualaikum ${user.name} 🌿`,
    `Good morning, ${user.name} ☀️`,
    `Selamat pagi, ${user.name} 🌸`,
    `早安 ${user.name} 🌱`,
  ];
  const day = new Date().getDay();
  return greetings[day % greetings.length];
}

function daysBetween(dateStr) {
  const target = new Date(dateStr);
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((today - target) / 86400000);
}
