/**
 * Inline keyboard callback handler.
 * All callback_data strings are dispatched here.
 */

import { getUser, upsertUser, getCompletedTaskIds, markTasksDone } from '../db.js';
import { formatDailyBriefing, getPrepareContent, getRecoverContent, getTumbuhContent } from '../services/content.js';
import { handleModeCallback } from './onboarding.js';
import { sendDailyBriefing } from './message.js';
import { Markup } from 'telegraf';

export async function handleCallback(ctx) {
  const data   = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  // ── Mode switch ────────────────────────────────────────────────────────────
  if (data.startsWith('mode_')) {
    const mode = data.replace('mode_', '');

    // If already onboarded, just switch mode (no date re-collection)
    const user = await getUser(userId);
    if (user && user.onboarding === 'done') {
      await upsertUser(userId, { mode });
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      const label = { prepare: '🌱 Prepare', recover: '🌿 Recover', tumbuh: '🌸 Tumbuh' }[mode];
      await ctx.answerCbQuery(`Switched to ${label}`);
      const updatedUser = { ...user, mode };
      return sendDailyBriefing(ctx, updatedUser);
    }

    // During onboarding — hand off to onboarding handler
    await ctx.answerCbQuery();
    return handleModeCallback(ctx, mode);
  }

  // ── Show today ─────────────────────────────────────────────────────────────
  if (data === 'show_today') {
    await ctx.answerCbQuery();
    const user = await getUser(userId);
    if (!user) return ctx.reply('Please start with /start first.');
    return sendDailyBriefing(ctx, user);
  }

  // ── Mark all done ──────────────────────────────────────────────────────────
  if (data === 'mark_all_done') {
    const user = await getUser(userId);
    const completedIds = await getCompletedTaskIds(userId, user.mode);
    const { allTaskIds } = formatDailyBriefing(user, completedIds);
    const remaining    = allTaskIds.filter(id => !completedIds.includes(id));

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
    const todayDone   = done.filter(id => allTaskIds.includes(id)).length;
    const totalLogged = done.length;

    await ctx.answerCbQuery();
    return ctx.reply(
      `📊 *Your progress*\n\n✅ Today: ${todayDone} / ${allTaskIds.length} tasks\n📝 All-time: ${totalLogged} tasks logged`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Unknown ────────────────────────────────────────────────────────────────
  await ctx.answerCbQuery("I didn't understand that — try /today");
}
