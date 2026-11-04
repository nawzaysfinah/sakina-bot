// Morning brief: yesterday's line, 7-day average, and one developmental focus.
// Merged into Sakina's existing 7am brief in scheduler.js — not sent separately.
// Neutral tone: no scores, no "good/bad day", no comparisons.

import { hrs, currentRowDateStr, addDays } from './format.js';

function defaultFocus(ageDays) {
  if (ageDays == null) return null;
  const week = Math.floor(ageDays / 7);
  const day  = ageDays % 7;

  // Week 1 (days 0-6): survive + skin-on-skin
  if (week < 1) {
    if (ageDays <= 1)  return 'Rest completely — your body just did something extraordinary. Let everyone else handle everything else.';
    if (ageDays <= 2)  return 'Try the first latch or bottle session in a calm, unhurried way. No pressure — this takes practice for both of you.';
    if (ageDays <= 3)  return 'Skin-to-skin as much as possible. It regulates baby\'s temperature, heart rate and breathing.';
    if (ageDays <= 4)  return 'Colostrum is enough — trust it. Watch for feeding cues: rooting, sucking hands, turning head.';
    if (ageDays <= 5)  return 'Milk may be coming in — engorgement is normal. Feed often; warmth before, cold after helps.';
    if (ageDays <= 6)  return 'Start gentle pelvic floor squeezes (10 × 5 sec holds). Stop immediately if you feel any pain.';
    return 'One week in. You are doing it. Rest when baby rests — the housework can wait.';
  }

  // Week 2 (days 7-13): healing + first tummy time
  if (week < 2) {
    if (day <= 1) return 'Begin 5 min of deep belly breathing: 4 counts in, 6 counts out. Good for core and calm.';
    if (day <= 2) return 'Supervised tummy time on your chest after a feed — 1–2 min is enough right now.';
    if (day <= 4) return 'Check in on your wound or perineum: any increase in pain or unusual discharge? Flag it at your next visit.';
    if (day <= 5) return 'Pelvic floor: 3 × 10 gentle squeezes and releases. Hold each for 5 seconds. Breathe normally.';
    return 'Two weeks postpartum. If you haven\'t already, ask your partner or family for one full night off.';
  }

  // Week 3 (days 14-20): first outdoor movement
  if (week < 3) {
    if (day <= 1) return 'Short indoor walk today — even just letterbox and back. Movement helps circulation and mood.';
    if (day <= 3) return 'Hip circles or gentle cat-cow stretches on the floor. Keeps your pelvis mobile.';
    if (day <= 5) return 'Feed in a chair that supports your lower back — posture matters for the long run.';
    return 'Three weeks. Notice one thing that feels easier than your first week.';
  }

  // Week 4 (days 21-27): fourth trimester wall
  if (week < 4) {
    if (day <= 2) return 'Gentle core activation: draw navel gently toward spine as you breathe out. No crunches yet.';
    if (day <= 4) return 'Outdoor walk of 10–15 min if weather allows. Sunlight and fresh air help more than you think.';
    return 'Four weeks — many parents hit a wall here. This is not failure; it\'s the fourth trimester doing its thing.';
  }

  // Week 5-6: building towards 6-week check
  if (week < 7) {
    if (week === 5) return 'Short tummy-time sessions while baby is alert — a few minutes, several times a day.';
    return 'Six-week check-up landmark. Ready to discuss contraception, return to exercise, and your mental health.';
  }

  // Months 2-3: more activity, more interaction
  if (week < 13) {
    if (week <= 9)  return 'Short outdoor walk daily if you can. The rhythm helps baby settle and helps you decompress.';
    if (week <= 11) return 'Read a short book aloud, or just narrate your day. Baby is learning your voice and tone.';
    return 'Tummy time, floor play, and lots of face time. The social smiles are starting — soak them in.';
  }

  // Month 3-5: tummy time + language
  if (week < 24) return 'Tummy time a few times today — 3–5 min sessions, working up to 20 min total. Baby is getting stronger fast.';

  // 6 months+
  return 'Floor play and tummy time, and narrate what you are doing. Language development is in full swing.';
}

export function ageDaysOf(baby, now = new Date()) {
  if (!baby.birth_date) return null;
  return Math.floor(
    (new Date(`${currentRowDateStr(now)}T00:00:00Z`) - new Date(`${baby.birth_date}T00:00:00Z`)) / 864e5
  );
}

export function composeBrief({ baby, yesterday, avg7, focus, forDad = false }) {
  const lines = [`Good morning 🌤 Here's ${baby.name}'s yesterday (7pm to 7pm).`];
  if (!yesterday || yesterday.source === 'none') {
    lines.push('', "No line for yesterday yet. Snap the notebook tonight and I'll catch up.");
  } else {
    const src = yesterday.source === 'paper' ? 'from the notebook' : 'from quick taps';
    lines.push('',
      `😴 Sleep ${hrs(yesterday.sleep_min)} · night ${hrs(yesterday.night_sleep_min)} · longest ${hrs(yesterday.longest_stretch_min)} · ${yesterday.naps} nap${yesterday.naps === 1 ? '' : 's'}`,
      `🍼 ${yesterday.feeds} feed${yesterday.feeds === 1 ? '' : 's'}${yesterday.wet != null ? ` · 🧷 ${yesterday.wet} wet, ${yesterday.dirty} dirty` : ''}`,
      `(${src})`);
  }
  if (avg7 && avg7.days_with_data >= 3) {
    lines.push('', `Last ${avg7.days_with_data} days on average: ${hrs(avg7.sleep_min)} sleep, ${avg7.feeds} feeds.`);
  }
  if (focus) lines.push('', `Today: ${focus}`);
  if (forDad) lines.push('', 'And check in on mum: water, food, a proper rest if she can.');
  return lines.join('\n');
}

export async function sendBabyBrief(bot, user, queries, { focusFor = defaultFocus, now = new Date() } = {}) {
  const baby = await queries.babyFor(user.id);
  if (!baby) return null;
  const [yesterday, avg7] = await Promise.all([
    queries.lastCompleteDay(baby.id, now),
    queries.averages(baby.id, 7),
  ]);
  const focus = await focusFor(ageDaysOf(baby, now), baby);
  const text = composeBrief({ baby, yesterday, avg7, focus, forDad: baby.role === 'father' });
  await bot.telegram.sendMessage(user.chat_id || user.id, text);
  return text;
}

export async function sendMorningBriefs(bot, queries, { focusFor = defaultFocus, now = new Date() } = {}) {
  const caregivers = await queries.allCaregivers();
  const cache = new Map();
  let sent = 0;
  for (const c of caregivers) {
    const baby = c.babies;
    if (!cache.has(baby.id)) {
      const [yesterday, avg7] = await Promise.all([
        queries.lastCompleteDay(baby.id, now),
        queries.averages(baby.id, 7),
      ]);
      cache.set(baby.id, { yesterday, avg7 });
    }
    const { yesterday, avg7 } = cache.get(baby.id);
    const text = composeBrief({
      baby, yesterday, avg7,
      focus: await focusFor(ageDaysOf(baby, now), baby),
      forDad: c.role === 'father',
    });
    try {
      await bot.telegram.sendMessage(c.telegram_user_id, text);
      sent += 1;
    } catch (e) {
      console.error('baby brief failed for', c.telegram_user_id, e.description || e.message);
    }
  }
  return sent;
}

export { defaultFocus };
