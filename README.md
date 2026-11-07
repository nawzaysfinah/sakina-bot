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
- **🤽 Pump** _(Pro)_ — log a pump session with optional ml amount; auto-sets the next pump reminder
- **Feed combos** _(Pro)_ — save formula+breast pairs (e.g. 90ml F + 60ml B) as one-tap buttons
- **Status view** — last event per category with time + today's running totals
- **Day summary** — multi-line breakdown: feeds, ml by type, sleep, diapers, volume vs. guidance
- **Next-feed window** _(Pro)_ — Bayesian prediction of when the next feed is due

### Bayesian feed predictor _(Pro)_

Computed in `src/babyLog/feedWindow.js` by blending volume and trend signals:

**Volume signal** — how much the baby took × digestion multiplier:

| Feed type | Multiplier | Rationale |
|-----------|-----------|-----------|
| Latch / Breast | 1.0× | Baseline |
| Formula | 1.25× | Digests slower |
| Combo | 1.1× | Mixed |

**Trend signal** — recency-weighted average of the baby's own inter-feed intervals, conditioned on feed type and time of day (overnight vs. day), with a 0.85× recency decay per older interval.

**Blending weights** adapt to data confidence:

| History depth | Volume weight | Trend weight |
|--------------|--------------|-------------|
| < 3 intervals | 100% | 0% |
| 3–5 intervals | 60% | 40% |
| 6+ intervals | 40% | 60% |

### Overnight report _(Pro)_

Sent at 7am SGT — combines the overnight summary + morning brief in one message:
- Estimated sleep from feed gaps (no manual sleep logging required)
- Longest stretch, number of wake-ups, total overnight feeds
- Feed list with times
- Postpartum recovery tip for the day (day-specific, not generic buckets)

Free users receive a basic feed count + Pro upsell.

### Paper notebook scanning

`/scan` — photograph your sleep/feed notebook pages. The bot reads the grid using Gemini Vision, confirms the rows found, and saves them. Paper data always wins over tap data for the same day.

### Multi-caregiver support

`/newbaby` creates a baby profile. Share the join code with a partner using `/joinbaby CODE` — both caregivers can log and the status shows who logged last.

### Clinical features

- **EPDS mood screening** — Edinburgh Postnatal Depression Scale at Day 7, 14, and 30. Score-based guidance; Q10 > 0 always escalates
- **Vaccination reminders** — 3-day alerts before each Singapore NCIS milestone
- **Newborn alerts** — if baby ≤ 14 days old: warns when last feed > 3h or no diaper in 3h
- **/urgent** — always-accessible emergency command with A&E criteria, C-section warning signs, and Singapore helpline numbers

### Feedback loop

`/feedback <text>` — users send feedback directly in the bot. Stored in Supabase `feedback` table. If `GITHUB_TOKEN` and `GITHUB_REPO` are set, automatically creates a GitHub issue titled `[Feedback] ...`.

---

## Plans

| Feature | Free | Pro |
|---------|------|-----|
| Feed / sleep / diaper logging | ✅ | ✅ |
| Today's dashboard | ✅ | ✅ |
| Basic +3h feed estimate | ✅ | ✅ |
| Wellness modes (Prepare / Recover / Tumbuh) | ✅ | ✅ |
| /feedback | ✅ | ✅ |
| 🔮 Bayesian feed prediction | — | ✅ |
| Full overnight report (sleep estimates + attribution) | — | ✅ |
| Feed combos (one-tap formula+breast) | — | ✅ |
| 🤽 Pump timer + reminders | — | ✅ |

**Pro costs 299 Telegram Stars/month (~$3 SGD).** Users pay with `/pro`; gift codes via `/giftpro`.

---

## Commands

| Command | Description |
|---------|-------------|
| `/today` | 📋 See today's tasks |
| `/tip` | 💡 Get a wellness tip |
| `/week` | 📅 Week or day summary |
| `/progress` | 📊 Completion count + streak |
| `/switch` | 🔄 Switch mode |
| `/log` | 📔 Baby log tap dashboard |
| `/dashboard` | 📊 Baby log dashboard |
| `/scan` | 📷 Scan a notebook page |
| `/newbaby` | 🤍 Set up a baby profile |
| `/joinbaby` | 🤝 Join with a code |
| `/weight` | ⚖️ Log baby weight (kg) |
| `/milestone` | 🌟 Log a baby milestone |
| `/reminders` | 📌 View and manage reminders |
| `/urgent` | 🚨 Emergency contacts |
| `/undo` | ↩️ Undo last logged event |
| `/share` | 🔗 Generate partner access code |
| `/view` | 👀 View a shared briefing |
| `/pro` | ⭐ Upgrade to Pro (Telegram Stars) |
| `/redeem` | 🎁 Redeem a Pro gift code |
| `/addcombo` | 🍶🍼 Pro: save a feed combo — `/addcombo 90 60 Name` |
| `/mycombos` | 🍶🍼 Pro: list saved combos |
| `/deletecombo` | 🗑 Pro: delete a saved combo |
| `/feedback` | 📝 Send feedback or feature request |
| `/about` | ℹ️ What is Sakina? |
| `/reset` | ⚠️ Reset profile |
| `/start` | ▶️ Register or restart onboarding |

### Admin-only commands

| Command | Description |
|---------|-------------|
| `/announce` | 📣 Broadcast a message to all users |
| `/grantpro` | ✅ Grant Pro to a user ID: `/grantpro <userId> [days]` |
| `/giftpro` | 🎁 Create a redeemable gift code: `/giftpro [days]` |

---

## Architecture

```
src/
  bot.js              ← Telegraf entry point (webhook + polling fallback)
  scheduler.js        ← Hourly cron: morning/evening briefings, feed/pump reminders,
                         7am overnight report, EPDS, vaccination reminders
  db.js               ← Supabase client
  billing.js          ← Telegram Stars payments: isPro(), grantPro(), sendProInvoice(),
                         handlePreCheckout(), handleSuccessfulPayment(),
                         gift codes (createGift/redeem), admin grant
  feedback.js         ← /feedback storage + GitHub issue creation
                         /announce admin broadcast
  handlers/
    message.js        ← Router: EPDS intercept → reminder → task log → fallback
    callbacks.js      ← Inline keyboard callbacks
    onboarding.js     ← Multi-step onboarding flow
    commands.js       ← Misc commands
  services/
    content.js        ← Mode content + recovery tracks + milestone gating
    claude.js         ← Gemini: NLP task matching + warm responses
    reminders.js      ← Gemini: reminder intent detection + date parsing
  babyLog/
    index.js          ← Registers all baby log handlers
    tap.js            ← /log dashboard: feed/sleep/diaper/pump/combo logging,
                         keyboards, inline callbacks, /weight /milestone
    format.js         ← statusLine(), daySummary(), clock(), span()
    feedWindow.js     ← Bayesian feed predictor (Pro)
    feedReminder.js   ← In-memory feed + pump reminder store
    combos.js         ← feed_combos CRUD helpers (Pro)
    brief.js          ← Morning brief + day-specific postpartum recovery tips
    scheduler.js      ← 7am overnight report + newborn feed alerts
    scan.js           ← /scan: photo OCR via Gemini Vision
    query.js          ← Supabase helpers: baby lookup, event CRUD, status fetch
  data/
    birthPlan.json
    babyDev.json
```

---

## Setup

### 1. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram → `/newbot`
2. Copy your **BOT_TOKEN**

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the SQL files **in order** in the SQL editor:

| File | Purpose |
|------|---------|
| `supabase_schema.sql` | `users`, `task_completions` |
| `supabase_reminders.sql` | `reminders` |
| `supabase_v3.sql` | `health_logs`, `epds_sessions`, `milestone_completions`, `share_tokens` |
| `supabase_baby_log.sql` | `baby_events`, `paper_rows`, `paper_scans`, RPCs |
| `supabase_billing.sql` | `payments` table, `plan` / `plan_expires_at` on `users` |
| `supabase_gift_codes.sql` | `gift_codes` table |
| `supabase_new_features.sql` | `feedback`, `feed_combos`, `pump_interval_hours` on `users` |

3. Copy your **Project URL** and **service_role key** (Settings → API)

### 3. Get a Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click **Get API key → Create API key**

### 4. Configure environment variables

```bash
cp .env.example .env
```

```env
# Required
BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key

# Production (leave empty for local dev — uses polling)
WEBHOOK_URL=https://your-service.onrender.com
PORT=3000

# Admin (your Telegram user ID — enables /grantpro, /giftpro, /announce)
ADMIN_USER_ID=123456789

# Optional: GitHub issue creation from /feedback
GITHUB_TOKEN=your_github_pat
GITHUB_REPO=owner/repo-name
```

### 5. Run locally

```bash
npm install
npm start
```

The bot starts in **polling mode** when `WEBHOOK_URL` is not set.

---

## Deploy to Render

1. Push to GitHub
2. Render → New → Web Service → connect repo
3. **Build Command:** `npm install` | **Start Command:** `npm start`
4. Add all environment variables from the section above
5. Once deployed, copy the service URL and set it as `WEBHOOK_URL`
6. Render redeploys automatically

> **Keeping warm:** Render free-tier services sleep after ~15 min. Ping `https://your-service.onrender.com/health` every 5 min via [UptimeRobot](https://uptimerobot.com).

---

## Payments — Telegram Stars

Sakina uses **Telegram Stars (XTR)** for in-app Pro subscriptions:

- No payment provider setup needed in BotFather — Stars are native to Telegram
- `provider_token: ''` + `currency: 'XTR'` in the invoice
- `pre_checkout_query` answered immediately (10s deadline)
- `successful_payment` is idempotent — keyed on `telegram_payment_charge_id`
- **Gift codes**: admin runs `/giftpro [days]` → shares the code → recipient redeems with `/redeem CODE`

---

## Database schema

### Core tables

| Table | Purpose |
|-------|---------|
| `users` | One row per Telegram user. Includes `plan`, `plan_expires_at`, `pump_interval_hours` |
| `task_completions` | Logged wellness tasks |
| `reminders` | Date-based custom reminders |
| `health_logs` | Daily health check-ins |
| `epds_sessions` | Mood screening sessions + scores |
| `milestone_completions` | Tumbuh milestone records |
| `share_tokens` | Partner read-only access codes |

### Baby log tables

| Table | Purpose |
|-------|---------|
| `baby_events` | All tap-logged events (feed, sleep, diaper, pump, note, weight, milestone) |
| `baby_events_effective` | View: paper wins over tap for confirmed days |
| `paper_rows` | Rows confirmed from notebook scans |
| `paper_scans` | Scan metadata |
| `user_log_messages` | Dashboard message IDs (for in-place editing) |

### Billing tables

| Table | Purpose |
|-------|---------|
| `payments` | Telegram Stars payment audit log |
| `gift_codes` | One-time redeemable Pro gift codes |

### Feature tables

| Table | Purpose |
|-------|---------|
| `feedback` | User feedback from `/feedback` command |
| `feed_combos` | Saved formula+breast pairs per baby (Pro, max 5) |

---

## EPDS Screening

Runs automatically at Day 7, 14, and 30 after baby's DOB:

- 10 questions via inline keyboard (0–3 per question, total 0–30)
- Score ≥ 13: high-risk guidance + IMH/SSO numbers
- Score 10–12: moderate — advise GP
- Q10 (self-harm) > 0: always escalates regardless of total

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
- **Google Gemini** (`gemini-3.5-flash-lite`) — NLP task matching, reminder parsing, notebook OCR
- **Supabase** — PostgreSQL with RPC functions
- **node-cron** — Hourly scheduler with per-user timezone support
- **Node.js 22+** — ES modules, no build step
- **Telegram Stars (XTR)** — Native in-app payments, no card gateway needed
