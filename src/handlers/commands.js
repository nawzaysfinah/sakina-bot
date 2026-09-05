/**
 * Command handlers.
 * /about, /week, /tip, /reset, /reminders, /urgent, /undo, /log, /share
 */

import {
  getUser, upsertUser,
  getUpcomingReminders, markReminderDone, deleteReminder,
  unmarkLastTask,
  addHealthLog, getTodayHealthLogs, getHealthLogsSince,
  createShareToken,
} from '../db.js';
import { getPrepareContent, getRecoverContent, getTumbuhContent } from '../services/content.js';
import { formatReminderList } from '../services/reminders.js';
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
Two personalised tracks: **vaginal birth** and **C-section**. C-section recovery follows a medically distinct schedule — no lifting, wound care, scar massage from Day 21. Rooted in Malay pantang tradition and modern surgical recovery evidence.

🔷 *C-section track*: complete bed rest Days 1–3, wound care through Day 14, jamu from Day 15, scar massage from Day 21, full activity restriction for 6 weeks.

🌸 *Tumbuh · 成长* — Months 0 to 12
Milestone-gated baby development activities across motor, social, and cognitive domains. You control when to advance — complete your current week's activities before unlocking the next phase.

─────────────────────

*How it works:*
Every morning at 8am (your local time), Sakina sends your personalised task list. Just tell me what you've done — "did tummy time and sang songs" — and I'll log it automatically.

*Safety:* /urgent · *Mood:* EPDS screening at Day 7, 14, 30 · *Logs:* /log

/today · /progress · /switch · /tip · /week · /urgent · /undo · /log · /share`,
    { parse_mode: 'Markdown' }
  );
}

// ── /urgent — danger signs ────────────────────────────────────────────────────

export async function handleUrgent(ctx) {
  return ctx.reply(
`🚨 *When to seek emergency care immediately*

These signs require calling an ambulance or going to A&E — do not wait, do not drive yourself.

─────────────────────
*Postpartum danger signs (mother):*
🔴 Heavy bleeding — soaking more than 1 pad per hour for 2+ hours
🔴 Foul-smelling discharge or fever above 38°C
🔴 Severe headache, vision changes, or sudden swelling of face/hands (pre-eclampsia)
🔴 Chest pain or difficulty breathing
🔴 Calf pain, redness, warmth (possible DVT/blood clot)
🔴 Wound not healing / opening / pus at C-section or perineal site
🔴 Thoughts of harming yourself or baby — *call 1767 (IMH) or 995*

─────────────────────
*C-section specific:*
🔴 Wound edges separating or leaking
🔴 Increasing pain after Day 3 (should be decreasing)
🔴 Fever + lower abdominal pain (wound infection)

─────────────────────
*Baby danger signs:*
🔴 Baby not breathing / turning blue
🔴 Fewer than 6 wet nappies per day after Day 5 (dehydration)
🔴 Jaundice spreading to arms/legs (not just face/chest)
🔴 Baby limp, unusually hard to wake
🔴 High-pitched cry, bulging fontanelle
🔴 Baby not regaining birth weight by Day 14

─────────────────────
📞 *Singapore emergency contacts:*
• 995 — Ambulance / A&E
• 1767 — Institute of Mental Health (24hr)
• KKH Urgent Obs & Gynae: +65 6294 4050
• NUH Women's Emergency: +65 6779 5555
• Thomson Medical: +65 6250 0000

_Tap this any time. You are not being dramatic — you are being safe._`,
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
    const deliveryLabel = c.isCSection ? '🔷 C-section' : '🌿 Vaginal birth';
    const phase = day <= 7  ? 'Week 1 — complete rest'
                : day <= 14 ? 'Week 2 — wound healing'
                : day <= 21 ? 'Week 3 — gentle movement begins'
                : 'Weeks 4–6 — rebuilding strength';
    return ctx.reply(
`${c.isCSection ? '🔷' : '🌿'} *Postpartum Recovery — Day ${day} of 44*

📅 Baby's birthday: *${formatDate(user.baby_dob)}*
🌿 Delivery: ${deliveryLabel}
🌿 Phase: ${phase}
${day < 44 ? `⏳ ${44 - day} days remaining in pantang` : '🌟 Pantang period complete — well done!'}
${user.streak_days > 1 ? `\n🔥 *${user.streak_days}-day streak* — keep going!` : ''}

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
${user.streak_days > 1 ? `\n🔥 *${user.streak_days}-day streak*` : ''}

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
  await upsertUser(userId, {
    onboarding:    'start',
    mode:          'recover',
    due_date:      null,
    baby_dob:      null,
    delivery_type: 'vaginal',
    streak_days:   0,
    tumbuh_week_id: null,
  });
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await ctx.reply('✅ Profile reset. Send /start to begin again 🌿', { parse_mode: 'Markdown' });
}

// ── /reminders ────────────────────────────────────────────────────────────────

export async function handleReminders(ctx) {
  const user = await getUser(ctx.from.id);
  if (!user || user.onboarding !== 'done') {
    return ctx.reply('Please complete setup first — send /start');
  }

  const reminders = await getUpcomingReminders(user.id);

  if (!reminders.length) {
    return ctx.reply(
      `📌 *No upcoming reminders*\n\nTo add one, just tell me:\n_"Remind me on Friday to call the hospital"_`,
      { parse_mode: 'Markdown' }
    );
  }

  const list = formatReminderList(reminders);
  const buttons = reminders.map(r => [
    Markup.button.callback(`✅ Done — ${r.text.slice(0, 30)}`, `done_reminder_${r.id}`),
    Markup.button.callback('🗑', `del_reminder_${r.id}`),
  ]);

  return ctx.reply(
    `📌 *Your upcoming reminders:*\n\n${list}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
}

// ── /undo ─────────────────────────────────────────────────────────────────────

export async function handleUndo(ctx) {
  const user = await getUser(ctx.from.id);
  if (!user || user.onboarding !== 'done') {
    return ctx.reply('Please complete setup first — send /start');
  }

  const taskId = await unmarkLastTask(user.id, user.mode);
  if (!taskId) {
    return ctx.reply('Nothing to undo — no tasks logged yet today 🌿');
  }

  return ctx.reply(
    `↩️ *Undone!* Task \`${taskId}\` has been unmarked.\n\nSend /today to see your current list.`,
    { parse_mode: 'Markdown' }
  );
}

// ── /log — health tracking ────────────────────────────────────────────────────

export async function handleLog(ctx) {
  const user = await getUser(ctx.from.id);
  if (!user || user.onboarding !== 'done') {
    return ctx.reply('Please complete setup first — send /start');
  }

  const text  = ctx.message.text?.trim().replace('/log', '').trim() || '';
  const lower = text.toLowerCase();

  // ── Feed logging: /log feed breast 15 left | /log feed bottle 60ml ──────────
  if (lower.startsWith('feed') || lower.startsWith('bf') || lower.startsWith('bottle')) {
    return handleFeedLog(ctx, user, text);
  }

  // ── Weight: /log weight 3.5kg | /log weight 3500g ───────────────────────────
  if (lower.startsWith('weight') || lower.startsWith('berat')) {
    return handleWeightLog(ctx, user, text);
  }

  // ── Nappy: /log nappy wet | /log nappy dirty ─────────────────────────────────
  if (lower.startsWith('nappy') || lower.startsWith('diaper') || lower.startsWith('wet') || lower.startsWith('dirty')) {
    return handleNappyLog(ctx, user, text);
  }

  // ── Summary: /log summary ────────────────────────────────────────────────────
  if (lower.startsWith('summary') || lower === '') {
    return handleLogSummary(ctx, user);
  }

  // ── Help ──────────────────────────────────────────────────────────────────────
  return ctx.reply(
`📊 *Health Log commands:*

*Feeding:*
• \`/log feed breast 15 left\` — breastfeed, 15 min, left side
• \`/log feed breast 10 right\` — right side
• \`/log feed bottle 80\` — bottle, 80ml

*Baby weight:*
• \`/log weight 3.5kg\` or \`/log weight 3500g\`

*Nappy count:*
• \`/log nappy wet\` — wet nappy
• \`/log nappy dirty\` — dirty nappy

*View today's logs:*
• \`/log summary\``,
    { parse_mode: 'Markdown' }
  );
}

async function handleFeedLog(ctx, user, text) {
  const lower = text.toLowerCase();
  const isBottle = lower.includes('bottle');
  const logType  = isBottle ? 'feed_bottle' : 'feed_breast';

  // Extract duration (minutes)
  const minMatch = text.match(/(\d+)\s*(?:min|m(?:in)?s?)?/i);
  const value = minMatch ? parseInt(minMatch[1]) : null;

  // Extract side (breastfeed)
  let side = null;
  if (!isBottle) {
    if (lower.includes('left') || lower.includes('kiri'))  side = 'left';
    if (lower.includes('right') || lower.includes('kanan')) side = 'right';
    if (lower.includes('both') || lower.includes('kedua')) side = 'both';
  }

  // Extract ml (bottle)
  const mlMatch = text.match(/(\d+)\s*ml/i);
  const mlValue = mlMatch ? parseInt(mlMatch[1]) : value;

  await addHealthLog(user.id, logType, mlValue, isBottle ? 'ml' : 'min', null, side);

  // Check today's feeds for context
  const todayFeeds = await getTodayHealthLogs(user.id, logType);
  const count = todayFeeds.length;

  const icon   = isBottle ? '🍼' : '🤱';
  const detail = isBottle
    ? `${mlValue || '?'}ml`
    : `${value || '?'} min${side ? ` (${side})` : ''}`;

  return ctx.reply(
    `${icon} *Feed logged!* ${detail}\n\n📊 Today: ${count} ${isBottle ? 'bottle' : 'breastfeed'}${count !== 1 ? 's' : ''} so far\n\n_View all: /log summary_`,
    { parse_mode: 'Markdown' }
  );
}

async function handleWeightLog(ctx, user, text) {
  // Parse kg or g
  const kgMatch = text.match(/([\d.]+)\s*kg/i);
  const gMatch  = text.match(/([\d.]+)\s*g\b/i);

  let valueKg = null;
  if (kgMatch) valueKg = parseFloat(kgMatch[1]);
  else if (gMatch) valueKg = parseFloat(gMatch[1]) / 1000;
  else {
    // Bare number — assume kg if > 50, else treat as kg
    const numMatch = text.match(/([\d.]+)/);
    if (numMatch) valueKg = parseFloat(numMatch[1]);
  }

  if (!valueKg || valueKg < 0.5 || valueKg > 20) {
    return ctx.reply('Please give a valid baby weight, e.g. `/log weight 3.5kg` or `/log weight 3500g`', { parse_mode: 'Markdown' });
  }

  await addHealthLog(user.id, 'weight', valueKg, 'kg');

  // Get previous weight for comparison
  const prevLogs = await getHealthLogsSince(user.id, 'weight', 30);
  const prev = prevLogs.find(l => l.value !== valueKg); // first different entry
  const diff = prev ? (valueKg - prev.value).toFixed(3) : null;
  const trend = diff === null ? '' : diff >= 0 ? `📈 +${diff}kg since last` : `📉 ${diff}kg since last`;

  // Low weight alert (below 2.5kg is clinical concern)
  const alert = valueKg < 2.5 ? '\n\n⚠️ _Weight below 2.5kg — discuss with your paediatrician_' : '';

  return ctx.reply(
    `⚖️ *Weight logged:* ${valueKg.toFixed(3)} kg\n${trend}${alert}`,
    { parse_mode: 'Markdown' }
  );
}

async function handleNappyLog(ctx, user, text) {
  const lower    = text.toLowerCase();
  const isDirty  = lower.includes('dirty') || lower.includes('solid') || lower.includes('poo') || lower.includes('bm');
  const logType  = isDirty ? 'nappy_dirty' : 'nappy_wet';

  await addHealthLog(user.id, logType, 1, 'count');

  const todayWet   = (await getTodayHealthLogs(user.id, 'nappy_wet')).length;
  const todayDirty = (await getTodayHealthLogs(user.id, 'nappy_dirty')).length;

  // Clinical alert: fewer than 6 wet nappies per day after Day 5 = dehydration risk
  const babyDays = user.baby_dob ? daysBetween(user.baby_dob) + 1 : null;
  let alert = '';
  if (babyDays && babyDays > 5 && todayWet < 4 && !isDirty) {
    alert = '\n\n⚠️ _Fewer than 6 wet nappies is normal in first 5 days. After Day 5, fewer than 6/day warrants a call to your doctor._';
  }

  return ctx.reply(
    `🧷 *Nappy logged:* ${isDirty ? 'dirty 💩' : 'wet 💧'}\n\n📊 Today: ${todayWet} wet · ${todayDirty} dirty${alert}`,
    { parse_mode: 'Markdown' }
  );
}

async function handleLogSummary(ctx, user) {
  const breastFeeds = await getTodayHealthLogs(user.id, 'feed_breast');
  const bottleFeeds = await getTodayHealthLogs(user.id, 'feed_bottle');
  const weights     = await getHealthLogsSince(user.id, 'weight', 7);
  const wetNappies  = await getTodayHealthLogs(user.id, 'nappy_wet');
  const dirtyNappies= await getTodayHealthLogs(user.id, 'nappy_dirty');

  const totalBottleMl = bottleFeeds.reduce((s, l) => s + (l.value || 0), 0);
  const latestWeight  = weights[0];

  let text = `📊 *Today's health log*\n\n`;
  text += `🤱 Breastfeeds: *${breastFeeds.length}*\n`;
  text += `🍼 Bottle feeds: *${bottleFeeds.length}*${totalBottleMl ? ` (${totalBottleMl}ml total)` : ''}\n`;
  text += `🧷 Wet nappies: *${wetNappies.length}* ${wetNappies.length < 6 ? '⚠️' : '✅'}\n`;
  text += `🧷 Dirty nappies: *${dirtyNappies.length}*\n`;
  if (latestWeight) {
    text += `\n⚖️ Latest weight: *${latestWeight.value?.toFixed(3)} kg* (${new Date(latestWeight.logged_at).toLocaleDateString('en-SG')})`;
  }

  text += `\n\n_Log more: /log feed · /log weight · /log nappy_`;

  return ctx.reply(text, { parse_mode: 'Markdown' });
}

// ── /share — generate partner access code ─────────────────────────────────────

export async function handleShare(ctx) {
  const user = await getUser(ctx.from.id);
  if (!user || user.onboarding !== 'done') {
    return ctx.reply('Please complete setup first — send /start');
  }

  const token = await createShareToken(user.id);

  return ctx.reply(
`🔗 *Share your Sakina journal*

Give this code to your partner, doula, or family member:

\`\`\`
${token}
\`\`\`

They can view your daily briefing by sending Sakina:
\`/view ${token}\`

The code expires in 30 days. Generate a new one any time with /share.

_Their access is read-only — they cannot log tasks or change your settings._`,
    { parse_mode: 'Markdown' }
  );
}

// ── /view — read someone else's briefing ──────────────────────────────────────

export async function handleView(ctx) {
  const text  = ctx.message.text?.trim() || '';
  const token = text.replace('/view', '').trim().toUpperCase();

  if (!token) {
    return ctx.reply('Send: `/view XXXXXX` (the 6-character code from your partner\'s /share)', { parse_mode: 'Markdown' });
  }

  const { resolveShareToken, getUser: _getUser } = await import('../db.js');
  const ownerId = await resolveShareToken(token);

  if (!ownerId) {
    return ctx.reply('That code is invalid or has expired. Ask your partner to use /share again.');
  }

  const { getCompletedTaskIds } = await import('../db.js');
  const { formatDailyBriefing: _fmt } = await import('../services/content.js');

  const owner        = await _getUser(ownerId);
  const completedIds = await getCompletedTaskIds(owner.id, owner.mode);
  const { text: briefing } = _fmt(owner, completedIds);

  return ctx.reply(
    `👀 *${owner.name}'s daily plan*\n\n${briefing}\n\n_Read-only view. To see daily updates, share the code: ${token}_`,
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

function daysBetween(dateStr) {
  const target = new Date(dateStr);
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((today - target) / 86400000);
}
