# 🌿 Sakina Telegram Bot

A daily wellness companion for pregnancy, postpartum recovery, and baby development — delivered via Telegram.

> _Sakina_ (سكينة) — Arabic for tranquility, calm, and the divine peace that descends in difficulty.

---

## Features

| Mode | Description |
|------|-------------|
| 🌱 **Prepare** | Week-by-week birth preparation tasks (Weeks 32–40) with weekend tasks and daily habits |
| 🌿 **Recover — Vaginal** | Days 1–44 postpartum recovery: jamu, rest, pelvic floor, urutan massage |
| 🔷 **Recover — C-section** | Distinct surgical recovery track: wound care, mobility restrictions, scar massage from Day 21 |
| 🌸 **Tumbuh** | Milestone-gated baby development activities (0–12 months): motor, social, cognitive |

### Clinical improvements (v2)

- **Two recovery tracks** — vaginal and cesarean are fundamentally different. C-section is major abdominal surgery and gets a medically accurate schedule (bed rest Days 1–3, no lifting throughout, scar massage Day 21+, jamu from Day 15)
- **Milestone-gated Tumbuh** — advance through developmental phases yourself when ready, rather than auto-advancing by age
- **EPDS mood screening** — Edinburgh Postnatal Depression Scale offered at Day 7, 14, and 30. Score-based guidance and referral for high-risk results
- **Health log** — track breastfeeds, bottle feeds (ml), baby weight (with low-weight alert), and nappy count (with dehydration alert if <6 wet/day after Day 5)
- **Vaccination reminders** — automatic 3-day alerts before each Singapore NCIS vaccination milestone
- **/urgent danger signs** — always-accessible emergency command with A&E criteria, C-section-specific warning signs, and baby danger signs with Singapore helpline numbers
- **Streak counter** — consecutive days of activity shown in morning briefing and progress
- **Weekly Sunday summary** — automated weekly check-in with mode context
- **Timezone-aware scheduling** — briefings sent at each user's local 8am/7pm (reads `timezone` from user profile)
- **Partner access** — generate a 6-character share code; partner views your daily briefing read-only via `/view`
- **/undo command** — unmark the last logged task if you tapped the wrong one
- **Better fallback** — when no task matches, shows examples from your pending tasks and offers a contextual button

---

## Commands

| Command | Description |
|---------|-------------|
| `/today` | 📋 See today's tasks |
| `/tip` | 💡 Get a wellness tip for today |
| `/week` | 📅 See your current week or day summary |
| `/progress` | 📊 Completion count + streak |
| `/switch` | 🔄 Switch mode (Prepare / Recover / Tumbuh) |
| `/reminders` | 📌 View and manage your reminders |
| `/urgent` | 🚨 Emergency danger signs & Singapore contacts |
| `/undo` | ↩️ Unmark last logged task |
| `/log` | 📊 Log feeding, weight, or nappy count |
| `/share` | 🔗 Generate partner/doula read-only access code |
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
> → Saved to database, confirmed with parsed date 📌

**Log health data:**
```
/log feed breast 15 left   → breastfeed 15 min, left side
/log feed bottle 80        → bottle feed 80ml
/log weight 3.5kg          → baby weight (flags if <2.5kg)
/log nappy wet             → wet nappy (alerts if <6/day after Day 5)
/log nappy dirty           → dirty nappy
/log summary               → today's full health log
```

**Partner access:**
```
/share         → generates a 6-char code (30-day expiry)
/view XXXXXX   → partner views owner's daily briefing
```

---

## Architecture

```
src/
  bot.js              ← Telegraf entry point (webhook + polling fallback)
  scheduler.js        ← Hourly cron: morning/evening per user timezone
                         Sunday weekly summary
                         Daily: EPDS prompts + vaccination reminders
  db.js               ← Supabase: users, task_completions, reminders,
                         health_logs, epds_sessions, milestone_completions,
                         share_tokens
  handlers/
    message.js        ← Router: EPDS intercept → reminder → task log → fallback
    callbacks.js      ← Inline keyboard: mode, delivery type, EPDS, milestone advance
    onboarding.js     ← Multi-step: start → mode → delivery_type → date → done
    commands.js       ← /about /week /tip /reset /reminders /urgent /undo /log /share
  services/
    content.js        ← Mode content + two recover tracks + milestone gating
                         Vaccination schedule (NCIS)
    claude.js         ← Gemini: task parsing + empathetic responses
    reminders.js      ← Gemini: reminder intent detection + date resolution
  data/
    birthPlan.json    ← 9 weeks × weekend tasks + daily habits
    babyDev.json      ← 6 phases × 13 week-periods × motor/social/cognitive tasks
```

---

## Setup

### 1. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy your **BOT_TOKEN**

### 2. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the schema files **in order**:

```
1. supabase_schema.sql      — users + task_completions
2. supabase_reminders.sql   — reminders table
3. supabase_v3.sql          — delivery_type, health_logs, EPDS, milestone_completions, share_tokens
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

## Database Schema

Run SQL files in Supabase in this order:

| File | Tables | Purpose |
|------|--------|---------|
| `supabase_schema.sql` | `users`, `task_completions` | Core profile + task tracking |
| `supabase_reminders.sql` | `reminders` | Custom date-based reminders |
| `supabase_v3.sql` | `health_logs`, `epds_sessions`, `milestone_completions`, `share_tokens` | Health tracking, mood screening, milestone gating, partner access |

### New columns added to `users` (v3)

| Column | Type | Purpose |
|--------|------|---------|
| `delivery_type` | text | `'vaginal'` or `'cesarean'` — selects recovery track |
| `streak_days` | int | Consecutive days with ≥1 task logged |
| `last_active_date` | date | Last day a task was completed |
| `tumbuh_week_id` | text | Override for milestone-gated Tumbuh (null = auto by age) |

---

## Onboarding Flow

```
/start
  └─ Mode selection (inline keyboard)
      ├─ 🌱 Prepare  → What is your due date? (DD/MM/YYYY)
      │                  → done
      ├─ 🌿 Recover  → How was your baby born? (vaginal / cesarean)
      │                  → What is your baby's date of birth?
      │                  → done
      └─ 🌸 Tumbuh   → What is your baby's date of birth?
                        → done
```

---

## EPDS Screening

The Edinburgh Postnatal Depression Scale runs automatically at **Day 7, 14, and 30** after baby's date of birth:

- 10 questions via inline keyboard buttons
- Score range: 0–30
- Score ≥ 13: high-risk guidance + IMH/SSO contact numbers
- Score 10–12: moderate — advise GP consultation
- Question 10 (self-harm) score > 0: always escalate regardless of total score

---

## Vaccination Schedule (Singapore NCIS)

Automatic reminders 3 days before each milestone:

| Age | Vaccines |
|-----|---------|
| Birth | Hep B (dose 1) |
| 1 month | Hep B (dose 2) |
| 2 months | DTaP + IPV + PCV + Hib + Rota |
| 4 months | DTaP + IPV + PCV + Hib + Rota |
| 6 months | DTaP + IPV + Hep B + PCV + Hib + Influenza |
| 12 months | MMR + Varicella + Hep A |
| 18 months | DTaP + IPV booster + MMR |

---

## Tech Stack

- **Telegraf v4** — Telegram bot framework
- **Google Gemini** (`gemini-3.5-flash-lite`) — NLP task matching, reminder intent detection, warm responses
- **Supabase** — PostgreSQL database for multi-user state
- **node-cron** — Hourly cron with per-user timezone support
- **Node.js 18+** — ES modules throughout, no build step
- **Intl.DateTimeFormat** — Timezone-aware scheduling (no external packages)
