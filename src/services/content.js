/**
 * Content service — returns today's tasks for each mode.
 *
 * Key features:
 *  - Prepare: week-by-week from birthPlan.json
 *  - Recover: two tracks — vaginal (default) and cesarean
 *  - Tumbuh: milestone-gated with optional phase override
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

// ─── Recover mode — vaginal track ─────────────────────────────────────────────

const RECOVER_VAGINAL = [
  { start: 1, end: 7, tasks: [
    { id: 'r-rest',    text: 'Full rest — sleep when baby sleeps. This is a prescription, not a suggestion' },
    { id: 'r-meals',   text: 'Three full meals — warm, easy-to-digest foods. No skipping' },
    { id: 'r-novisit', text: 'Limit visitors — recovery needs quiet and undisturbed rest' },
    { id: 'r-jamu',    text: 'Take your morning jamu / herbal drink (bengkung, turmeric, halia)' },
    { id: 'r-prayer',  text: 'Morning prayer and intention before anything else' },
    { id: 'r-pf1',     text: 'Pelvic floor squeeze — 10 gentle holds, 5 sec each (start Day 1)' },
  ]},
  { start: 8, end: 21, tasks: [
    { id: 'r-breathe', text: 'Deep breathing 5 min — 4 counts in, 6 counts out' },
    { id: 'r-jamu',    text: 'Morning jamu / herbal drink' },
    { id: 'r-meals',   text: 'Three full meals — warm, nourishing, no cold foods' },
    { id: 'r-prayer',  text: 'Morning prayer and intention' },
    { id: 'r-pf2',     text: 'Pelvic floor + gentle core breathing — 3 × 10 reps' },
  ]},
  { start: 22, end: 44, tasks: [
    { id: 'r-walk',    text: 'Light walk 10–15 min inside the home or gentle outdoor stroll' },
    { id: 'r-meals',   text: 'Three full meals' },
    { id: 'r-jamu',    text: 'Morning jamu / herbal drink' },
    { id: 'r-prayer',  text: 'Morning prayer and intention' },
    { id: 'r-core',    text: 'Gentle core activation — diaphragmatic breathing + pelvic floor 3 × 10' },
  ]},
];

// ─── Recover mode — cesarean track ────────────────────────────────────────────
// C-section is major abdominal surgery (cutting 7 layers). Recovery timeline:
//  Days 1-3:   Hospital. Catheter, IV, assisted position changes only.
//  Days 4-7:   Home. Very restricted. No lifting. Wound care daily.
//  Days 8-14:  Short walks (bathroom → kitchen). Wound healing. No jamu yet.
//  Days 15-21: 5-min indoor walks. Jamu carefully (check wound healing). No driving.
//  Days 22-44: Build to 10–15 min walks. Scar massage from Day 21+. Still no heavy lifting.

const RECOVER_CESAREAN = [
  { start: 1, end: 3, tasks: [
    { id: 'cs-rest',    text: '🏥 Complete bed rest — you are recovering from major surgery. Do not get up without help' },
    { id: 'cs-cath',    text: 'Catheter care — let nursing staff handle removal (usually Day 1–2)' },
    { id: 'cs-fluid',   text: 'Sip fluids slowly — clear liquids first, then progress as directed by doctor' },
    { id: 'cs-turn',    text: 'Assisted position changes every 2–3 hours to prevent clots — call nurse for help' },
    { id: 'cs-pain',    text: 'Take prescribed pain relief on schedule — do not wait until pain is severe' },
    { id: 'cs-prayer',  text: 'Morning prayer and intention — you did something immense 🌿' },
  ]},
  { start: 4, end: 7, tasks: [
    { id: 'cs-rest2',   text: 'Rest prioritised — short walks to toilet only, supported by a person. No stairs yet' },
    { id: 'cs-wound',   text: 'Wound dressing check — keep dry and clean. Report redness, warmth, or discharge to doctor' },
    { id: 'cs-nolift',  text: 'No lifting anything heavier than your baby. Ask for help with everything else' },
    { id: 'cs-meals',   text: 'Three small, warm meals — easy-to-digest foods. Avoid constipation (straining strains wound)' },
    { id: 'cs-prayer',  text: 'Morning prayer and intention' },
    { id: 'cs-breath',  text: 'Deep breathing 5 min — gentle, no straining. Helps prevent lung complications' },
  ]},
  { start: 8, end: 14, tasks: [
    { id: 'cs-walk1',   text: 'Short walk inside house — kitchen and back. Increase by 1–2 min daily. Rest if pain' },
    { id: 'cs-wound2',  text: 'Wound care — keep clean and dry. Scar is still healing internally' },
    { id: 'cs-meals2',  text: 'Three full warm meals — fibre-rich to prevent constipation, warm fluids' },
    { id: 'cs-nolift2', text: 'No lifting above baby weight. No driving. No stairs repeatedly' },
    { id: 'cs-prayer',  text: 'Morning prayer and intention' },
    { id: 'cs-breath2', text: 'Diaphragmatic breathing 5–10 min — helps the abdominal wall relearn its function' },
  ]},
  { start: 15, end: 21, tasks: [
    { id: 'cs-walk2',   text: 'Walk 5 min indoors — gentle, supported. Outdoors only if feeling strong and weather is good' },
    { id: 'cs-jamu',    text: 'Jamu can begin carefully now if wound is well-healed — consult with bidan or doctor' },
    { id: 'cs-meals3',  text: 'Three full warm meals — increase protein for wound healing' },
    { id: 'cs-prayer',  text: 'Morning prayer and intention' },
    { id: 'cs-pf',      text: 'Pelvic floor squeezes — gentle, 10 × 5 sec holds. No ab crunches yet' },
    { id: 'cs-nodrive', text: 'No driving — emergency braking requires abdominal force you cannot safely apply yet' },
  ]},
  { start: 22, end: 44, tasks: [
    { id: 'cs-walk3',   text: 'Walk 10–15 min daily — building slowly. Stop if pulling sensation near wound' },
    { id: 'cs-scar',    text: 'Scar massage 2 min — once wound is fully closed (usually Day 21+). Circular motions with Bio-Oil or coconut oil' },
    { id: 'cs-meals4',  text: 'Three full meals — continue warm foods, good hydration for breastfeeding' },
    { id: 'cs-jamu2',   text: 'Morning jamu / herbal drink' },
    { id: 'cs-prayer',  text: 'Morning prayer and intention' },
    { id: 'cs-pf2',     text: 'Pelvic floor + gentle core breathing — 3 × 10. Still no sit-ups or planks until 3 months' },
  ]},
];

export function getRecoverContent(user) {
  const day      = Math.min(44, Math.max(1, daysBetween(user.baby_dob) + 1));
  const isCSection = user.delivery_type === 'cesarean';
  const schedule = isCSection ? RECOVER_CESAREAN : RECOVER_VAGINAL;

  const slot = schedule.find(s => day >= s.start && day <= s.end)
            || schedule[schedule.length - 1];

  const tasks = [...slot.tasks];

  // Urutan massage every 7 days (vaginal only — C-section has scar massage instead)
  if (!isCSection && day % 7 === 0) {
    tasks.push({ id: 'r-massage', text: '💆 Full urutan massage today — 60–90 min. Book your therapist' });
  }

  const header = isCSection
    ? `🔷 *Day ${day} of 44 — C-Section Recovery*`
    : `🌿 *Day ${day} of 44 — Postpartum Recovery*`;

  return { header, tasks, currentDay: day, isCSection };
}

// ─── Tumbuh mode — milestone-gated ────────────────────────────────────────────

export function getTumbuhContent(user) {
  const babyWeeks = weeksBetween(user.baby_dob);

  // Allow override from DB (milestone gating)
  const weekId = user.tumbuh_week_id || null;
  const weekData = weekId
    ? findWeekById(weekId)
    : getWeekDataForAge(babyWeeks);

  const phase = getPhaseForWeeks(babyWeeks);

  if (!weekData) {
    return { header: `🌸 *Baby is ${babyWeeks} weeks old*`, tasks: [], milestones: [], babyWeeks, weekId: null };
  }

  const tasks = [
    ...weekData.motor.map(t => ({ ...t, category: 'motor' })),
    ...weekData.social.map(t => ({ ...t, category: 'social' })),
    ...weekData.cognitive.map(t => ({ ...t, category: 'cognitive' })),
  ];

  // Warn if showing override week vs actual age
  let ageWarning = '';
  if (weekId && weekId !== getWeekDataForAge(babyWeeks)?.id) {
    ageWarning = `_⚠️ Showing milestone week — baby is ${babyWeeks} weeks old but working on ${weekData.label}_`;
  }

  return {
    header:     `🌸 *${weekData.label} — ${weekData.theme}*`,
    header2:    phase ? `Phase: ${phase.label} · ${phase.sublabel}` : '',
    ageWarning,
    tasks,
    milestones: weekData.watch || [],
    babyWeeks,
    weekId:     weekData.id,
    nextWeekId: getNextWeekId(weekData.id),
  };
}

export function getNextWeekId(currentId) {
  const ALL_WEEK_IDS = [
    'w1', 'w2-3', 'w4', 'w5-6', 'w7-8', 'w9-10', 'w11-12',
    'm4', 'm5-6', 'm7-8', 'm9', 'm10-11', 'm12'
  ];
  const idx = ALL_WEEK_IDS.indexOf(currentId);
  return idx >= 0 && idx < ALL_WEEK_IDS.length - 1 ? ALL_WEEK_IDS[idx + 1] : null;
}

function findWeekById(weekId) {
  for (const phase of babyDevData) {
    for (const wk of phase.weeks) {
      if (wk.id === weekId) return wk;
    }
  }
  return null;
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
      if (wk.id === 'w1'     && weeks < 2)  return wk;
      if (wk.id === 'w2-3'   && weeks >= 2  && weeks < 4)  return wk;
      if (wk.id === 'w4'     && weeks >= 4  && weeks < 5)  return wk;
      if (wk.id === 'w5-6'   && weeks >= 5  && weeks < 7)  return wk;
      if (wk.id === 'w7-8'   && weeks >= 7  && weeks < 9)  return wk;
      if (wk.id === 'w9-10'  && weeks >= 9  && weeks < 11) return wk;
      if (wk.id === 'w11-12' && weeks >= 11 && weeks < 13) return wk;
      if (wk.id === 'm4'     && weeks >= 13 && weeks < 22) return wk;
      if (wk.id === 'm5-6'   && weeks >= 22 && weeks < 28) return wk;
      if (wk.id === 'm7-8'   && weeks >= 28 && weeks < 36) return wk;
      if (wk.id === 'm9'     && weeks >= 36 && weeks < 40) return wk;
      if (wk.id === 'm10-11' && weeks >= 40 && weeks < 48) return wk;
      if (wk.id === 'm12'    && weeks >= 48) return wk;
    }
  }
  return null;
}

// ─── Dad mode — baby care + mum support, week/day-aware ──────────────────────

const DAD_BABY = [
  { start: 0, end: 6, tasks: [
    { id: 'd-b-skin',    text: 'Skin-to-skin 30 min — shirt off, baby chest-to-chest. Calms them and builds your bond' },
    { id: 'd-b-nappy',   text: 'Handle all overnight nappy changes so mum only needs to feed' },
    { id: 'd-b-cues',    text: 'Learn hunger cues — rooting, fists to mouth, stirring — so you can pass baby before crying starts' },
    { id: 'd-b-wind',    text: 'Wind baby after every feed — upright on shoulder, gentle circular rub on the back' },
    { id: 'd-b-swaddle', text: 'Practice swaddling snugly — a good swaddle is one of the best settling tools you have' },
  ]},
  { start: 7, end: 20, tasks: [
    { id: 'd-b-skin2',   text: 'Skin-to-skin daily — your body temperature regulates theirs and your presence reduces cortisol' },
    { id: 'd-b-settle',  text: 'Do one overnight settle solo — let mum sleep at least 4 hours straight' },
    { id: 'd-b-bath',    text: "Bath time is yours — 37°C water, one hand on baby at all times, never walk away" },
    { id: 'd-b-5s',      text: 'When baby is unsettled: swaddle, side-lying hold, shush, gentle swing, offer dummy' },
    { id: 'd-b-wind2',   text: 'Wind and burp after every feed — try different positions (shoulder, lap face-down, seated)' },
  ]},
  { start: 21, end: 41, tasks: [
    { id: 'd-b-talk',    text: 'Talk to baby constantly — narrate what you are doing. Language wiring starts now' },
    { id: 'd-b-tummy',   text: 'Tummy time on your chest or the mat — 2-3 min while baby is awake and alert, 2-3 times today' },
    { id: 'd-b-read',    text: 'Read one short book aloud. Any book. Your voice is what matters, not the words' },
    { id: 'd-b-solo',    text: 'Solo baby duty 30 min — give mum a real break with no interruptions' },
  ]},
  { start: 42, end: 83, tasks: [
    { id: 'd-b-tummy2',  text: 'Tummy time on the floor mat, 3 times today while baby is awake — builds neck and core strength' },
    { id: 'd-b-faces',   text: 'Make faces and hold baby 20-30cm from your face — they are learning to track and mirror' },
    { id: 'd-b-read2',   text: 'Read aloud together — board books with high contrast and simple shapes are best now' },
    { id: 'd-b-break',   text: 'Give mum a 2-hour uninterrupted break today — she goes out or rests, you handle baby fully' },
  ]},
  { start: 84, end: 999, tasks: [
    { id: 'd-b-floor',   text: 'Floor play and tummy time, 3 sessions today — rolling, reaching, exploring is how they learn' },
    { id: 'd-b-babble',  text: 'Respond to every babble — pause, let baby "answer", respond back. They are learning conversation' },
    { id: 'd-b-read3',   text: 'Read aloud daily — it is the single best thing you can do for language development' },
    { id: 'd-b-solo2',   text: "Give mum an afternoon off — she needs time that is completely hers, not on call" },
  ]},
];

const DAD_MUM_VAGINAL = [
  { start: 1, end: 7, tasks: [
    { id: 'd-m-water',   text: 'Bring mum water every time baby feeds — breastfeeding dehydrates fast and she may forget to ask' },
    { id: 'd-m-meals',   text: 'Cook or order three warm meals today — she should not be getting up to cook' },
    { id: 'd-m-visit',   text: 'Manage all visitors — she should not be entertaining anyone. You are the filter' },
    { id: 'd-m-sleep',   text: 'Take baby between feeds so she gets at least one 2-3 hour sleep block' },
    { id: 'd-m-mood',    text: 'Ask once how she is feeling — not how baby is doing, how she is doing. Then just listen' },
  ]},
  { start: 8, end: 21, tasks: [
    { id: 'd-m-water2',  text: 'Water at every feed — keep a large bottle near her feeding spot, refill it' },
    { id: 'd-m-meals2',  text: 'Three warm meals every day — she may forget to eat, especially during cluster feeding' },
    { id: 'd-m-night',   text: 'Aim for one 4-5 hour sleep block for her tonight — take the first half of the night' },
    { id: 'd-m-mood2',   text: 'Baby blues peak around Day 3-5 then usually lift. If she seems low past Day 10, gently raise seeing a doctor' },
    { id: 'd-m-check',   text: 'Check in on her physically — stitches healing, any pain, bleeding reducing?' },
  ]},
  { start: 22, end: 44, tasks: [
    { id: 'd-m-meals3',  text: 'Three meals and good hydration — this is still your job' },
    { id: 'd-m-out',     text: 'She may want more independence now — support a short walk or outing without baby if she wants' },
    { id: 'd-m-6wk',     text: '6-week check is coming — make sure the appointment is booked, offer to go together' },
    { id: 'd-m-mood3',   text: 'PND can emerge weeks after birth — keep noticing her emotional state, not just her physical recovery' },
  ]},
  { start: 45, end: 999, tasks: [
    { id: 'd-m-support', text: 'Her recovery is ongoing — continue meals, check-ins, and giving her real breaks' },
    { id: 'd-m-pnd',     text: 'PND can appear late — watch for persistent low mood, withdrawal, or feeling like she is not bonding with baby' },
    { id: 'd-m-time',    text: 'Give her time that is fully hers each week — not baby admin, not housework. Just hers' },
  ]},
];

const DAD_MUM_CESAREAN = [
  { start: 1, end: 7, tasks: [
    { id: 'd-m-cs-water', text: 'Water every single feed — dehydration slows wound healing and tanks milk supply' },
    { id: 'd-m-cs-lift',  text: 'She lifts nothing heavier than baby — you do everything else: laundry, bags, older kids' },
    { id: 'd-m-cs-wound', text: 'Wound check today — look for redness, swelling, warmth, or any discharge. Call clinic immediately if any' },
    { id: 'd-m-cs-meals', text: 'Three warm meals, fibre-rich — constipation and straining are dangerous for her wound right now' },
    { id: 'd-m-cs-stairs',text: 'Limit her stair use — one slow trip at a time, with you there if possible' },
    { id: 'd-m-cs-mood',  text: 'Ask how she is feeling — not just physically. C-section recovery is emotionally complex too' },
  ]},
  { start: 8, end: 21, tasks: [
    { id: 'd-m-cs-water2', text: 'Water at every feed — keep a full bottle within reach at all times' },
    { id: 'd-m-cs-wound2', text: 'Wound check — still healing internally even if the surface looks fine' },
    { id: 'd-m-cs-lift2',  text: 'No lifting rule still applies — no bags, no groceries, no carrying anything above baby weight' },
    { id: 'd-m-cs-meals2', text: 'Three warm meals — protein is important for wound healing right now' },
    { id: 'd-m-cs-night',  text: 'Take the first half of the night — she needs unbroken sleep for wound healing, not just rest' },
    { id: 'd-m-cs-mood2',  text: 'Baby blues peaking around Day 3-5. If mood is still low at Day 10, raise it gently — C-section PND is real' },
  ]},
  { start: 22, end: 44, tasks: [
    { id: 'd-m-cs-scar',  text: 'From Day 21: scar massage 2 min if wound is fully closed — circular motions, Bio-Oil or coconut oil' },
    { id: 'd-m-cs-meals3', text: 'Three meals and hydration — still her most important recovery inputs' },
    { id: 'd-m-cs-6wk',   text: '6-week check: make sure it is booked. This is a big milestone for C-section recovery' },
    { id: 'd-m-cs-mood3', text: 'Continue checking in emotionally — how does she feel about the birth? Does she feel like herself?' },
  ]},
  { start: 45, end: 999, tasks: [
    { id: 'd-m-cs-cont',  text: 'Her internal recovery continues long after the surface heals — she still needs meals, rest, and your attention' },
    { id: 'd-m-cs-pnd',   text: 'PND can emerge late — watch for persistent low mood, withdrawal, difficulty bonding' },
    { id: 'd-m-cs-time',  text: 'Give her time that is fully hers each week — not baby admin, not housework. Just hers' },
  ]},
];

export function getDadContent(babyDays, isCSection) {
  const mumDay = babyDays + 1;

  const babySlot = DAD_BABY.find(s => babyDays >= s.start && babyDays <= s.end)
    || DAD_BABY[DAD_BABY.length - 1];

  const mumSchedule = isCSection ? DAD_MUM_CESAREAN : DAD_MUM_VAGINAL;
  const mumSlot = mumSchedule.find(s => mumDay >= s.start && mumDay <= s.end)
    || mumSchedule[mumSchedule.length - 1];

  const babyWeeks = Math.floor(babyDays / 7);
  const ageLabel = babyDays < 14
    ? `Day ${babyDays + 1}`
    : babyWeeks < 16
    ? `Week ${babyWeeks}`
    : `${Math.floor(babyWeeks / 4.3)} months`;

  return {
    ageLabel,
    babyTasks: babySlot.tasks,
    mumTasks:  mumSlot.tasks,
    allTaskIds: [...babySlot.tasks, ...mumSlot.tasks].map(t => t.id),
  };
}

// ─── Vaccination schedule (Singapore NCIS) ────────────────────────────────────

const VACCINATION_SCHEDULE = [
  { label: 'Hepatitis B (dose 1)',                      offsetDays: 0   },
  { label: 'Hepatitis B (dose 2)',                      offsetDays: 30  },
  { label: 'DTaP + IPV + PCV + Hib + Rota (2 months)', offsetDays: 60  },
  { label: 'DTaP + IPV + PCV + Hib + Rota (4 months)', offsetDays: 120 },
  { label: 'DTaP + IPV + Hep B + PCV + Hib + Influenza (6 months)', offsetDays: 182 },
  { label: 'MMR + Varicella + Hep A (12 months)',       offsetDays: 365 },
  { label: 'DTaP + IPV booster + MMR (18 months)',      offsetDays: 547 },
];

export function getUpcomingVaccinations(babyDob, withinDays = 7) {
  const due = [];
  const dobDate = new Date(babyDob);

  for (const vax of VACCINATION_SCHEDULE) {
    const vaxDate = new Date(dobDate);
    vaxDate.setDate(vaxDate.getDate() + vax.offsetDays);

    const daysUntil = Math.round((vaxDate - new Date()) / 86400000);
    if (daysUntil >= 0 && daysUntil <= withinDays) {
      due.push({ ...vax, daysUntil, date: vaxDate.toISOString().split('T')[0] });
    }
  }
  return due;
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
    if (c.ageWarning) lines.push(c.ageWarning);
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
