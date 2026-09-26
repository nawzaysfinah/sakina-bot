// Morning brief: yesterday's line, 7-day average, and one developmental focus.
// Merged into Sakina's existing 7am brief in scheduler.js — not sent separately.
// Neutral tone: no scores, no "good/bad day", no comparisons.

import { hrs, currentRowDateStr, addDays } from './format.js';

function defaultFocus(ageDays) {
  if (ageDays == null) return null;
  const week = Math.floor(ageDays / 7);
  if (week < 2) return 'Lots of skin-to-skin, and a little supervised tummy time on your chest.';
  if (week < 8) return 'A few short tummy-time sessions while baby is awake and watched, and plenty of talking and singing.';
  if (week < 16) return 'Tummy time a few times today, and read a short book aloud. Baby is learning your voice.';
  return 'Floor play and tummy time, and narrate what you are doing. It all feeds language.';
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
