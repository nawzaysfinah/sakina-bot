/**
 * Inline keyboard callback handler.
 * All callback_data strings dispatched here.
 */

import {
  getUser, upsertUser,
  getCompletedTaskIds, markTasksDone,
  markReminderDone, deleteReminder,
  upsertMilestoneCompletion,
} from '../db.js';
import { formatDailyBriefing, getTumbuhContent, getNextWeekId } from '../services/content.js';
import { handleModeCallback, handleDeliveryTypeCallback, handleBabyRoleCallback } from './onboarding.js';
import { sendDailyBriefing, handleEpdsAnswer } from './message.js';
import { handleResetConfirm, handleTip } from './commands.js';
import { Markup } from 'telegraf';

export async function handleCallback(ctx) {
  const data   = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  // ── Mode switch ────────────────────────────────────────────────────────────
  if (data.startsWith('mode_')) {
    const mode = data.replace('mode_', '');
    const user = await getUser(userId);
    if (user && user.onboarding === 'done') {
      // Already onboarded — switching mode
      if (mode === 'recover') {
        // Ask delivery type when switching back to recover
        await upsertUser(userId, { mode, chat_id: ctx.chat.id, onboarding: 'delivery_type' });
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        await ctx.answerCbQuery();
        return ctx.reply(
          'How was your baby born?',
          Markup.inlineKeyboard([
            [Markup.button.callback('🌿 Vaginal birth', 'delivery_vaginal')],
            [Markup.button.callback('🔷 C-section (cesarean)', 'delivery_cesarean')],
          ])
        );
      }
      await upsertUser(userId, { mode, chat_id: ctx.chat.id });
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      const label = { prepare: '🌱 Prepare', recover: '🌿 Recover', tumbuh: '🌸 Tumbuh' }[mode];
      await ctx.answerCbQuery(`Switched to ${label}`);
      const updatedUser = { ...user, mode };
      return sendDailyBriefing(ctx, updatedUser);
    }
    await ctx.answerCbQuery();
    return handleModeCallback(ctx, mode);
  }

  // ── Delivery type ─────────────────────────────────────────────────────────
  if (data.startsWith('delivery_')) {
    const deliveryType = data.replace('delivery_', '');
    await ctx.answerCbQuery();
    return handleDeliveryTypeCallback(ctx, deliveryType);
  }

  // ── Baby role (onboarding) ─────────────────────────────────────────────────
  if (data.startsWith('role_')) {
    await ctx.answerCbQuery();
    return handleBabyRoleCallback(ctx, data.replace('role_', ''));
  }

  // ── Show today ─────────────────────────────────────────────────────────────
  if (data === 'show_today') {
    await ctx.answerCbQuery();
    const user = await getUser(userId);
    if (!user) return ctx.reply('Please start with /start first.');
    return sendDailyBriefing(ctx, user);
  }

  // ── Get tip ────────────────────────────────────────────────────────────────
  if (data === 'get_tip') {
    await ctx.answerCbQuery();
    return handleTip(ctx);
  }

  // ── Mark all done ──────────────────────────────────────────────────────────
  if (data === 'mark_all_done') {
    const user = await getUser(userId);
    const completedIds = await getCompletedTaskIds(userId, user.mode);
    const { allTaskIds } = formatDailyBriefing(user, completedIds);
    const remaining = allTaskIds.filter(id => !completedIds.includes(id));

    if (remaining.length === 0) {
      await ctx.answerCbQuery("Already all done! 🌟");
      return;
    }

    await markTasksDone(userId, user.mode, remaining);
    await ctx.answerCbQuery("All done! Amazing work 🌟");
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    return ctx.reply(
      `✅ Marked all ${allTaskIds.length} tasks as done for today.\n\n_You're doing brilliantly — rest well tonight_ 🌙`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Show progress ──────────────────────────────────────────────────────────
  if (data === 'show_progress') {
    const user = await getUser(userId);
    const done = await getCompletedTaskIds(userId, user.mode);
    const { allTaskIds } = formatDailyBriefing(user, done);
    const todayDone = done.filter(id => allTaskIds.includes(id)).length;
    const streakLine = user.streak_days > 1 ? `\n🔥 *${user.streak_days}-day streak!*` : '';

    await ctx.answerCbQuery();
    return ctx.reply(
      `📊 *Your progress*\n\n✅ Today: ${todayDone} / ${allTaskIds.length} tasks\n📝 All-time: ${done.length} tasks logged${streakLine}`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Tumbuh — advance milestone ────────────────────────────────────────────
  if (data.startsWith('tumbuh_advance_')) {
    const nextWeekId = data.replace('tumbuh_advance_', '');
    await upsertUser(userId, { tumbuh_week_id: nextWeekId, chat_id: ctx.chat.id });
    await ctx.answerCbQuery('Milestone unlocked! 🌸');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    const user = await getUser(userId);
    const c = getTumbuhContent(user);
    return ctx.reply(
      `🌸 *Milestone unlocked!*\n\nMoving to: *${c.header.replace(/\*/g, '')}*\n\nTap /today to see the new activities.`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Tumbuh — stay on current week ────────────────────────────────────────
  if (data === 'tumbuh_stay') {
    await ctx.answerCbQuery('Staying on current week 🌿');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    return ctx.reply('Got it — keep working on this week\'s activities. Sakina will ask again when you\'re ready 🌿');
  }

  // ── Reminder — mark done ───────────────────────────────────────────────────
  if (data.startsWith('done_reminder_')) {
    const id = data.replace('done_reminder_', '');
    await markReminderDone(id);
    await ctx.answerCbQuery('Reminder marked done ✅');
    return ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  }

  // ── Reminder — delete ──────────────────────────────────────────────────────
  if (data.startsWith('del_reminder_')) {
    const id = data.replace('del_reminder_', '');
    await deleteReminder(id);
    await ctx.answerCbQuery('Reminder deleted 🗑');
    return ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  }

  // ── EPDS — start screening ────────────────────────────────────────────────
  if (data.startsWith('epds_start_')) {
    const sessionId = data.replace('epds_start_', '');
    await ctx.answerCbQuery('Starting check-in...');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    // Re-fetch session and send first question
    const { getActiveEpdsSession } = await import('../db.js');
    const { sendEpdsQuestion: _send } = await import('./message.js');
    const session = await getActiveEpdsSession(userId);
    if (session) return _send(ctx, session);
    return ctx.reply('Something went wrong — please try /start to reset.');
  }

  // ── EPDS — skip ───────────────────────────────────────────────────────────
  if (data === 'epds_skip') {
    await ctx.answerCbQuery('No problem 🌿');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    return ctx.reply('Got it — take care of yourself 🌿 You can come back to this any time.');
  }

  // ── EPDS answer ────────────────────────────────────────────────────────────
  if (data.startsWith('epds_')) {
    // Format: epds_{sessionId}_{questionNum}_{answerIndex}
    // UUID has dashes so split may give many parts — use regex
    const match = data.match(/^epds_([a-f0-9-]{36})_(\d+)_(\d+)$/);
    if (match) {
      const [, sessionId, questionNum, answerIndex] = match;
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      return handleEpdsAnswer(ctx, sessionId, parseInt(questionNum), parseInt(answerIndex));
    }
  }

  // ── Reset confirmation ─────────────────────────────────────────────────────
  if (data === 'confirm_reset') {
    await ctx.answerCbQuery();
    return handleResetConfirm(ctx);
  }

  if (data === 'cancel_reset') {
    await ctx.answerCbQuery('Reset cancelled 🌿');
    return ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  }

  // ── Unknown ────────────────────────────────────────────────────────────────
  await ctx.answerCbQuery("Try /today to see your task list");
}
