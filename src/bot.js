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
import {
  handleAbout, handleWeek, handleTip, handleReset, handleReminders,
  handleUrgent, handleUndo, handleShare, handleView,
} from './handlers/commands.js';
import { initScheduler } from './scheduler.js';
import { supabase } from './db.js';
import { registerBabyLog } from './babyLog/index.js';
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

// ── Baby log — register BEFORE any other photo handler ─────────────────────────

const babyLog = registerBabyLog(bot, {
  supabase,
  miniAppUrl:     process.env.MINIAPP_URL,
  botToken:       process.env.BOT_TOKEN,
  miniAppBasePath: '/app',
});

// ── Commands ───────────────────────────────────────────────────────────────────

bot.start(ctx    => handleMessage(ctx));
bot.help(ctx     => handleMessage(ctx));
bot.command('today',     ctx => handleMessage(ctx));
bot.command('progress',  ctx => handleMessage(ctx));
bot.command('switch',    ctx => handleMessage(ctx));
bot.command('about',     ctx => handleAbout(ctx));
bot.command('week',      ctx => handleWeek(ctx));
bot.command('tip',       ctx => handleTip(ctx));
bot.command('reset',     ctx => handleReset(ctx));
bot.command('reminders', ctx => handleReminders(ctx));
bot.command('urgent',    ctx => handleUrgent(ctx));
bot.command('undo',      ctx => handleUndo(ctx));
// /log is registered by babyLog's registerTapLog (tap.js)
bot.command('share',     ctx => handleShare(ctx));
bot.command('view',      ctx => handleView(ctx));
bot.command('help',      ctx => handleMessage(ctx));

// ── Text messages ──────────────────────────────────────────────────────────────

bot.on(message('text'), ctx => handleMessage(ctx));

// ── Inline button callbacks ────────────────────────────────────────────────────

bot.on('callback_query', ctx => handleCallback(ctx));

// ── Register command menu (shown in Telegram's "/" menu) ───────────────────────

bot.telegram.setMyCommands([
  { command: 'today',     description: "📋 See today's tasks" },
  { command: 'tip',       description: '💡 Get a wellness tip for today' },
  { command: 'week',      description: '📅 See your current week or day summary' },
  { command: 'progress',  description: '📊 See completion count + streak' },
  { command: 'switch',    description: '🔄 Switch mode (Prepare / Recover / Tumbuh)' },
  { command: 'log',       description: '📔 Baby log: quick-tap feed / sleep / diaper' },
  { command: 'scan',      description: '📷 Scan the notebook page' },
  { command: 'dashboard', description: '📊 Open the baby log dashboard' },
  { command: 'newbaby',   description: '🤍 Set up a baby profile' },
  { command: 'reminders', description: '📌 View and manage your reminders' },
  { command: 'urgent',    description: '🚨 Emergency danger signs & contacts' },
  { command: 'undo',      description: '↩️ Unmark last logged task' },
  { command: 'share',     description: '🔗 Share your journal with partner/doula' },
  { command: 'about',     description: 'ℹ️ What is Sakina?' },
  { command: 'reset',     description: '⚠️ Reset your profile and start fresh' },
  { command: 'start',     description: '▶️ Restart onboarding' },
]);

// ── Start bot ──────────────────────────────────────────────────────────────────

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT        = parseInt(process.env.PORT || '3000', 10);

async function start() {
  // Start scheduler (daily briefings + health checks)
  initScheduler(bot, { babyLog, supabase });

  if (WEBHOOK_URL) {
    // ── Webhook mode (production) ────────────────────────────────────────────
    const webhookPath = `/bot${process.env.BOT_TOKEN}`;
    await bot.telegram.setWebhook(`${WEBHOOK_URL}${webhookPath}`);

    const webhookHandler = bot.webhookCallback(webhookPath);
    const server = http.createServer((req, res) => {
      // Route /app/* to the Mini App handler; everything else to webhook
      if (babyLog.miniApp && req.url && (req.url === '/app' || req.url.startsWith('/app/'))) {
        return babyLog.miniApp(req, res, () => { res.statusCode = 404; res.end('Not found'); });
      }
      return webhookHandler(req, res);
    });
    server.listen(PORT, () => {
      console.log(`🤖 Sakina bot started via webhook on port ${PORT}`);
      console.log(`   Webhook: ${WEBHOOK_URL}${webhookPath}`);
      if (process.env.MINIAPP_URL) console.log(`   Mini App: ${process.env.MINIAPP_URL}`);
    });
  } else {
    // ── Polling mode (local dev) ─────────────────────────────────────────────
    await bot.launch();
    console.log('🤖 Sakina bot started via polling (local dev mode)');
    // Serve Mini App on a local HTTP server even in polling mode
    if (babyLog.miniApp) {
      http.createServer((req, res) => {
        if (req.url === '/app' || req.url.startsWith('/app/')) {
          return babyLog.miniApp(req, res, () => { res.statusCode = 404; res.end('Not found'); });
        }
        res.statusCode = 404; res.end('Not found');
      }).listen(PORT, () => console.log(`   Mini App dev server: http://localhost:${PORT}/app/`));
    }
  }

  // Graceful shutdown
  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

start().catch(err => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});
