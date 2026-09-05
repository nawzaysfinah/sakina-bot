/**
 * Handles all incoming messages from registered users.
 * Routes: onboarding → commands → EPDS → reminder → task log → fallback
 */

import {
  getUser, getCompletedTaskIds, markTasksDone,
  addReminder, getTodayReminders,
  getActiveEpdsSession, updateEpdsResponse,
} from '../db.js';
import {
  formatDailyBriefing,
  getPrepareContent,
  getRecoverContent,
  getTumbuhContent,
} from '../services/content.js';
import { parseCompletedTasks, generateLogResponse } from '../services/claude.js';
import { parseReminderIntent } from '../services/reminders.js';
import { handleOnboarding } from './onboarding.js';
import { handleLog, handleShare, handleView } from './commands.js';
import { Markup } from 'telegraf';

// EPDS questions — full Edinburgh Postnatal Depression Scale
const EPDS_QUESTIONS = [
  { q: 1, text: 'I have been able to laugh and see the funny side of things', options: ['As much as I always could', 'Not quite so much now', 'Definitely not so much now', 'Not at all'] },
  { q: 2, text: 'I have looked forward with enjoyment to things', options: ['As much as I ever did', 'Rather less than I used to', 'Definitely less than I used to', 'Hardly at all'] },
  { q: 3, text: 'I have blamed myself unnecessarily when things went wrong', options: ['No, never', 'Not very often', 'Yes, some of the time', 'Yes, most of the time'] },
  { q: 4, text: 'I have been anxious or worried for no good reason', options: ['No, not at all', 'Hardly ever', 'Yes, sometimes', 'Yes, very often'] },
  { q: 5, text: 'I have felt scared or panicky for no very good reason', options: ['No, not at all', 'No, not much', 'Yes, sometimes', 'Yes, quite a lot'] },
  { q: 6, text: 'Things have been getting on top of me', options: ['No, I have been coping as well as ever', 'No, most of the time I have coped quite well', 'Yes, sometimes I haven\'t been coping as well as usual', 'Yes, most of the time I haven\'t been able to cope at all'] },
  { q: 7, text: 'I have been so unhappy that I have had difficulty sleeping', options: ['No, not at all', 'Not very often', 'Yes, sometimes', 'Yes, most of the time'] },
  { q: 8, text: 'I have felt sad or miserable', options: ['No, not at all', 'Not very often', 'Yes, quite often', 'Yes, most of the time'] },
  { q: 9, text: 'I have been so unhappy that I have been crying', options: ['No, never', 'Only occasionally', 'Yes, quite often', 'Yes, most of the time'] },
  { q: 10, text: 'The thought of harming myself has occurred to me', options: ['Never', 'Hardly ever', 'Sometimes', 'Yes, quite often'] },
];

export async function handleMessage(ctx) {
  const userId = ctx.from.id;
  const text   = ctx.message?.text?.trim() || '';

  const user = await getUser(userId);

  // ── New user ───────────────────────────────────────────────────────────────
  if (!user || user.onboarding === 'start') {
    return handleOnboarding(ctx, 'start');
  }

  // ── Mid-onboarding ─────────────────────────────────────────────────────────
  if (user.onboarding === 'due_date')      return handleOnboarding(ctx, 'due_date');
  if (user.onboarding === 'baby_dob')      return handleOnboarding(ctx, 'baby_dob');
  if (user.onboarding === 'delivery_type') return handleOnboarding(ctx, 'delivery_type');

  // ── Active EPDS session — intercept all messages ───────────────────────────
  const epdsSession = await getActiveEpdsSession(userId);
  if (epdsSession) {
    return handleEpdsMessage(ctx, user, epdsSession, text);
  }

  // ── /today ─────────────────────────────────────────────────────────────────
  if (text === '/today' || text.toLowerCase() === 'today') {
    return sendDailyBriefing(ctx, user);
  }

  // ── /switch ────────────────────────────────────────────────────────────────
  if (text === '/switch') {
    return ctx.reply(
      'Switch to which mode?',
      Markup.inlineKeyboard([
        [Markup.button.callback('🌱 Prepare', 'mode_prepare')],
        [Markup.button.callback('🌿 Recover', 'mode_recover')],
        [Markup.button.callback('🌸 Tumbuh', 'mode_tumbuh')],
      ])
    );
  }

  // ── /progress ──────────────────────────────────────────────────────────────
  if (text === '/progress') {
    const done = await getCompletedTaskIds(userId, user.mode);
    const { allTaskIds } = formatDailyBriefing(user, done);
    const todayDone = done.filter(id => allTaskIds.includes(id)).length;
    const streakLine = user.streak_days > 1
      ? `\n🔥 *${user.streak_days}-day streak!*`
      : '';
    return ctx.reply(
      `📊 *Today's progress:* ${todayDone} of ${allTaskIds.length} tasks done\n📝 *Total tasks logged:* ${done.length}${streakLine}`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── /help ──────────────────────────────────────────────────────────────────
  if (text === '/help') {
    return ctx.reply(
`*Sakina commands:*

📋 /today — see today's tasks
📊 /progress — completion count + streak
🔄 /switch — change mode
💡 /tip — daily wellness tip
📅 /week — current week/day summary
📌 /reminders — manage reminders
↩️ /undo — unmark last logged task
📊 /log — track feeds, weight, nappies
🔗 /share — share your journal with partner
🚨 /urgent — emergency danger signs
ℹ️ /about — what is Sakina?

Or just *tell me what you've done* and I'll log it automatically 🌿`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── /log command ────────────────────────────────────────────────────────────
  if (text.startsWith('/log')) {
    return handleLog(ctx);
  }

  // ── /share command ──────────────────────────────────────────────────────────
  if (text.startsWith('/share')) {
    return handleShare(ctx);
  }

  // ── /view command ───────────────────────────────────────────────────────────
  if (text.startsWith('/view')) {
    return handleView(ctx);
  }

  // ── Reminder intent detection ──────────────────────────────────────────────
  const reminderIntent = await parseReminderIntent(text);
  if (reminderIntent.isReminder) {
    const reminder = await addReminder(user.id, reminderIntent.text, reminderIntent.date);
    const dateLabel = new Date(reminderIntent.date + 'T00:00:00').toLocaleDateString('en-SG', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    return ctx.reply(
      `📌 *Reminder saved!*\n\n"${reminderIntent.text}"\n\n📅 I'll remind you on *${dateLabel}*\n\nView all reminders with /reminders`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🗑 Delete this reminder', `del_reminder_${reminder.id}`)]]),
      }
    );
  }

  // ── Natural language task logging ──────────────────────────────────────────
  const completedIds = await getCompletedTaskIds(userId, user.mode);
  const { tasks: todayTasks } = getTodayTaskObjects(user);
  const pendingTasks = todayTasks.filter(t => !completedIds.includes(t.id));

  if (pendingTasks.length > 0) {
    const matchedIds = await parseCompletedTasks(text, pendingTasks);

    if (matchedIds.length > 0) {
      await markTasksDone(userId, user.mode, matchedIds);
      const matchedTasks = todayTasks.filter(t => matchedIds.includes(t.id));
      const newRemaining = pendingTasks.length - matchedIds.length;
      const reply        = await generateLogResponse(matchedTasks, newRemaining, user.mode);

      const checklist = matchedTasks.map(t => `✅ ${t.text.split('—')[0].trim()}`).join('\n');

      // Streak encouragement
      const updatedUser = await getUser(userId);
      const streakLine = updatedUser?.streak_days > 1
        ? `\n\n🔥 *${updatedUser.streak_days}-day streak!* Keep it up.`
        : '';

      return ctx.reply(`${checklist}\n\n${reply}${streakLine}`, { parse_mode: 'Markdown' });
    }
  }

  // ── Fallback — improved guidance ───────────────────────────────────────────
  return sendFallback(ctx, user, completedIds, todayTasks);
}

// ── EPDS session handler ───────────────────────────────────────────────────────

async function handleEpdsMessage(ctx, user, session, text) {
  // The active EPDS session is waiting for a callback answer, not text input
  // If user types something, remind them to use the buttons
  return ctx.reply(
    `Please use the buttons to answer the question above.\n\nIf you want to stop the screening, send /skip_epds`,
    { parse_mode: 'Markdown' }
  );
}

// Called from callbacks.js when EPDS answer button is pressed
export async function handleEpdsAnswer(ctx, sessionId, questionNum, answerIndex) {
  const updated = await updateEpdsResponse(sessionId, questionNum, answerIndex);

  if (updated.completed_at) {
    // Screening complete
    return sendEpdsResult(ctx, updated);
  }

  // Next question
  const nextQ = EPDS_QUESTIONS[questionNum]; // 0-indexed in array, questionNum is 1-10
  if (!nextQ) return;

  const buttons = nextQ.options.map((opt, i) => [
    Markup.button.callback(opt, `epds_${updated.id}_${nextQ.q}_${i}`)
  ]);

  return ctx.reply(
    `*Question ${nextQ.q} of 10 — EPDS*\n\n_${nextQ.text}_`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
}

async function sendEpdsResult(ctx, session) {
  const score = session.score;
  const q10   = session.responses[10] ?? 0;

  let interpretation, advice;

  if (q10 > 0) {
    interpretation = '🔴 *Please seek support now*';
    advice = `You answered that thoughts of self-harm have occurred to you. This does not make you a bad parent — it means you need and deserve immediate support.\n\n📞 *IMH 24hr Helpline: 1767*\n📞 *Samaritans of Singapore: 1-767*\n\nPlease tell someone you trust right now, or go to the nearest A&E.`;
  } else if (score >= 13) {
    interpretation = '🟠 *You may benefit from professional support*';
    advice = `Your score suggests you might be experiencing postnatal depression. This is common, treatable, and not your fault.\n\n• Talk to your GP, obstetrician, or polyclinic\n• Ask for a referral to a counsellor or psychiatrist\n• Tell someone you trust how you're feeling\n\n📞 *IMH: 1767 | SSO: 1800-222-0000*`;
  } else if (score >= 10) {
    interpretation = '🟡 *Check in with your care team*';
    advice = `Your score is in the moderate range. Mention this at your next appointment — your doctor can advise whether you need further assessment.\n\nKeep monitoring: Sakina will check in again at the next scheduled milestone.`;
  } else {
    interpretation = '🟢 *You\'re doing well*';
    advice = `Your score is in the low-risk range. Continue taking care of yourself — rest, nourishment, and emotional support remain important even when you're coping well.`;
  }

  return ctx.reply(
`📋 *EPDS Screening Complete*

Your score: *${score} / 30*
${interpretation}

${advice}

_This is a screening tool, not a diagnosis. It does not replace a clinical assessment._`,
    { parse_mode: 'Markdown' }
  );
}

export async function sendEpdsQuestion(ctx, session) {
  const q = EPDS_QUESTIONS[session.current_question - 1];
  if (!q) return;

  const buttons = q.options.map((opt, i) => [
    Markup.button.callback(opt, `epds_${session.id}_${q.q}_${i}`)
  ]);

  await ctx.reply(
    `📋 *Edinburgh Postnatal Depression Scale — Question ${q.q} of 10*\n\n_In the past 7 days:_\n\n*${q.text}*`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
}

// ── Send the daily briefing ────────────────────────────────────────────────────

export async function sendDailyBriefing(ctx, user) {
  const completedIds         = await getCompletedTaskIds(user.id, user.mode);
  const { text, allTaskIds } = formatDailyBriefing(user, completedIds);
  const doneTodayCount       = completedIds.filter(id => allTaskIds.includes(id)).length;
  const totalCount           = allTaskIds.length;

  const streakLine = user.streak_days > 1
    ? `🔥 *${user.streak_days}-day streak!*\n`
    : '';

  const progressLine = `\n\n${streakLine}_${doneTodayCount} of ${totalCount} tasks done today_`;

  // Append today's reminders
  const todayReminders = await getTodayReminders(user.id);
  const reminderBlock  = todayReminders.length
    ? `\n\n📌 *Reminders for today:*\n` + todayReminders.map(r => `• ${r.text}`).join('\n')
    : '';

  await ctx.reply(text + progressLine + reminderBlock, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ Mark all done', 'mark_all_done')],
      [Markup.button.callback('📊 My progress',   'show_progress')],
    ]),
  });
}

// ── Improved fallback ─────────────────────────────────────────────────────────

async function sendFallback(ctx, user, completedIds, todayTasks) {
  const allDone = todayTasks.every(t => completedIds.includes(t.id));

  if (allDone) {
    return ctx.reply(
      `🌟 All today's tasks are done!\n\nNot sure what to do? Try:\n• /tip — a wellness tip\n• /week — see your week summary\n• /log — track feeding, weight, or nappies\n• /reminders — manage reminders`,
      { parse_mode: 'Markdown' }
    );
  }

  const pending = todayTasks.filter(t => !completedIds.includes(t.id));
  const examples = pending.slice(0, 2).map(t => `_"${getExamplePhrase(t.text)}"_`).join(' or ');

  return ctx.reply(
    `I couldn't match that to today's tasks 🌿\n\nTo log a task, tell me what you did — like ${examples}\n\nOr tap below to see the full list:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback("📋 Show today's tasks", 'show_today')],
        [Markup.button.callback('💡 Get a tip', 'get_tip')],
      ]),
    }
  );
}

function getExamplePhrase(taskText) {
  // Extract a short phrase from the task text for the example
  const short = taskText.split('—')[0].split('.')[0].trim();
  return short.length > 40 ? short.slice(0, 40) + '…' : short;
}

// ── Extract today's tasks for NLP matching ────────────────────────────────────

function getTodayTaskObjects(user) {
  if (user.mode === 'prepare') {
    const c = getPrepareContent(user);
    return { tasks: [...c.weekendTasks, ...c.dailyHabits] };
  }
  if (user.mode === 'recover') {
    const c = getRecoverContent(user);
    return { tasks: c.tasks };
  }
  if (user.mode === 'tumbuh') {
    const c = getTumbuhContent(user);
    return { tasks: c.tasks };
  }
  return { tasks: [] };
}
