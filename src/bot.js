/**
 * Sakina Telegram Bot — main entry point.
 *
 * Architecture:
 *   - Webhook-based (better for production/Railway than polling)
 *   - Falls back to polling when WEBHOOK_URL is not set (local dev)
 *   - Telegraf v4, ES modules
 */

import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { message }  from 'telegraf/filters';
import { handleMessage }  from './handlers/message.js';
import { handleCallback } from './handlers/callbacks.js';
import { initScheduler }  from './scheduler.js';
import http from 'http';

// ── Bot setup ──────────────────────────────────────────────────────────────────

if (!process.env.BOT_TOKEN) {
  console.error('❌  BOT_TOKEN is required');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// ── Middleware — global error handler ──────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`Error handling update ${ctx.updateType}:`, err);
  ctx.reply('Something went wrong — please try again in a moment 🌿').catch(() => {});
});

// ── Commands ───────────────────────────────────────────────────────────────────

bot.start(ctx => handleMessage(ctx));
bot.help(ctx  => handleMessage(ctx));
bot.command('today',    ctx => handleMessage(ctx));
bot.command('progress', ctx => handleMessage(ctx));
bot.command('switch',   ctx => handleMessage(ctx));

// ── Text messages ──────────────────────────────────────────────────────────────

bot.on(message('text'), ctx => handleMessage(ctx));

// ── Inline button callbacks ────────────────────────────────────────────────────

bot.on('callback_query', ctx => handleCallback(ctx));

// ── Register command menu (shown in Telegram's "/" menu) ───────────────────────

bot.telegram.setMyCommands([
  { command: 'start',    description: 'Start or restart Sakina' },
  { command: 'today',    description: "See today's tasks" },
  { command: 'progress', description: 'See your completion count' },
  { command: 'switch',   description: 'Switch mode (Prepare / Recover / Tumbuh)' },
  { command: 'help',     description: 'Show help' },
]);

// ── Start bot ──────────────────────────────────────────────────────────────────

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT        = parseInt(process.env.PORT || '3000', 10);

async function start() {
  // Start scheduler (daily briefings)
  initScheduler(bot);

  if (WEBHOOK_URL) {
    // ── Webhook mode (production) ────────────────────────────────────────────
    const webhookPath = `/bot${process.env.BOT_TOKEN}`;
    await bot.telegram.setWebhook(`${WEBHOOK_URL}${webhookPath}`);

    const server = http.createServer(bot.webhookCallback(webhookPath));
    server.listen(PORT, () => {
      console.log(`🤖 Sakina bot started via webhook on port ${PORT}`);
      console.log(`   Webhook: ${WEBHOOK_URL}${webhookPath}`);
    });
  } else {
    // ── Polling mode (local dev) ─────────────────────────────────────────────
    await bot.launch();
    console.log('🤖 Sakina bot started via polling (local dev mode)');
    console.log('   Set WEBHOOK_URL in .env to switch to webhook mode');
  }

  // Graceful shutdown
  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

start().catch(err => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});
