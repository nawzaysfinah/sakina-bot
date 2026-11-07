// Billing helpers — Telegram Stars payments + plan entitlement checks.
//
// Plan model:
//   free  — logging, today's dashboard, basic status
//   pro   — 🔮 Bayesian prediction, full overnight report, 7-day averages
//
// Stars pricing:
//   pro_monthly  — 299 Stars (~$3 SGD)

import { supabase } from './db.js';
import { Markup } from 'telegraf';

const PLANS = {
  pro_monthly: {
    stars:       299,
    label:       'Sakina Pro — 1 month',
    description: '🔮 Crystal-ball feed predictions, full overnight report with sleep estimates and attribution, 7-day trend averages.',
    days:        30,
    planKey:     'pro',
  },
};

// ── Entitlement ────────────────────────────────────────────────────────────────

export async function isPro(userId) {
  const { data } = await supabase
    .from('users')
    .select('plan, plan_expires_at')
    .eq('id', userId)
    .maybeSingle();
  if (!data || data.plan !== 'pro') return false;
  if (!data.plan_expires_at) return true; // lifetime (manual grant)
  return new Date(data.plan_expires_at) > new Date();
}

// ── Grant ──────────────────────────────────────────────────────────────────────

export async function grantPro(userId, days) {
  const expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
  await supabase
    .from('users')
    .update({ plan: 'pro', plan_expires_at: expiresAt })
    .eq('id', userId);
  return expiresAt;
}

// ── Record payment ─────────────────────────────────────────────────────────────

export async function recordPayment(userId, payment, planKey, expiresAt) {
  await supabase.from('payments').upsert({
    user_id:                   userId,
    telegram_payment_charge_id: payment.telegram_payment_charge_id,
    currency:                  payment.currency,
    total_amount:              payment.total_amount,
    invoice_payload:           payment.invoice_payload,
    plan_granted:              planKey,
    plan_expires_at:           expiresAt,
  }, { onConflict: 'telegram_payment_charge_id', ignoreDuplicates: true });
}

// ── Invoice sender ─────────────────────────────────────────────────────────────

export async function sendProInvoice(ctx) {
  const userId = ctx.from.id;

  // Already Pro — show status instead
  const { data: user } = await supabase
    .from('users')
    .select('plan, plan_expires_at')
    .eq('id', userId)
    .maybeSingle();

  if (user?.plan === 'pro') {
    const exp = user.plan_expires_at
      ? new Date(user.plan_expires_at).toLocaleDateString('en-SG', {
          day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore',
        })
      : 'lifetime';
    return ctx.reply(`✅ *You're already on Sakina Pro*\n\nValid until: ${exp}\n\n🔮 Feed predictions and full overnight reports are active.`, { parse_mode: 'Markdown' });
  }

  const plan = PLANS.pro_monthly;
  await ctx.replyWithInvoice({
    title:          plan.label,
    description:    plan.description,
    payload:        'pro_monthly',
    provider_token: '',          // empty = Telegram Stars
    currency:       'XTR',
    prices:         [{ label: plan.label, amount: plan.stars }],
  });
}

// ── Upsell message ─────────────────────────────────────────────────────────────

export function proUpsellKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Upgrade to Pro — 299 Stars/month', 'billing_pro')],
  ]);
}

export function proUpsellText(featureName) {
  return `_${featureName} is a Pro feature._\n\nPro unlocks:\n• 🔮 Crystal-ball feed timing\n• 🌙 Full overnight report with attribution\n• 📈 7-day trend averages\n\n299 Stars/month (~$3).`;
}

// ── Admin grant ───────────────────────────────────────────────────────────────
// /grantpro <userId> [days]  — owner-only, identified by ADMIN_USER_ID env var

export async function handleGrantPro(ctx) {
  const adminId = process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : null;
  if (!adminId || ctx.from.id !== adminId) {
    return ctx.reply('Not authorised.');
  }
  const parts = ctx.message.text.split(/\s+/);
  const targetId = Number(parts[1]);
  const days     = Number(parts[2] || 30);
  if (!targetId) return ctx.reply('Usage: /grantpro <userId> [days]');
  const expiresAt = await grantPro(targetId, days);
  const until = new Date(expiresAt).toLocaleDateString('en-SG', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore',
  });
  return ctx.reply(`✅ Pro granted to ${targetId} until ${until}.`);
}

// ── Payment event handlers ─────────────────────────────────────────────────────

export async function handlePreCheckout(ctx) {
  // Must answer within 10 s — answer immediately, validate payload
  const query = ctx.preCheckoutQuery;
  if (!PLANS[query.invoice_payload]) {
    return ctx.answerPreCheckoutQuery(false, 'Unknown plan. Please try again.');
  }
  return ctx.answerPreCheckoutQuery(true);
}

export async function handleSuccessfulPayment(ctx) {
  const payment = ctx.message.successful_payment;
  const userId  = ctx.from.id;
  const plan    = PLANS[payment.invoice_payload];
  if (!plan) return;

  const expiresAt = await grantPro(userId, plan.days);
  await recordPayment(userId, payment, plan.planKey, expiresAt);

  const until = new Date(expiresAt).toLocaleDateString('en-SG', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore',
  });
  await ctx.reply(
    `✅ *You're on Sakina Pro!*\n\nValid until ${until}.\n\n🔮 Feed predictions and overnight reports are now active.`,
    { parse_mode: 'Markdown' },
  );
}
