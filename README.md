# 🌿 Sakina Telegram Bot

A daily wellness companion for pregnancy, postpartum recovery, and baby development — delivered via Telegram.

> _Sakina_ (سكينة) — Arabic for tranquility, calm, and the divine peace that descends in difficulty.

---

## Features

### Wellness modes

| Mode | Description |
|------|-------------|
| 🌱 **Prepare** | Week-by-week birth preparation tasks (Weeks 32–40) with weekend tasks and daily habits |
| 🌿 **Recover — Vaginal** | Days 1–44 postpartum recovery: jamu, rest, pelvic floor, urutan massage |
| 🔷 **Recover — C-section** | Distinct surgical recovery track: wound care, mobility restrictions, scar massage from Day 21 |
| 🌸 **Tumbuh** | Milestone-gated baby development activities (0–12 months): motor, social, cognitive |

### Baby log (tap-based)

`/log` opens a real-time dashboard you tap to log — no typing required.

- **Feed** — breastfeed (latch: side + duration) or bottle/expressed milk (ml)
- **Sleep** — start/end a sleep session; open sessions tracked in real time
- **Diaper** — wet, dirty, or both
- **Status view** — shows the last event per category with the clock time it happened, plus today's running totals:
  - 🍼 feeds · total ml · total latch time
  - 😴 sleep duration today
  - 🧷 wet count (W) · dirty count (D)
- **Next-feed deadline** — ⏰ feed by `HH:MMam/pm` (last feed + 3 hours); shows "feed overdue" if past
- **Day summary** — pinned at the top of the dashboard

### Paper notebook scanning

`/scan` — photograph your sleep/feed notebook pages. The bot reads the grid using Gemini Vision, confirms the rows found, and saves them to the database. Paper data always wins over tap data for the same day.

### Multi-caregiver support

`/newbaby` creates a baby profile. Share the join code with a partner using `/joinbaby CODE` — both caregivers can log and the status shows who logged last.

### Clinical features

- **EPDS mood screening** — Edinburgh Postnatal Depression Scale at Day 7, 14, and 30 after baby_dob. Score-based guidance and referral for high-risk results (Q10 > 0 always escalates)
- **Vaccination reminders** — automatic 3-day alerts before each Singapore NCIS milestone
- **Newborn alerts** — if baby is ≤ 14 days old: warns when last feed > 3 h ago; warns if no diaper logged in 3 h
- **/urgent** — always-accessible emergency command with A&E criteria, C-section-specific warning signs, and baby danger signs with Singapore helpline numbers
- **Streak counter** — consecutive days of activity shown in morning briefing and progress
- **Weekly Sunday summary** — automated weekly check-in with mode context
- **Timezone-aware scheduling** — briefings sent at each user's local 8am/7pm

### Other

- **Partner access** — `/share` generates a 6-character code; partner views your daily briefing read-only via `/view`
- **/undo** — unmark the last logged task
- **NLP task logging** — "I did tummy time and read to the baby" → matches and logs tasks automatically
- **NLP reminders** — "Remind me Friday to call the hospital" → parsed, saved, confirmed with date
- **Better fallback** — when no task matches, shows examples from your pending tasks

---

## Commands

| Command | Description |
|---------|-------------|
| `/today` | 📋 See today's tasks |
| `/tip` | 💡 Get a wellness tip for today |
| `/week` | 📅 See your current week or day summary |
| `/progress` | 📊 Completion count + streak |
| `/switch` | 🔄 Switch mode (Prepare / Recover / Tumbuh) |
| `/log` | 📔 Baby log: tap to record feed / sleep / diaper |
| `/dashboard` | 📊 Baby log dashboard — recent events + day summary |
| `/scan` | 📷 Scan a notebook page (Gemini Vision OCR) |
| `/newbaby` | 🤍 Set up a baby profile |
| `/joinbaby` | 🤝 Join an existing baby profile with a code |
| `/reminders` | 📌 View and manage your reminders |
| `/urgent` | 🚨 Emergency danger signs & Singapore contacts |
| `/undo` | ↩️ Unmark last logged task |
| `/share` | 🔗 Generate partner/doula read-only access code |
| `/view` | 👀 View a shared briefing (partner use) |
| `/about` | ℹ️ What is Sakina? |
| `/reset` | ⚠️ Reset your profile and start fresh |
| `/start` | ▶️ Register or restart onboarding |

### Natural language

**Log tasks:**
> "I did tummy time and read a book to the baby"
> → Logs matching tasks automatically ✅

**Set reminders:**
> "Remind me on Friday to call the hospital"
> "Add a reminder for 10 Sep to pack my hospital bag"
> → Saved to database, confirmed with parsed date 📌

---

## Architecture

```
src/
  bot.js              ← Telegraf entry point (webhook + polling fallback)
                         HTTP server with /health endpoint for keep-alive pinging
  scheduler.js        ← Hourly cron: morning/evening per user timezone
                         Sunday weekly summary
                         Daily: EPDS prompts + vaccination reminders
  db.js               ← Supabase: users, task_completions, reminders,
                         health_logs, epds_sessions, milestone_completions,
                         share_tokens, baby_events, paper_rows, paper_scans,
                         user_log_messages
  handlers/
    message.js        ← Router: EPDS intercept → reminder → task log → fallback
    callbacks.js      ← Inline keyboard: mode, delivery type, EPDS, milestone advance
    onboarding.js     ← Multi-step: start → mode → delivery_type → date → done
    commands.js       ← /about /week /tip /reset /reminders /urgent /undo /share /view
  services/
    content.js        ← Mode content + two recover tracks + milestone gating
                         Vaccination schedule (NCIS)
    claude.js         ← Gemini: task parsing + empathetic responses
    reminders.js      ← Gemini: reminder intent detection + date resolution
  babyLog/
    index.js          ← Registers all baby log handlers with the bot instance
    tap.js            ← /log and /dashboard command handlers; keyboard UI; sleep toggle
    format.js         ← statusLine(), daySummary(), clock(), span(), ageText()
    scan.js           ← /scan photo collection → Gemini Vision OCR → review → save
    query.js          ← Supabase helpers: baby lookup, event CRUD, status fetch
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
4. supabase_baby_log.sql    — baby_events, paper_rows, paper_scans, user_log_messages + RPCs
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

## Deploy to Render

1. Push this project to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service → connect your repo
3. Set **Build Command** to `npm install` and **Start Command** to `npm start`
4. Add environment variables in Render's **Environment** tab:
   - `BOT_TOKEN`
   - `GEMINI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `PORT=3000`
5. Once deployed, copy the service URL (e.g. `https://sakina-bot.onrender.com`)
6. Add one more variable: `WEBHOOK_URL=https://sakina-bot.onrender.com`
7. Render redeploys automatically in webhook mode

> **Keeping the service warm:** Render free-tier services sleep after ~15 min of inactivity. Set up [UptimeRobot](https://uptimerobot.com) to ping `https://your-service.onrender.com/health` every 5 minutes to prevent cold-starts.

---

## Database Schema

Run SQL files in Supabase in this order:

| File | Tables | Purpose |
|------|--------|---------|
| `supabase_schema.sql` | `users`, `task_completions` | Core profile + task tracking |
| `supabase_reminders.sql` | `reminders` | Custom date-based reminders |
| `supabase_v3.sql` | `health_logs`, `epds_sessions`, `milestone_completions`, `share_tokens` | Health tracking, mood screening, milestone gating, partner access |
| `supabase_baby_log.sql` | `baby_events`, `paper_rows`, `paper_scans`, `user_log_messages` | Tap log, notebook scanning, status tracking |

The `supabase_baby_log.sql` file also creates:

- `baby_status(p_baby)` RPC — returns last feed/sleep/diaper + today's totals (feeds, ml, latch_min, sleep_min, wet, dirty) in one query
- `baby_grid()` / `baby_days()` / `baby_averages()` — sleep/feed grid and statistics
- `sgt_row_date(ts)` — maps a timestamp to a notebook row date (day starts 7pm SGT)
- `baby_events_effective` view — paper data wins over tap data for confirmed days

### New columns added to `users` (v3)

| Column | Type | Purpose |
|--------|------|---------|
| `delivery_type` | text | `'vaginal'` or `'cesarean'` — selects recovery track |
| `streak_days` | int | Consecutive days with ≥1 task logged |
| `last_active_date` | date | Last day a task was completed |
| `tumbuh_week_id` | text | Override for milestone-gated Tumbuh (null = auto by age) |
| `baby_name` | text | Baby's name (set via /newbaby) |
| `baby_join_code` | text | Unique code for partner to join via /joinbaby |

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

- **Telegraf v4** — Telegram bot framework (ES modules)
- **Google Gemini** (`gemini-3.5-flash-lite`) — NLP task matching, reminder intent, notebook OCR, warm responses
- **Supabase** — PostgreSQL database with RPC functions for multi-user state
- **node-cron** — Hourly cron with per-user timezone support
- **Node.js 22+** — ES modules throughout, no build step
- **Intl.DateTimeFormat** — Timezone-aware scheduling (no external packages)
