# Sakina Bot — Project Brief & Status

> _Sakina_ (سكينة) — Arabic for tranquility, calm, and the divine peace that descends in difficulty.

**Last updated:** September 2026  
**Branch:** `development` (active work) / `main` (production-deployed on Railway)

---

## What is Sakina?

A Telegram chatbot providing daily, personalised wellness support for:

- **Pregnant mothers** — week-by-week birth preparation (Weeks 32–40)
- **Postpartum mothers** — medically distinct recovery tracks (vaginal and C-section), Days 1–44
- **Parents of infants** — milestone-gated baby development activities (0–12 months)

The tone is warm, culturally familiar (Malay-Muslim context), and clinically grounded. It replaces generic wellness apps with a conversational companion that speaks naturally and meets mothers where they are.

---

## Target Users

- Malay-Muslim mothers in Singapore, 25–40
- First-time and subsequent mothers in the postpartum period
- Partners and doulas who want visibility into a mother's wellbeing
- Primarily mobile, on Telegram (already installed, zero-friction)

---

## Core Problem

Postpartum and antenatal wellness is fragmented — medical appointments are sparse, social support is inconsistent, and most apps feel clinical or generic. Sakina fills the daily gap with:

- Task accountability (jamu, rest, pelvic floor, prayer, skin-to-skin)
- Mood screening at clinical intervals (EPDS)
- Health data logging (feeds, weight, nappies)
- Urgent danger sign access (always-on)
- Partner/doula read-only access

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Bot framework | Telegraf v4 (ES modules) | Mature, well-typed, webhook + polling |
| AI/NLP | Google Gemini `gemini-3.5-flash-lite` via REST | Free tier (1500 req/day), no SDK dependency |
| Database | Supabase (PostgreSQL) | Multi-user state, free tier, real-time if needed |
| Scheduler | node-cron + `Intl.DateTimeFormat` | Hourly check with per-user timezone |
| Hosting | Railway | Auto-deploys from GitHub, free starter |
| Runtime | Node.js 22+ (ES modules, `with {type:'json'}`) | Native JSON imports, no build step |

---

## Architecture

```
src/
  bot.js              ← Entry point — webhook (prod) or polling (local dev)
  scheduler.js        ← Hourly cron: morning/evening per-user timezone
                         Sunday: weekly summary
                         Daily 6am SGT: EPDS prompts + vaccination reminders
  db.js               ← Supabase: all DB operations
  handlers/
    message.js        ← Router: EPDS intercept → reminder → NLP task log → fallback
    callbacks.js      ← Inline keyboard: mode, delivery type, EPDS, milestone advance
    onboarding.js     ← Multi-step: start → mode → [delivery_type] → date → done
    commands.js       ← /about /week /tip /reset /reminders /urgent /undo /log /share /view
  services/
    content.js        ← Mode content + two recover tracks + milestone gating + vaccinations
    claude.js         ← Gemini: NLP task parsing + empathetic log responses
    reminders.js      ← Gemini: reminder intent detection + date resolution
  data/
    birthPlan.json    ← 9 weeks × weekend tasks + daily habits
    babyDev.json      ← 6 phases × 13 week-periods × motor/social/cognitive tasks
```

---

## Features Built (v2 — `development` branch)

### Modes

| Mode | Track | Duration | Notes |
|------|-------|----------|-------|
| 🌱 Prepare | Antenatal | Weeks 32–40 | Weekend + daily habit tasks |
| 🌿 Recover — Vaginal | Postpartum | Days 1–44 | Jamu from Day 1, pelvic floor, urutan |
| 🔷 Recover — C-section | Postpartum | Days 1–44 | Distinct surgical track: wound care, no lifting, scar massage Day 21+ |
| 🌸 Tumbuh | Baby dev | 0–12 months | Milestone-gated, manual advance |

### Commands (13 total)

| Command | Description |
|---------|-------------|
| `/today` | Today's task list |
| `/tip` | Rotating wellness tip |
| `/week` | Current week/day summary |
| `/progress` | Completion count + streak |
| `/switch` | Change mode |
| `/reminders` | View/manage reminders |
| `/urgent` | Danger signs + SG contacts (995, IMH 1767, KKH, NUH) |
| `/undo` | Unmark last logged task |
| `/log` | Health log — feeds, weight, nappies |
| `/share` | Generate 6-char partner access code (30-day expiry) |
| `/view` | Partner views owner's briefing via token |
| `/about` | What is Sakina? |
| `/reset` | Reset profile |

### Natural Language

- **Task logging** — "I did tummy time and read to the baby" → matches and logs tasks
- **Reminders** — "Remind me Friday to call the hospital" → parsed and saved
- **Fallback** — shows example phrases from pending tasks when no match found

### Clinical Features

- **EPDS** — Edinburgh Postnatal Depression Scale at Day 7, 14, 30 after baby_dob
  - 10 questions via inline buttons
  - Q10 > 0: always escalate (self-harm pathway)
  - Score ≥ 13: refer to IMH/SSO
  - Score 10–12: advise GP
- **Vaccination reminders** — Singapore NCIS schedule, 3-day advance notice
- **Health logging** — `/log feed breast 15 left`, `/log weight 3.5kg`, `/log nappy wet`
  - Alerts: weight < 2.5kg, < 6 wet nappies/day after Day 5
- **Streak tracking** — O(1) via `last_active_date` comparison
- **Timezone-aware scheduling** — hourly cron checks each user's local 8am/7pm via `Intl.DateTimeFormat`
- **Partner access** — 6-char alphanumeric token, read-only briefing view

---

## Database Schema

Run SQL files in Supabase in this order:

| File | Purpose |
|------|---------|
| `supabase_schema.sql` | `users`, `task_completions` |
| `supabase_reminders.sql` | `reminders` |
| `supabase_v3.sql` | `health_logs`, `epds_sessions`, `milestone_completions`, `share_tokens` + new `users` columns |

### `users` table key columns

| Column | Type | Added | Purpose |
|--------|------|-------|---------|
| `mode` | text | v1 | prepare / recover / tumbuh |
| `delivery_type` | text | v3 | vaginal / cesarean |
| `streak_days` | int | v3 | consecutive active days |
| `last_active_date` | date | v3 | for O(1) streak calculation |
| `tumbuh_week_id` | text | v3 | milestone gate override (null = auto by age) |
| `timezone` | text | v1 | IANA timezone string (e.g. `Asia/Singapore`) |

---

## Onboarding Flow

```
/start
  └─ Mode selection
      ├─ 🌱 Prepare  → due date (DD/MM/YYYY) → done
      ├─ 🌿 Recover  → vaginal / C-section → baby DOB → done
      └─ 🌸 Tumbuh   → baby DOB → done
```

---

## Deployment

- **Production:** Railway (`main` branch) — webhook mode
- **Local dev:** `npm run dev` → polling mode (no `WEBHOOK_URL` set)
- **GitHub:** `development` branch for active work → PR to `main` to deploy

### Environment variables

```env
BOT_TOKEN=           # from BotFather
GEMINI_API_KEY=      # from aistudio.google.com
SUPABASE_URL=        # from Supabase project settings
SUPABASE_SERVICE_KEY=# service_role key (not anon)
WEBHOOK_URL=         # Railway domain — leave empty for local dev
PORT=3000
```

---

## What's Done

- [x] Multi-mode onboarding (prepare / recover / tumbuh)
- [x] Two recovery tracks (vaginal vs C-section) — medically distinct content
- [x] NLP task logging via Gemini
- [x] NLP reminder detection with date parsing
- [x] Inline keyboard callbacks for all actions
- [x] Streak tracking
- [x] EPDS mood screening (10 questions, clinical scoring, referral pathways)
- [x] Health log — feeds, weight, nappies with alerts
- [x] Singapore NCIS vaccination reminders (7 milestones)
- [x] Timezone-aware scheduling (hourly cron, per-user)
- [x] Sunday weekly summaries
- [x] Partner/doula share access (token-based, read-only)
- [x] /undo command
- [x] /urgent danger signs (C-section-specific + baby signs)
- [x] Milestone-gated Tumbuh (manual advance)
- [x] Improved fallback with example task phrases
- [x] Railway deployment (webhook mode)
- [x] Full README with setup, schema, flow diagrams
- [x] `supabase_v3.sql` migration file

---

## What's Next (Backlog)

- [ ] `/view` partner briefing — needs testing end-to-end
- [ ] EPDS skip re-prompt (user dismisses, re-offer next day?)
- [ ] `/log summary` weekly view (not just today)
- [ ] Language localisation (Bahasa Melayu toggle)
- [ ] Push reminders at user's preferred time (store preference)
- [ ] Sakina website (`sakina-website-fresh/` repo exists)
- [ ] User-facing onboarding for timezone setting (currently defaults to `Asia/Singapore`)
- [ ] Analytics dashboard (how many users, mode distribution, EPDS completion rate)

---

## Testing Checklist

Before merging `development` → `main`:

1. Run `supabase_v3.sql` in Supabase SQL Editor
2. `npm run dev` — confirm polling mode starts
3. `/start` → Recover → C-section → baby DOB → verify `/today` shows wound care tasks
4. Type "I did tummy time" → verify task logged + streak shown
5. `/log feed breast 15 left` → verify health log entry
6. `/log summary` → verify today's counts
7. `/urgent` → verify danger signs render
8. `/share` → copy token → `/view TOKEN` from second account → verify briefing
9. `/undo` → verify last task removed
10. Manually trigger EPDS: call `startEpdsSession()` in node REPL, answer all 10 questions

---

## Key Engineering Decisions

| Decision | Why |
|----------|-----|
| Gemini REST (no SDK) | Avoids SDK version churn; direct fetch is transparent and fast |
| Hourly cron + `Intl.DateTimeFormat` | Per-user timezone without `moment-timezone` dependency |
| ES modules throughout | Node 22 native; `with {type:'json'}` for data files |
| Streak via `last_active_date` | O(1) check vs. aggregate DB query |
| EPDS UUID in callback regex | UUIDs contain dashes; `split('_')` breaks — use `/^epds_([a-f0-9-]{36})_(\d+)_(\d+)$/` |
| Dynamic import in `/view` | Avoids circular dependency between `commands.js` and `db.js`/`content.js` |
| `getAllUsers()` filter `onboarding = 'done'` | Only message users who finished onboarding |
