# 🌿 Sakina Telegram Bot

A daily wellness companion for pregnancy, postpartum recovery, and baby development — delivered via Telegram.

---

## Features

| Mode | Description |
|------|-------------|
| 🌱 **Prepare** | Week-by-week birth preparation tasks (Weeks 32–40) with weekend tasks and daily habits |
| 🌿 **Recover** | Daily postpartum recovery schedule (Days 1–44) with jamu, rest, and movement targets |
| 🌸 **Tumbuh** | Evidence-based baby development activities (0–12 months): motor, social, and cognitive |

- **Daily 8am briefing** — personalised task list sent every morning, including any reminders due that day
- **7pm evening check-in** — tracks remaining tasks and celebrates completion
- **Natural language task logging** — "I did tummy time and sang songs" → Gemini matches to task IDs automatically
- **Natural language reminders** — "Remind me on Friday to call the hospital" → saved to database, shown in morning briefing
- **Multi-user** — each user has their own profile and progress tracked in Supabase

---

## Commands

| Command | Description |
|---------|-------------|
| `/today` | 📋 See today's tasks |
| `/tip` | 💡 Get a wellness tip for today |
| `/week` | 📅 See your current week or day summary |
| `/progress` | 📊 See your completion count |
| `/reminders` | 📌 View and manage your reminders |
| `/switch` | 🔄 Switch mode (Prepare / Recover / Tumbuh) |
| `/about` | ℹ️ What is Sakina? |
| `/reset` | ⚠️ Reset your profile and start fresh |
| `/start` | ▶️ Register or restart onboarding |

### Natural language — no commands needed

**Log tasks:**
> "I did tummy time and read a book to the baby"
> → Logs matching tasks automatically ✅

**Set reminders:**
> "Remind me on Friday to call the hospital"
> "Add a reminder for 10 Sep to pack my hospital bag"
> "Remember to check baby weight next Monday"
> → Saved to database, confirmed with parsed date 📌

---

## Architecture

```
src/
  bot.js              ← Telegraf entry point (webhook + polling fallback)
  scheduler.js        ← node-cron: 8am briefing, 7pm check-in
  db.js               ← Supabase client (users, task_completions, reminders)
  handlers/
    message.js        ← Message router: reminder intent → task logging → fallback
    callbacks.js      ← Inline keyboard button handlers
    onboarding.js     ← Multi-step registration flow
    commands.js       ← /about, /week, /tip, /reset, /reminders
  services/
    content.js        ← Mode-specific task content + daily briefing formatter
    claude.js         ← Gemini: task parsing + empathetic log responses
    reminders.js      ← Gemini: reminder intent detection + date resolution
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
2. Go to **SQL Editor** and run both schema files in order:

```sql
-- 1. Core schema
-- paste contents of supabase_schema.sql

-- 2. Reminders table
-- paste contents of supabase_reminders.sql
```

3. Copy your **Project URL** and **service_role** key (Settings → API)

### 3. Get a Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click **Get API key → Create API key**
3. Copy the key (starts with `AIza...`)

### 4. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=your_bot_token_from_botfather
GEMINI_API_KEY=your_gemini_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
WEBHOOK_URL=                    # leave empty for local dev (uses polling)
PORT=3000
```

### 5. Install and Run Locally

```bash
npm install
npm start
```

The bot starts in **polling mode** when `WEBHOOK_URL` is not set — perfect for local development.

---

## Deploy to Railway

1. Push this project to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in Railway's **Variables** tab:
   - `BOT_TOKEN`
   - `GEMINI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `PORT=3000`
4. Go to **Settings → Networking → Generate Domain** — copy the URL
5. Add one more variable: `WEBHOOK_URL=https://your-service.up.railway.app`
6. Railway redeploys automatically in webhook mode

---

## Tech Stack

- **Telegraf v4** — Telegram bot framework
- **Google Gemini** (`gemini-3.5-flash-lite`) — NLP task matching, reminder intent detection, warm responses
- **Supabase** — PostgreSQL database for multi-user state
- **node-cron** — Scheduled daily briefings (8am + 7pm SGT)
- **Node.js 18+** — ES modules throughout, no build step

---

## Database Schema

Three tables — run both SQL files in Supabase:

| File | Table | Purpose |
|------|-------|---------|
| `supabase_schema.sql` | `users` | Profile, mode, dates, onboarding state |
| `supabase_schema.sql` | `task_completions` | (user_id, task_id, mode) — deduplicated completions |
| `supabase_reminders.sql` | `reminders` | (user_id, text, remind_on, done) — custom reminders |
