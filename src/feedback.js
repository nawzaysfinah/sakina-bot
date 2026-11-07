// User feedback collection and admin broadcast.

import { supabase } from './db.js';

// ── /feedback <text> ───────────────────────────────────────────────────────────

export async function handleFeedback(ctx) {
  const text = ctx.message.text.replace(/^\/feedback\s*/i, '').trim();
  if (!text) {
    return ctx.reply(
      '📝 *Send us feedback:*\n\nUsage: `/feedback <your message>`\n\n_Tell us what\'s working, what\'s not, or what you wish Sakina could do._',
      { parse_mode: 'Markdown' },
    );
  }

  await supabase.from('feedback').insert({
    user_id: ctx.from.id,
    message: text,
  });

  // Optionally create a GitHub issue if GITHUB_TOKEN + GITHUB_REPO are set
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO; // e.g. "nawzaysfinah/sakina-bot"
  if (token && repo) {
    const name  = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'User';
    const title = `[Feedback] ${text.slice(0, 72)}${text.length > 72 ? '...' : ''}`;
    const body  = `**From:** ${name} (Telegram ID: \`${ctx.from.id}\`)\n**Date:** ${new Date().toISOString()}\n\n---\n\n${text}`;
    await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, labels: ['user-feedback'] }),
    }).catch(() => {}); // non-blocking — feedback is already in DB
  }

  return ctx.reply('Thanks! Your feedback has been logged. We review it regularly and use it to improve Sakina 🌿');
}

// ── /announce <message> ─────────────────────────────────────────────────────────
// Admin-only broadcast to all users who have a chat_id.

function isAdmin(ctx) {
  const adminId = process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : null;
  return adminId && ctx.from.id === adminId;
}

export async function handleAnnounce(ctx, bot) {
  if (!isAdmin(ctx)) return ctx.reply('Not authorised.');

  const message = ctx.message.text.replace(/^\/announce\s*/i, '').trim();
  if (!message) {
    return ctx.reply('Usage: /announce <message>\n\nSupports Markdown formatting.');
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, chat_id')
    .not('chat_id', 'is', null);

  let sent = 0, failed = 0;
  for (const user of users || []) {
    try {
      await bot.telegram.sendMessage(user.chat_id || user.id, message, { parse_mode: 'Markdown' });
      sent++;
    } catch {
      failed++;
    }
  }
  return ctx.reply(`📣 Sent to ${sent} user${sent !== 1 ? 's' : ''}${failed ? ` (${failed} failed)` : ''}.`);
}
