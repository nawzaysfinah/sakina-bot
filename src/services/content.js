/**
 * Content service — returns today's tasks for each mode
 * based on the user's current day/week.
 */

import birthPlanData from '../data/birthPlan.json' with { type: 'json' };
import babyDevData   from '../data/babyDev.json'   with { type: 'json' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(dateStr) {
  const target = new Date(dateStr);
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((today - target) / 86400000);
}

function weeksBetween(dateStr) {
  return Math.floor(daysBetween(dateStr) / 7);
}

// ─── Prepare mode ─────────────────────────────────────────────────────────────

export function getPrepareContent(user) {
  const daysUntilDue = -daysBetween(user.due_date);
  const currentWeek  = Math.max(32, 40 - Math.floor(daysUntilDue / 7));
  const weekData     = birthPlanData.find(w => w.week === currentWeek)
                    || birthPlanData[birthPlanData.length - 1];

  return {
    header: `🌱 *Week ${weekData.week} — ${weekData.theme}*`,
    weekendTasks: weekData.weekendTasks,
    dailyHabits:  weekData.dailyHabits,
    currentWeek:  weekData.week,
    weekId:       weekData.week,
  };
}

// ─── Recover mode ─────────────────────────────────────────────────────────────

// Key recovery tasks per day range — a curated subset of the full 44-day plan
const recoverTasks = {
  range: (start, end, tasks) => ({ start, end, tasks }),
};

const RECOVER_SCHEDULE = [
  { start: 1, end: 7, tasks: [
    { id: 'r-rest', text: 'Full rest — sleep when baby sleeps. This is a prescription, not a suggestion' },
    { id: 'r-nofeed', text: 'Three full meals — do not skip. Focus on warm, easy-to-digest foods' },
    { id: 'r-novisit', text: 'No visitors today — recovery needs quiet' },
    { id: 'r-jamu', text: 'Take your morning jamu / herbal drink' },
    { id: 'r-prayer', text: 'Morning prayer and intention before anything else' },
  ]},
  { start: 8, end: 21, tasks: [
    { id: 'r-breathe', text: 'Deep breathing 5 min — inhale 4 counts, exhale 6 counts' },
    { id: 'r-jamu', text: 'Morning jamu / herbal drink' },
    { id: 'r-meals', text: 'Three full meals — warm, nourishing, no cold foods' },
    { id: 'r-prayer', text: 'Morning prayer and intention' },
  ]},
  { start: 22, end: 44, tasks: [
    { id: 'r-walk', text: 'Light walk 10–15 min inside the home' },
    { id: 'r-meals', text: 'Three full meals' },
    { id: 'r-jamu', text: 'Morning jamu / herbal drink' },
    { id: 'r-prayer', text: 'Morning prayer and intention' },
  ]},
];

export function getRecoverContent(user) {
  const day = Math.min(44, Math.max(1, daysBetween(user.baby_dob) + 1));
  const schedule = RECOVER_SCHEDULE.find(s => day >= s.start && day <= s.end)
                || RECOVER_SCHEDULE[RECOVER_SCHEDULE.length - 1];

  const isMassageDay = day % 7 === 0;
  const tasks = [...schedule.tasks];
  if (isMassageDay) {
    tasks.push({ id: 'r-massage', text: '💆 Full urutan massage today — 60–90 min. Book your therapist' });
  }

  return {
    header: `🌿 *Day ${day} of 44 — Postpartum Recovery*`,
    tasks,
    currentDay: day,
  };
}

// ─── Tumbuh mode ──────────────────────────────────────────────────────────────

export function getTumbuhContent(user) {
  const babyWeeks = weeksBetween(user.baby_dob);
  const phase     = getPhaseForWeeks(babyWeeks);
  const weekData  = getWeekDataForAge(babyWeeks);

  if (!weekData) {
    return { header: `🌸 *Baby is ${babyWeeks} weeks old*`, tasks: [], milestones: [] };
  }

  const tasks = [
    ...weekData.motor.map(t => ({ ...t, category: 'motor' })),
    ...weekData.social.map(t => ({ ...t, category: 'social' })),
    ...weekData.cognitive.map(t => ({ ...t, category: 'cognitive' })),
  ];

  return {
    header: `🌸 *${weekData.label} — ${weekData.theme}*`,
    header2: phase ? `Phase: ${phase.label} · ${phase.sublabel}` : '',
    tasks,
    milestones: weekData.watch || [],
    babyWeeks,
  };
}

function getPhaseForWeeks(weeks) {
  if (weeks < 5)  return babyDevData[0];
  if (weeks < 9)  return babyDevData[1];
  if (weeks < 13) return babyDevData[2];
  if (weeks < 28) return babyDevData[3];
  if (weeks < 40) return babyDevData[4];
  return babyDevData[5];
}

function getWeekDataForAge(weeks) {
  for (const phase of babyDevData) {
    for (const wk of phase.weeks) {
      // Match by id ranges
      if (wk.id === 'w1'    && weeks < 2)  return wk;
      if (wk.id === 'w2-3'  && weeks >= 2  && weeks < 4) return wk;
      if (wk.id === 'w4'    && weeks >= 4  && weeks < 5) return wk;
      if (wk.id === 'w5-6'  && weeks >= 5  && weeks < 7) return wk;
      if (wk.id === 'w7-8'  && weeks >= 7  && weeks < 9) return wk;
      if (wk.id === 'w9-10' && weeks >= 9  && weeks < 11) return wk;
      if (wk.id === 'w11-12'&& weeks >= 11 && weeks < 13) return wk;
      if (wk.id === 'm4'    && weeks >= 13 && weeks < 22) return wk;
      if (wk.id === 'm5-6'  && weeks >= 22 && weeks < 28) return wk;
      if (wk.id === 'm7-8'  && weeks >= 28 && weeks < 36) return wk;
      if (wk.id === 'm9'    && weeks >= 36 && weeks < 40) return wk;
      if (wk.id === 'm10-11'&& weeks >= 40 && weeks < 48) return wk;
      if (wk.id === 'm12'   && weeks >= 48) return wk;
    }
  }
  return null;
}

// ─── Format helpers ───────────────────────────────────────────────────────────

export function formatDailyBriefing(user, completedIds) {
  const lines = [];

  if (user.mode === 'prepare' || !user.baby_dob) {
    const c = getPrepareContent(user);
    lines.push(c.header);
    lines.push('');
    if (c.weekendTasks.length) {
      lines.push('📅 *This weekend:*');
      c.weekendTasks.forEach(t => {
        const done = completedIds.includes(t.id);
        lines.push(`${done ? '✅' : '◻️'} ${t.text}`);
      });
    }
    if (c.dailyHabits.length) {
      lines.push('');
      lines.push('🔄 *Daily habits:*');
      c.dailyHabits.forEach(t => {
        const done = completedIds.includes(t.id);
        lines.push(`${done ? '✅' : '◻️'} ${t.text}`);
      });
    }
    return { text: lines.join('\n'), allTaskIds: [...c.weekendTasks, ...c.dailyHabits].map(t => t.id) };
  }

  if (user.mode === 'recover') {
    const c = getRecoverContent(user);
    lines.push(c.header);
    lines.push('');
    c.tasks.forEach(t => {
      const done = completedIds.includes(t.id);
      lines.push(`${done ? '✅' : '◻️'} ${t.text}`);
    });
    return { text: lines.join('\n'), allTaskIds: c.tasks.map(t => t.id) };
  }

  if (user.mode === 'tumbuh') {
    const c = getTumbuhContent(user);
    lines.push(c.header);
    if (c.header2) lines.push(`_${c.header2}_`);
    lines.push('');

    const motor    = c.tasks.filter(t => t.category === 'motor');
    const social   = c.tasks.filter(t => t.category === 'social');
    const cognitive= c.tasks.filter(t => t.category === 'cognitive');

    if (motor.length) {
      lines.push('🟢 *Motor:*');
      motor.forEach(t => lines.push(`${completedIds.includes(t.id) ? '✅' : '◻️'} ${t.text}`));
    }
    if (social.length) {
      lines.push('');
      lines.push('🩷 *Social & emotional:*');
      social.forEach(t => lines.push(`${completedIds.includes(t.id) ? '✅' : '◻️'} ${t.text}`));
    }
    if (cognitive.length) {
      lines.push('');
      lines.push('🔵 *Cognitive & language:*');
      cognitive.forEach(t => lines.push(`${completedIds.includes(t.id) ? '✅' : '◻️'} ${t.text}`));
    }
    if (c.milestones.length) {
      lines.push('');
      lines.push('👀 *Watch for these milestones:*');
      c.milestones.forEach(m => lines.push(`◆ _${m}_`));
    }

    return { text: lines.join('\n'), allTaskIds: c.tasks.map(t => t.id) };
  }

  return { text: 'No content for this mode.', allTaskIds: [] };
}
