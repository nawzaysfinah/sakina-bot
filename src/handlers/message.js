/**
 * Handles all incoming messages from registered users.
 * Detects intent (log tasks, show today, switch mode, etc.)
 * and routes accordingly.
 */

import { getUser, getCompletedTaskIds, markTasksDone } from '../db.js';
import {
  formatDailyBriefing,
  getPrepareContent,
  getRecoverContent,
  getTumbuhContent,
} from '../services/content.js';
import { parseCompletedTasks, generateLogResponse } from '../services/claude.js';
import { handleOnboarding } from './onboarding.js';
import { Markup } from 'telegraf';

export async function handleMessage(ctx) {
  const userId = ctx.from.id;
  const text   = ctx.message.text?.trim() || '';

  const user = await getUser(userId);

  // ── New user ───────────────────────────────────────────────────────────────
  if (!user || user.onboarding === 'start') {
    return handleOnboarding(ctx, 'start');
  }

  // ── Mid-onboarding ─────────────────────────────────────────────────────────
  if (user.onboarding === 'due_date') return handleOnboarding(ctx, 'due_date');
  if (user.onboarding === 'baby_dob') return handleOnboarding(ctx, 'baby_dob');

  // ── /today command ─────────────────────────────────────────────────────────
  if (text === '/today' || text.toLowerCase() === 'today') {
    return sendDailyBriefing(ctx, user);
  }

  // ── /switch command — change mode ──────────────────────────────────────────
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

  // ── /progress command ──────────────────────────────────────────────────────
  if (text === '/progress') {
    const done = await getCompletedTaskIds(userId, user.mode);
    const { allTaskIds } = formatDailyBriefing(user, done);
    const todayDone = done.filter(id => allTaskIds.includes(id)).length;
    return ctx.reply(
      `📊 *Today's progress:* ${todayDone} of ${allTaskIds.length} tasks done\n📝 *Total tasks logged:* ${done.length}`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── /help ──────────────────────────────────────────────────────────────────
  if (text === '/help') {
    return ctx.reply(
      `*Sakina commands:*\n\n/today — see today's tasks\n/progress — see completion count\n/switch — change mode\n\nOr just *tell me what you've done* and I'll log it automatically 🌿`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Natural language task logging ──────────────────────────────────────────
  const completedIds  = await getCompletedTaskIds(userId, user.mode);
  const { allTaskIds } = formatDailyBriefing(user, completedIds);

  // Build today's task objects (id + text) for Claude to match against
  const { tasks: todayTasks } = getTodayTaskObjects(user);
  const pendingTasks = todayTasks.filter(t => !completedIds.includes(t.id));

  const matchedIds = await parseCompletedTasks(text, pendingTasks);

  if (matchedIds.length > 0) {
    await markTasksDone(userId, user.mode, matchedIds);
    const matchedTasks  = todayTasks.filter(t => matchedIds.includes(t.id));
    const newRemaining  = pendingTasks.length - matchedIds.length;
    const reply         = await generateLogResponse(matchedTasks, newRemaining, user.mode);

    const checklist = matchedTasks.map(t => `✅ ${t.text.split('—')[0].trim()}`).join('\n');
    return ctx.reply(`${checklist}\n\n${reply}`, { parse_mode: 'Markdown' });
  }

  // ── Fallback — no tasks matched ────────────────────────────────────────────
  return ctx.reply(
    `I couldn't match that to today's tasks — want to see the full list?`,
    Markup.inlineKeyboard([[Markup.button.callback('📋 Show today\'s tasks', 'show_today')]])
  );
}

// ── Send the daily briefing ────────────────────────────────────────────────────

export async function sendDailyBriefing(ctx, user) {
  const completedIds        = await getCompletedTaskIds(user.id, user.mode);
  const { text, allTaskIds } = formatDailyBriefing(user, completedIds);
  const doneTodayCount      = completedIds.filter(id => allTaskIds.includes(id)).length;
  const totalCount          = allTaskIds.length;

  const progressLine = `\n\n_${doneTodayCount} of ${totalCount} tasks done today_`;

  await ctx.reply(text + progressLine, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ Mark all done', 'mark_all_done')],
      [Markup.button.callback('📊 My progress',   'show_progress')],
    ]),
  });
}

// ── Helper — extract flat task list for today ──────────────────────────────────

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
