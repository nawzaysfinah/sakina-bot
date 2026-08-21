# 🌿 Sakina Telegram Bot

A daily wellness companion for pregnancy, postpartum recovery, and baby development — delivered via Telegram.

---

## Features

| Mode | Description |
|------|-------------|
| 🌱 **Prepare** | Week-by-week birth preparation tasks (Weeks 32–40) with weekend tasks and daily habits |
| 🌿 **Recover** | Daily postpartum recovery schedule (Days 1–44) with jamu, rest, and movement targets |
| 🌸 **Tumbuh** | Evidence-based baby development activities (0–12 months): motor, social, and cognitive |

- **Daily 8am briefing** — personalised task list sent every morning
- **7pm evening check-in** — tracks remaining tasks and celebrates completion
- **Natural language logging** — "I did tummy time and sang songs" → Claude matches to task IDs
- **Multi-user** — each user has their own profile and progress tracked in Supabase

---

## Architecture

```
src/
  bot.js              ← Telegraf entry point (webhook + polling fallback)
  scheduler.js        ← node-cron: 8am briefing, 7pm check-in
  db.js               ← Supabase client (users + task_completions)
  handlers/
    message.js        ← Incoming message router + natural language task logging
    callbacks.js      ← Inline keyboard button handlers
    onboarding.js     ← Multi-step registration flow
  services/
    content.js        ← Mode-specific task content + daily briefing formatter
    claude.js         ← Haiku: task parsing + empathetic log responses
  data/
    birthPlan.json    ← 9 weeks × weekend tasks + daily habits
    babyDev.json      ← 6 phases × 12 week-periods × motor/social/cognitive tasks
```

---

## Setup

### 1. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy your **BOT_TOKEN**

### 2. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the schema:

```sql
-- Copy and paste the contents of supabase_schema.sql
```

3. Copy your **Project URL** and **service_role** key (Settings → API)

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=your_bot_token_from_botfather
ANTHROPIC_API_KEY=your_anthropic_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
WEBHOOK_URL=                    # leave empty for local dev (uses polling)
PORT=3000
```

### 4. Install and Run Locally

```bash
npm install
npm start
```

The bot starts in **polling mode** when `WEBHOOK_URL` is not set — perfect for local development.

---

## Deploy to Railway

1. Push this project to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Set environment variables in Railway's dashboard:
   - `BOT_TOKEN`
   - `ANTHROPIC_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `WEBHOOK_URL` → your Railway service URL (e.g. `https://sakina-bot-production.up.railway.app`)
   - `PORT=3000`
4. Railway auto-detects Node.js and runs `npm start`

The bot switches to **webhook mode** automatically when `WEBHOOK_URL` is set.

---

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Register and choose your mode |
| `/today` | See today's task list |
| `/progress` | See your completion count |
| `/switch` | Change mode |
| `/help` | Show help |

Or just **tell the bot what you've done** — it uses Claude to match your message to tasks:

> "I did tummy time and read a book to the baby"  
> → Logs `w1-m1` and `w1-c2` automatically ✅

---

## Tech Stack

- **Telegraf v4** — Telegram bot framework
- **Claude Haiku** (`claude-haiku-4-5-20251001`) — NLP task parsing + warm responses
- **Supabase** — PostgreSQL database for multi-user state
- **node-cron** — Scheduled daily briefings
- **Node.js 18+** — ES modules throughout

---

## Database Schema

See [`supabase_schema.sql`](./supabase_schema.sql) for the full schema.

Two tables:
- `users` — profile, mode, dates, onboarding state
- `task_completions` — (user_id, task_id, mode) with unique constraint to prevent duplicates
