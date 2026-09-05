/**
 * Onboarding flow — collects mode, delivery type, and dates.
 * Steps: start → mode → [delivery_type (recover only)] → date → done
 */

import { upsertUser } from '../db.js';
import { Markup } from 'telegraf';

export async function handleOnboarding(ctx, step) {
  const userId = ctx.from.id;
  const text   = ctx.message?.text?.trim() || '';

  // ── Step: start ───────────────────────────────────────────────────────────
  if (step === 'start') {
    await upsertUser(userId, {
      chat_id:    ctx.chat.id,
      name:       ctx.from.first_name || 'Friend',
      onboarding: 'mode',
    });

    return ctx.reply(
      `Assalamualaikum ${ctx.from.first_name || 'there'} 🌿\n\nWelcome to *Sakina* — your daily wellness companion for pregnancy, postpartum, and baby development.\n\nWhich mode are you in right now?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🌱 Prepare — I\'m pregnant', 'mode_prepare')],
          [Markup.button.callback('🌿 Recover — I\'ve just given birth', 'mode_recover')],
          [Markup.button.callback('🌸 Tumbuh — tracking baby\'s development', 'mode_tumbuh')],
        ]),
      }
    );
  }

  // ── Step: delivery_type (recover mode only) ────────────────────────────────
  if (step === 'delivery_type') {
    // Waiting for inline keyboard response — handled in handleDeliveryTypeCallback
    return ctx.reply(
      `How was your baby born? This helps Sakina tailor your recovery plan correctly — C-section recovery is significantly different from vaginal birth and needs its own schedule.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🌿 Vaginal birth', 'delivery_vaginal')],
          [Markup.button.callback('🔷 C-section (cesarean)', 'delivery_cesarean')],
        ]),
      }
    );
  }

  // ── Step: due_date (prepare mode) ─────────────────────────────────────────
  if (step === 'due_date') {
    const parsed = parseDate(text);
    if (!parsed) {
      return ctx.reply('I couldn\'t read that date — please send it as DD/MM/YYYY (e.g. 15/11/2025)');
    }
    await upsertUser(userId, {
      chat_id:    ctx.chat.id,
      name:       ctx.from.first_name || 'Friend',
      due_date:   parsed,
      onboarding: 'done',
    });
    return ctx.reply(
      `✅ Got it! I'll send you your weekly birth preparation plan every morning at 8am.\n\nSend me a message any time to log what you've done, or use /today to see today's tasks.`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Step: baby_dob (recover / tumbuh) ─────────────────────────────────────
  if (step === 'baby_dob') {
    const parsed = parseDate(text);
    if (!parsed) {
      return ctx.reply('Please send the date as DD/MM/YYYY (e.g. 03/08/2025)');
    }
    await upsertUser(userId, {
      chat_id:    ctx.chat.id,
      name:       ctx.from.first_name || 'Friend',
      baby_dob:   parsed,
      onboarding: 'done',
    });
    return ctx.reply(
      `✅ Wonderful! I'll send your daily plan at 8am every morning.\n\nJust message me what you've done and I'll update your record automatically.\n\nTap /today to see today's tasks right now 🌿`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ── Callback handler for mode selection ───────────────────────────────────────

export async function handleModeCallback(ctx, mode) {
  const userId = ctx.from.id;

  const nextStep = mode === 'prepare'
    ? 'due_date'
    : mode === 'recover'
    ? 'delivery_type'   // ← new step for recover
    : 'baby_dob';

  await upsertUser(userId, {
    chat_id:    ctx.chat.id,
    name:       ctx.from.first_name || 'Friend',
    mode,
    onboarding: nextStep,
  });

  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  if (mode === 'recover') {
    // Don't ask for date yet — ask delivery type first
    return ctx.reply(
      `Great — *🌿 Recover* mode selected!\n\nHow was your baby born? This helps me give you the right recovery plan.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🌿 Vaginal birth', 'delivery_vaginal')],
          [Markup.button.callback('🔷 C-section (cesarean)', 'delivery_cesarean')],
        ]),
      }
    );
  }

  const modeLabel = { prepare: '🌱 Prepare', tumbuh: '🌸 Tumbuh' }[mode];
  await ctx.reply(`Great — *${modeLabel}* mode selected!\n\n${mode === 'prepare'
    ? 'What is your expected due date? Send it as DD/MM/YYYY.'
    : 'What is your baby\'s date of birth? Send it as DD/MM/YYYY.'}`,
    { parse_mode: 'Markdown' }
  );
}

// ── Callback handler for delivery type selection ───────────────────────────────

export async function handleDeliveryTypeCallback(ctx, deliveryType) {
  const userId = ctx.from.id;

  await upsertUser(userId, {
    chat_id:       ctx.chat.id,
    name:          ctx.from.first_name || 'Friend',
    delivery_type: deliveryType,
    onboarding:    'baby_dob',
  });

  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  const label = deliveryType === 'cesarean'
    ? '🔷 C-section recovery'
    : '🌿 Vaginal birth recovery';

  return ctx.reply(
    `${label} plan selected ✅\n\nWhat is your baby's date of birth? Send it as DD/MM/YYYY (e.g. 03/08/2025).`,
    { parse_mode: 'Markdown' }
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

function parseDate(text) {
  // Accepts DD/MM/YYYY or DD-MM-YYYY
  const match = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!match) return null;
  const [, d, m, y] = match;
  const date = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
  return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
}
