/**
 * Static and semi-static command handlers.
 * /about, /week, /tip, /reset
 */

import { getUser, upsertUser } from '../db.js';
import { getPrepareContent, getRecoverContent, getTumbuhContent } from '../services/content.js';
import { Markup } from 'telegraf';

// ── /about ────────────────────────────────────────────────────────────────────

export async function handleAbout(ctx) {
  return ctx.reply(
`🌿 *About Sakina*

Sakina is a daily wellness companion for the journey from pregnancy through your baby's first year. The name means *tranquility* — a reminder that this season, however hard, is worth moving through gently.

─────────────────────

🌱 *Prepare* — Weeks 32 to 40
A week-by-week birth preparation plan covering hospital readiness, breathing practice, natural labour prep (including the evidence behind eating dates 🌴), and mental preparation for birth.

🌿 *Recover* — Days 1 to 44
The 44-day postpartum confinement period. Daily tasks cover rest, nourishment, jamu, prayer, and gradual movement — rooted in Malay pantang tradition and modern recovery evidence.

🌸 *Tumbuh · 成长* — Months 0 to 12
Week-by-week baby development activities across motor, social, and cognitive domains — drawn from CDC, WHO, and Harvard developmental research. Track tummy time, talking, reading, and play milestones.

─────────────────────

*How it works:*
Every morning at 8am, Sakina sends your personalised task list. Just tell me what you've done in plain language — "did tummy time and sang songs" — and I'll log it automatically.

/today · /progress · /switch · /tip · /week`,
    { parse_mode: 'Markdown' }
  );
}

// ── /week ─────────────────────────────────────────────────────────────────────

export async function handleWeek(ctx) {
  const user = await getUser(ctx.from.id);
  if (!user || user.onboarding !== 'done') {
    return ctx.reply('Please complete setup first — send /start');
  }

  if (user.mode === 'prepare') {
    const c = getPrepareContent(user);
    const daysUntilDue = Math.ceil((new Date(user.due_date) - new Date()) / 86400000);
    return ctx.reply(
`🌱 *Week ${c.currentWeek} — Birth Preparation*

📅 Due date: *${formatDate(user.due_date)}*
⏳ ${daysUntilDue > 0 ? `${daysUntilDue} days to go` : 'Any day now! 🌟'}

This week: ${c.weekendTasks.length} weekend task${c.weekendTasks.length !== 1 ? 's' : ''} + ${c.dailyHabits.length} daily habits

Tap /today to see your full task list.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (user.mode === 'recover') {
    const c = getRecoverContent(user);
    const day = c.currentDay;
    const phase = day <= 7  ? 'Week 1 — complete rest 🛏️'
                : day <= 21 ? 'Weeks 2–3 — gentle movement begins 🌿'
                : 'Weeks 4–6 — rebuilding strength 🌱';
    return ctx.reply(
`🌿 *Postpartum Recovery — Day ${day} of 44*

📅 Baby's birthday: *${formatDate(user.baby_dob)}*
🌿 Phase: ${phase}
${day < 44 ? `⏳ ${44 - day} days remaining in pantang` : '🌟 Pantang period complete — well done!'}

Tap /today to see today's tasks.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (user.mode === 'tumbuh') {
    const c = getTumbuhContent(user);
    const weeks = c.babyWeeks;
    const months = Math.floor(weeks / 4.33);
    return ctx.reply(
`🌸 *Baby Development — ${weeks < 4 ? `Week ${weeks}` : `Month ${months}`}*

📅 Baby's birthday: *${formatDate(user.baby_dob)}*
🌸 ${c.header.replace(/\*/g, '')}
${c.header2 ? `_${c.header2}_\n` : ''}
Today: ${c.tasks.length} developmental activities + ${c.milestones.length} milestone${c.milestones.length !== 1 ? 's' : ''} to watch for

Tap /today to see today's full activity list.`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ── /tip ──────────────────────────────────────────────────────────────────────

const TIPS = {
  prepare: [
    '🌴 Eating 6 Medjool dates daily from Week 35 is backed by RCT evidence — shorter labour, less induction, faster cervical ripening.',
    '🧘 Practise breathing *through* discomfort, not away from it. 4 counts in, 8 counts out. Your uterus knows what to do.',
    '💤 Sleep is preparation. A rested body labours better. Protect your sleep now like a prescription.',
    '🛁 Perineal massage 5 min daily from Week 34 significantly reduces tearing risk — coconut or almond oil works well.',
    '📋 Your birth plan is a communication tool, not a contract. One page. Clear preferences. Hold it loosely.',
    '🚗 Do a hospital run drill this week — time the drive at different hours. Know exactly where to go when it\'s time.',
    '💪 Pelvic floor exercises now = faster recovery later. 3 sets of 10 slow holds, every day.',
    '🎵 Your baby already knows your voice. Talk, sing, read — they are listening.',
  ],
  recover: [
    '😴 Sleep when the baby sleeps is not a cliché — it is a clinical prescription. Rest is how you heal.',
    '🍲 Warm food, warm drinks, warm body. Cold foods slow blood circulation during recovery — save the salads for week 7.',
    '🌿 Jamu works. Turmeric reduces inflammation, ginger improves circulation, galangal supports uterine recovery. Take it daily.',
    '💧 Breastfeeding needs 500 extra calories a day. Eat more than you think you need — your body is working overtime.',
    '🛁 Your first postpartum bath: warm water, sitz herbs or serai, basuh betul-betul. This is medicine, not luxury.',
    '🤱 Cluster feeding is normal. It does not mean you have low milk. It means your baby is calibrating your supply.',
    '🌙 Ask for help without apologising. The 44 days exist because recovery takes exactly that long when done properly.',
    '🫀 Emotional waves in week 2–3 are hormonal, not a sign you are failing. Tell someone you trust how you\'re feeling.',
  ],
  tumbuh: [
    '👀 Newborns see best at 20–30 cm — exactly the distance from your face to theirs during feeding. Make eye contact.',
    '🗣️ Talk to your baby constantly. Narrate everything. They are building vocabulary from day one even before they can speak.',
    '⏰ Tummy time daily from week 1 — even 2 minutes builds the neck strength they need to roll, sit, and crawl.',
    '📚 Reading aloud matters more than the words — voice rhythm, tone, and proximity all build brain architecture.',
    '🎵 Singing the same songs repeatedly builds anticipation and security. Repetition is how babies learn.',
    '🤝 Serve and return: respond to every coo, every look. These micro-interactions build neural connections for life.',
    '🪞 Show baby their reflection — self-recognition begins earlier than most parents realise. They are fascinated.',
    '🧠 Floor time > bouncer time. Babies need the ground to develop strength, coordination, and spatial awareness.',
  ],
};

export async function handleTip(ctx) {
  const user = await getUser(ctx.from.id);
  const mode = user?.mode || 'recover';
  const tips = TIPS[mode] || TIPS.recover;

  // Rotate tip by day so it changes daily
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const tip = tips[dayOfYear % tips.length];

  return ctx.reply(`💡 *Today's tip*\n\n${tip}`, { parse_mode: 'Markdown' });
}

// ── /reset ────────────────────────────────────────────────────────────────────

export async function handleReset(ctx) {
  return ctx.reply(
    '⚠️ This will delete your profile and all logged tasks. You\'ll go through setup again from scratch.\n\nAre you sure?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Yes, reset everything', 'confirm_reset')],
      [Markup.button.callback('No, keep my data',      'cancel_reset')],
    ])
  );
}

export async function handleResetConfirm(ctx) {
  const userId = ctx.from.id;

  // Set onboarding back to start — keeps the row but restarts the flow
  await upsertUser(userId, {
    onboarding: 'start',
    mode:       'recover',
    due_date:   null,
    baby_dob:   null,
  });

  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await ctx.reply(
    '✅ Profile reset. Send /start to begin again 🌿',
    { parse_mode: 'Markdown' }
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return 'not set';
  return new Date(dateStr).toLocaleDateString('en-SG', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}
