// Quick-tap logging for the hours before the notebook is scanned.
// /log shows one message with buttons; every tap updates that message.
// Once the day's notebook line is confirmed, paper replaces these taps
// automatically (baby_events_effective view), so nothing is double counted.

import { Markup } from 'telegraf';
import { clock, span, statusLine, nightStatusLine, currentRowDateStr, addDays, dayLabel, hrs } from './format.js';
import { setFeedReminder, clearFeedReminder, getFeedReminder, setAutoFeedReminders, clearAutoFeedReminders } from './feedReminder.js';
import { fetchFeedWindow } from './feedWindow.js';

const UNDO_MINUTES  = 30;
const RETRO_TTL_MS  = 3 * 60 * 1000;  // 3 min to tap/type a structured value before pending expires
const NOTE_TTL_MS   = 15 * 60 * 1000; // 15 min for free-text note/question input (parents get interrupted)

// ── Retro state ───────────────────────────────────────────────────────────────
// userId → { kind, chatId, messageId, ts?, expiresAt }

const pendingRetro = new Map();

// ── Pending custom-value input ────────────────────────────────────────────────
// userId → { type: 'formula_amount'|'breast_amount'|'latch_duration', side?, chatId, messageId, expiresAt }

const pendingInput = new Map();

// ── Pending note text input ───────────────────────────────────────────────────
// userId → { chatId, messageId, retroTs: Date|null, isPdQuestion?, expiresAt }

const pendingNote = new Map();

// ── Last-feed detail for "repeat" smart default ───────────────────────────────
// userId → { detail, retroTs? } — short-lived, cleared when feed is logged or cancelled
const pendingFeedRepeat = new Map();

// ── Active latch timer ────────────────────────────────────────────────────────
// userId → { startedAt: Date, side: 'left'|'right'|'both'|null, retroTs: Date|null }
const activeLatch = new Map();

function getPendingNote(userId) {
  const p = pendingNote.get(userId);
  if (!p || Date.now() > p.expiresAt) { pendingNote.delete(userId); return null; }
  return p;
}

// ── Pending "when?" gate ──────────────────────────────────────────────────────
// userId → { kind, chatId, messageId, expiresAt }

const pendingAction = new Map();

function getPendingAction(userId) {
  const p = pendingAction.get(userId);
  if (!p || Date.now() > p.expiresAt) { pendingAction.delete(userId); return null; }
  return p;
}

function getRetro(userId) {
  const p = pendingRetro.get(userId);
  if (!p || Date.now() > p.expiresAt) { pendingRetro.delete(userId); return null; }
  return p;
}

function consumeRetroTime(userId) {
  const p = getRetro(userId);
  if (p?.ts) { pendingRetro.delete(userId); return p.ts; }
  return null;
}

function getPendingInput(userId) {
  const p = pendingInput.get(userId);
  if (!p || Date.now() > p.expiresAt) { pendingInput.delete(userId); return null; }
  return p;
}

// ── Time parsing ──────────────────────────────────────────────────────────────

function parseTimeStr(str) {
  const s = (str || '').toLowerCase().trim();
  let h, m = 0;
  const hmAp = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  const hAp  = s.match(/^(\d{1,2})\s*(am|pm)$/);
  if (hmAp) {
    h = +hmAp[1]; m = +hmAp[2];
    if (hmAp[3] === 'pm' && h < 12) h += 12;
    if (hmAp[3] === 'am' && h === 12) h = 0;
  } else if (hAp) {
    h = +hAp[1];
    if (hAp[2] === 'pm' && h < 12) h += 12;
    if (hAp[2] === 'am' && h === 12) h = 0;
  } else {
    return null;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  // Build UTC timestamp for h:m SGT today
  const now = new Date();
  const sgD = new Date(now.getTime() + 8 * 3600 * 1000);
  const ts  = new Date(Date.UTC(sgD.getUTCFullYear(), sgD.getUTCMonth(), sgD.getUTCDate(), h - 8, m));
  // If in the future (> 2 min), it means yesterday
  if (ts.getTime() > now.getTime() + 2 * 60 * 1000) ts.setUTCDate(ts.getUTCDate() - 1);
  return ts;
}

// ── Calendar-day helpers (no 7pm row boundary) ───────────────────────────────

function currentSgtDate(now = new Date()) {
  // Current calendar date in SGT — no 7pm shift, just the real date
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function dayBoundsUtc(dateStr) {
  // UTC ISO strings for midnight-to-midnight on an SGT calendar day
  // 00:00 SGT = UTC-8h from midnight UTC (SGT is UTC+8)
  const [y, m, d] = dateStr.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, d, -8, 0, 0, 0)).toISOString(),
    end:   new Date(Date.UTC(y, m - 1, d + 1, -8, 0, 0, 0)).toISOString(),
  };
}

// ── Timezone-aware clock ──────────────────────────────────────────────────────

function clockInTz(ts, tz = 'Asia/Singapore') {
  try {
    return new Date(ts).toLocaleString('en-SG', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
    }).toLowerCase().replace(/ /g, '');
  } catch {
    return clock(ts); // fallback to SGT if tz is invalid
  }
}

// ── Today's events display ────────────────────────────────────────────────────

function daySummary(events, now) {
  const feeds   = events.filter(e => e.kind === 'feed');
  const sleeps  = events.filter(e => e.kind === 'sleep');
  const diapers = events.filter(e => e.kind === 'diaper');

  const feedCount  = feeds.length;
  const totalMl    = feeds.reduce((s, e) => s + (e.detail?.amount_ml || 0), 0);
  const latchMin   = feeds
    .filter(e => e.detail?.type === 'latch')
    .reduce((s, e) => s + (e.detail?.duration_min || 0), 0);
  const sleepMs    = sleeps.reduce((s, e) => {
    const end = e.end_at ? new Date(e.end_at) : now;
    return s + Math.max(0, end - new Date(e.start_at));
  }, 0);
  const wet   = diapers.filter(e => e.detail?.wet).length;
  const dirty = diapers.filter(e => e.detail?.dirty).length;

  const parts = [];
  if (feedCount) {
    let f = `🍼 ${feedCount} feeds`;
    if (totalMl)  f += ` · ${totalMl}ml`;
    if (latchMin) f += ` · ${span(latchMin * 60000)} latch`;
    parts.push(f);
  }
  if (sleepMs) parts.push(`😴 ${span(sleepMs)}`);
  if (wet || dirty) parts.push(`🧷 W${wet} D${dirty}`);
  return parts.join('  ');
}

function formatTodayEvents(events, babyName, rowDate = currentSgtDate(), now = new Date(), tz = 'Asia/Singapore', feedWindow = null, nameMap = null) {
  const isToday = rowDate === currentSgtDate(now);
  if (!events?.length) {
    const header = isToday ? `*${babyName} today*` : `*${babyName} — ${dayLabel(rowDate)}*`;
    return `${header}\n\nNothing logged yet.`;
  }

  const summary = daySummary(events.filter(e => e.kind !== 'pd_question'), now);

  const lines = events.filter(e => e.kind !== 'pd_question').map(e => {
    const t = clockInTz(e.start_at, tz);
    let label;
    if (e.kind === 'feed') {
      const d = e.detail;
      if (d?.type === 'latch') {
        const side = d.side === 'left' ? 'L' : d.side === 'right' ? 'R' : 'B';
        label = `🤱 Latch (${side}${d.duration_min ? ` ${d.duration_min}m` : ''})`;
      } else if (d?.type === 'breast') {
        label = `🍼 Breast${d.amount_ml ? ` (${d.amount_ml}ml)` : ''}`;
      } else if (d?.type === 'formula') {
        label = `🍶 Formula${d.amount_ml ? ` (${d.amount_ml}ml)` : ''}`;
      } else {
        label = '🍼 Feed';
      }
    } else if (e.kind === 'sleep') {
      if (e.end_at) {
        label = `😴→☀️ Sleep ${span(new Date(e.end_at) - new Date(e.start_at))}`;
      } else {
        label = `😴 Asleep (${span(now - new Date(e.start_at))})`;
      }
    } else if (e.kind === 'diaper') {
      const d = e.detail;
      const k = [d?.wet && 'wet', d?.dirty && 'dirty'].filter(Boolean).join('+');
      label = k === 'wet+dirty' ? '💧💩 Diaper' : k === 'wet' ? '💧 Wet' : '💩 Dirty';
    } else if (e.kind === 'note') {
      label = `📝 ${e.detail?.text || '(note)'}`;
    } else {
      label = e.kind;
    }
    const who = nameMap && e.logged_by && nameMap[String(e.logged_by)] ? ` · _${nameMap[String(e.logged_by)]}_` : '';
    return `\`${t}\`  ${label}${who}`;
  });

  let nextFeedLine = '';
  if (isToday) {
    const lastFeed = events.filter(e => e.kind === 'feed').at(-1);
    if (lastFeed) {
      if (feedWindow) {
        const pred  = new Date(feedWindow.predictedMs);
        const cap   = new Date(feedWindow.hardCapMs);
        const nowMs = now.getTime();
        if (feedWindow.predictedMs > nowMs) {
          const inStr = `In ${span(feedWindow.predictedMs - nowMs)}`;
          nextFeedLine = `\n\n🔮 ~${clockInTz(pred, tz)} (${inStr})\n⏰ by ${clockInTz(cap, tz)}`;
        } else {
          nextFeedLine = `\n\n⏰ Feed overdue · wake by ${clockInTz(cap, tz)}`;
        }
      } else {
        const nextAt = new Date(lastFeed.start_at).getTime() + 3 * 3600 * 1000;
        nextFeedLine = nextAt > now.getTime()
          ? `\n\n⏰ feed by ${clockInTz(new Date(nextAt), tz)}`
          : `\n\n⏰ feed overdue`;
      }
    }
  }

  const header = isToday ? `*${babyName} today*` : `*${babyName} — ${dayLabel(rowDate)}*`;
  const summaryBlock = summary ? `${summary}\n\n` : '';
  return `${header}\n\n${summaryBlock}${lines.join('\n')}${nextFeedLine}`;
}

function formatPeriodSummary(rows, babyName, days) {
  if (!rows?.length) return `*${babyName} — last ${days} days*\n\nNo data yet.`;
  const today = currentRowDateStr();

  let totalSleep = 0, totalFeeds = 0, totalWet = 0, totalDirty = 0, dataCount = 0;
  const lines = rows.map(r => {
    const isToday = r.row_date === today;
    const label   = `\`${dayLabel(r.row_date)}\``;
    if (r.source === 'none' && !isToday) return `${label}  —`;
    if (isToday) return `${label}  _(today)_`;
    const sleep = r.sleep_min ? `😴 ${hrs(r.sleep_min)}` : '';
    const feeds = r.feeds != null ? `🍼 ${r.feeds}` : '';
    const wet   = r.wet   != null ? `💧${r.wet}` : '';
    const dirty = r.dirty != null ? `💩${r.dirty}` : '';
    const parts = [sleep, feeds, wet, dirty].filter(Boolean);
    if (r.source !== 'none') { totalSleep += r.sleep_min || 0; totalFeeds += r.feeds || 0; totalWet += r.wet || 0; totalDirty += r.dirty || 0; dataCount++; }
    return `${label}  ${parts.join('  ')}`;
  });

  const avgLine = dataCount > 0
    ? `\nAvg: 😴 ${hrs(Math.round(totalSleep / dataCount))}  🍼 ${(totalFeeds / dataCount).toFixed(1)}  💧${(totalWet / dataCount).toFixed(1)}  💩${(totalDirty / dataCount).toFixed(1)}`
    : '';

  return `*${babyName} — last ${days} days*\n\n${lines.join('\n')}${avgLine}`;
}

function eventDeleteLabel(e) {
  const t = clock(e.start_at);
  if (e.kind === 'feed') {
    const d = e.detail;
    if (d?.type === 'latch') {
      const side = d.side === 'left' ? 'L' : d.side === 'right' ? 'R' : 'B';
      return `🤱 ${t}${d.duration_min ? ` · ${d.duration_min}m` : ''} (${side})`;
    }
    if (d?.type === 'breast') return `🍼 ${t}${d.amount_ml ? ` · ${d.amount_ml}ml` : ''} (BM)`;
    if (d?.type === 'formula') return `🍶 ${t}${d.amount_ml ? ` · ${d.amount_ml}ml` : ''}`;
    return `🍼 ${t}`;
  }
  if (e.kind === 'sleep') return e.end_at ? `😴 ${t} (closed)` : `😴 ${t} (open)`;
  if (e.kind === 'diaper') {
    const d = e.detail;
    const icon = (d?.wet && d?.dirty) ? '💧💩' : d?.wet ? '💧' : '💩';
    return `${icon} ${t}`;
  }
  if (e.kind === 'note') {
    const snippet = e.detail?.text ? ` "${e.detail.text.slice(0, 30)}${e.detail.text.length > 30 ? '…' : ''}"` : '';
    return `📝 ${t}${snippet}`;
  }
  return `${e.kind} ${t}`;
}

function logsNavKeyboard(dateStr) {
  const today = currentSgtDate();
  const prev  = addDays(dateStr, -1);
  const next  = addDays(dateStr, 1);
  const row1  = [
    Markup.button.callback(`⬅️ ${dayLabel(prev).split(' ')[0]}`, `logs:date:${prev}`),
  ];
  if (dateStr !== today) row1.push(Markup.button.callback('📋 Today', `logs:date:${today}`));
  if (next <= today)     row1.push(Markup.button.callback(`${dayLabel(next).split(' ')[0]} ➡️`, `logs:date:${next}`));
  return Markup.inlineKeyboard([
    row1,
    [Markup.button.callback('📊 7-day summary', 'logs:period:7'),
     Markup.button.callback('📊 14 days', 'logs:period:14')],
    [Markup.button.callback('🗑️ Delete an event', `logs:delmode:${dateStr}`)],
  ]);
}

function periodNavKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('7 days', 'logs:period:7'), Markup.button.callback('14 days', 'logs:period:14'),
     Markup.button.callback('30 days', 'logs:period:30')],
    [Markup.button.callback('📋 Today', `logs:date:${currentSgtDate()}`)],
  ]);
}

// ── Keyboards ─────────────────────────────────────────────────────────────────

function keyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🍼 Feed', 'tap:feed'), Markup.button.callback('😴 Asleep', 'tap:sleep')],
    [Markup.button.callback('💧 Wet', 'tap:wet'), Markup.button.callback('💩 Dirty', 'tap:dirty'),
      Markup.button.callback('💧💩 Both', 'tap:both')],
    [Markup.button.callback('📝 Note', 'tap:note'), Markup.button.callback('💊 PD', 'tap:pd'),
      Markup.button.callback('📋 Today', 'tap:history')],
    [Markup.button.callback('↩️ Undo last', 'tap:undo'), Markup.button.callback('⏰', 'tap:remind'),
      Markup.button.callback('🔄', 'tap:refresh')],
  ]);
}

function remindKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('2h', 'tap:remind:2'), Markup.button.callback('3h', 'tap:remind:3'),
     Markup.button.callback('4h', 'tap:remind:4'), Markup.button.callback('❌ Off', 'tap:remind:off')],
  ]);
}

function isSgtNight(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', hour: 'numeric', hour12: false }).format(now));
  return h >= 22 || h < 6;
}

function whenKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Now', 'tap:when:now'),
     Markup.button.callback('⏰ Enter time', 'tap:when:custom')],
    [Markup.button.callback('❌ Cancel', 'tap:back')],
  ]);
}

function feedRepeatLabel(d) {
  if (!d) return null;
  if (d.type === 'latch') {
    const s = d.side === 'left' ? 'L' : d.side === 'right' ? 'R' : d.side === 'both' ? 'B' : '';
    return `🤱 Latch${s ? ' ' + s : ''}${d.duration_min ? ' ' + d.duration_min + 'm' : ''}`;
  }
  if (d.type === 'breast') return `🍼 Breast${d.amount_ml ? ' ' + d.amount_ml + 'ml' : ''}`;
  if (d.type === 'formula') return `🍶 Formula${d.amount_ml ? ' ' + d.amount_ml + 'ml' : ''}`;
  return null;
}

function feedTypeKeyboard(lastFeedDetail = null) {
  const rows = [];
  const label = feedRepeatLabel(lastFeedDetail);
  if (label) rows.push([Markup.button.callback(`↩️ Same: ${label}`, 'tap:feed:repeat')]);
  rows.push([
    Markup.button.callback('🤱 Latch',   'tap:feed:latch'),
    Markup.button.callback('🍼 Breast',  'tap:feed:breast'),
    Markup.button.callback('🍶 Formula', 'tap:feed:formula'),
  ]);
  rows.push([Markup.button.callback('⏭ Skip', 'tap:feed:skip')]);
  return Markup.inlineKeyboard(rows);
}

function latchSideKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Left',  'tap:feed:latch:L'),
     Markup.button.callback('➡️ Right', 'tap:feed:latch:R'),
     Markup.button.callback('↔️ Both',  'tap:feed:latch:B')],
    [Markup.button.callback('⏱ Start timer', 'tap:feed:latch:timer'),
     Markup.button.callback('⏭ Skip', 'tap:feed:latch:skip')],
  ]);
}

function latchTimerKeyboard(side) {
  const sLabel = side === 'L' ? '⬅️' : side === 'R' ? '➡️' : side ? '↔️' : '';
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${sLabel} Switch side`, 'tap:latch:switch'),
     Markup.button.callback('🛑 Stop', 'tap:latch:stop')],
  ]);
}

function latchDurationKeyboard(side) {
  return Markup.inlineKeyboard([
    [5, 10, 15, 20, 30].map(d => Markup.button.callback(`${d}m`, `tap:feed:latch:${side}:${d}`)),
    [Markup.button.callback('✏️ Other', `tap:feed:latch:${side}:custom`),
     Markup.button.callback('⏭ Skip', `tap:feed:latch:${side}:skip`)],
  ]);
}

function breastAmountKeyboard() {
  return Markup.inlineKeyboard([
    [10, 15, 30, 60].map(ml => Markup.button.callback(`${ml}ml`, `tap:feed:breast:${ml}`)),
    [90, 120].map(ml => Markup.button.callback(`${ml}ml`, `tap:feed:breast:${ml}`))
      .concat([Markup.button.callback('✏️ Other', 'tap:feed:breast:custom')]),
    [Markup.button.callback('⏭ Skip', 'tap:feed:breast:skip')],
  ]);
}

function formulaAmountKeyboard() {
  return Markup.inlineKeyboard([
    [10, 15, 30, 60].map(ml => Markup.button.callback(`${ml}ml`, `tap:feed:formula:${ml}`)),
    [90, 120].map(ml => Markup.button.callback(`${ml}ml`, `tap:feed:formula:${ml}`))
      .concat([Markup.button.callback('✏️ Other', 'tap:feed:formula:custom')]),
    [Markup.button.callback('⏭ Skip', 'tap:feed:formula:skip')],
  ]);
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerTapLog(bot, { supabase, queries }) {
  const q = queries;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  // Returns { userId: firstName } for all caregivers of this baby, excluding the viewer.
  async function caregiverNames(babyId, viewerUserId) {
    const { data } = await supabase.from('users')
      .select('id, name')
      .or(`id.eq.${babyId},linked_user_id.eq.${babyId}`)
      .neq('id', viewerUserId);
    if (!data?.length) return null;
    const map = {};
    for (const u of data) {
      if (u.name) map[String(u.id)] = u.name.split(' ')[0]; // first name only
    }
    return Object.keys(map).length ? map : null;
  }

  function latchTimerLine(userId, now = new Date()) {
    const t = activeLatch.get(String(userId));
    if (!t) return null;
    const elapsed = Math.round((now - t.startedAt) / 60000);
    const sLabel  = t.side === 'left' ? ' ⬅️' : t.side === 'right' ? ' ➡️' : t.side === 'both' ? ' ↔️' : '';
    return `🤱 latching${sLabel} — ${elapsed}m`;
  }

  async function render(ctx, baby, note) {
    const [st, names] = await Promise.all([
      q.status(baby.id),
      caregiverNames(baby.id, ctx.from.id),
    ]);
    const now = new Date();
    const fw  = st?.last_feed
      ? await fetchFeedWindow(baby.id, st.last_feed.detail, new Date(st.last_feed.start_at), supabase, baby.birth_date)
      : null;
    const timer = latchTimerLine(ctx.from.id, now);
    const sl    = isSgtNight(now)
      ? nightStatusLine(st, now, baby.birth_date, fw)
      : statusLine(st, now, baby.birth_date, names, fw);
    const status = timer ? `${timer}\n${sl}` : sl;
    const text  = `${baby.name} · ${clock(now)}\n\n${status}${note ? `\n\n✓ ${note}` : ''}`;
    const lSide = activeLatch.get(String(ctx.from.id))?.side;
    const kb    = timer ? latchTimerKeyboard(lSide === 'left' ? 'L' : lSide === 'right' ? 'R' : lSide === 'both' ? 'B' : null) : keyboard();
    return { text, kb };
  }

  async function renderWithPrompt(ctx, baby, prompt, kb) {
    const [st, names] = await Promise.all([
      q.status(baby.id),
      caregiverNames(baby.id, ctx.from.id),
    ]);
    const now   = new Date();
    const timer = latchTimerLine(ctx.from.id, now);
    const sl    = isSgtNight(now) ? nightStatusLine(st, now, baby.birth_date) : statusLine(st, now, baby.birth_date, names);
    const status = timer ? `${timer}\n${sl}` : sl;
    const text  = `${baby.name} · ${clock(now)}\n\n${status}\n\n${prompt}`;
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch (e) {
      if (!/message is not modified/.test(e.description || e.message)) throw e;
    }
  }

  const insertAt = (baby, ctx, row, ts) => supabase.from('baby_events').insert({
    baby_id: baby.id, source: 'tap', logged_by: ctx.from.id,
    start_at: ts ? (ts instanceof Date ? ts.toISOString() : ts) : new Date().toISOString(),
    precision_min: 1, ...row,
  });

  const insert = (baby, ctx, row) => insertAt(baby, ctx, row, null);

  async function logFeed(ctx, baby, detail, overrideTs) {
    const feedTime    = overrideTs instanceof Date ? overrideTs : (overrideTs ? new Date(overrideTs) : new Date());
    const feedTimeIso = feedTime.toISOString();

    // Merge with a same-type feed within the last 30 minutes (e.g. 30ml + 30ml top-up)
    if (detail?.amount_ml && detail.amount_ml > 0) {
      const cutoff = new Date(feedTime.getTime() - 30 * 60 * 1000).toISOString();
      const { data: prev } = await supabase.from('baby_events')
        .select('id, detail, start_at')
        .eq('baby_id', baby.id)
        .eq('kind', 'feed')
        .eq('source', 'tap')
        .not('detail', 'is', null)
        .gte('start_at', cutoff)
        .lte('start_at', feedTimeIso)
        .order('start_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prev?.detail?.amount_ml && prev.detail.type === detail.type) {
        const parts   = prev.detail.parts ?? [{ amount_ml: prev.detail.amount_ml, t: prev.start_at }];
        parts.push({ amount_ml: detail.amount_ml, t: feedTimeIso });
        const totalMl = parts.reduce((s, p) => s + p.amount_ml, 0);
        const { error } = await supabase.from('baby_events')
          .update({ detail: { ...prev.detail, amount_ml: totalMl, parts } })
          .eq('id', prev.id);
        if (error) throw error;
        await closeSleep(baby.id, feedTime);
        setAutoFeedReminders(ctx.from.id, baby.name, feedTime);
        return { merged: true, totalMl, firstAt: prev.start_at };
      }
    }

    const { error } = await insertAt(baby, ctx, {
      kind: 'feed',
      detail: detail && Object.keys(detail).length ? detail : null,
    }, overrideTs ?? null);
    if (error) throw error;
    await closeSleep(baby.id, feedTime);
    setAutoFeedReminders(ctx.from.id, baby.name, feedTime);
    return { merged: false };
  }

  async function openSleep(babyId) {
    const { data } = await supabase.from('baby_events').select('*')
      .eq('baby_id', babyId).eq('kind', 'sleep').eq('source', 'tap').is('end_at', null).maybeSingle();
    return data;
  }

  async function lastFeedDetail(babyId) {
    const { data } = await supabase.from('baby_events')
      .select('detail').eq('baby_id', babyId).eq('kind', 'feed').eq('source', 'tap')
      .not('detail', 'is', null).order('start_at', { ascending: false }).limit(1).maybeSingle();
    return data?.detail ?? null;
  }

  async function closeSleep(babyId, ts = new Date()) {
    const open = await openSleep(babyId);
    if (!open) return;
    const endTs = ts instanceof Date ? ts : new Date(ts);
    if (new Date(open.start_at) >= endTs) return; // sleep started after the activity — don't touch it
    const { error } = await supabase.from('baby_events')
      .update({ end_at: endTs.toISOString() })
      .eq('id', open.id);
    if (error) console.error('closeSleep failed', error);
  }

  // ── Pinned message helpers (/log and /dashboard) ─────────────────────────────

  async function getStoredLogMsg(userId) {
    const { data } = await supabase.from('user_log_messages')
      .select('chat_id, message_id').eq('user_id', userId).maybeSingle();
    return data || null;
  }

  async function storeLogMsg(userId, chatId, messageId) {
    await supabase.from('user_log_messages').upsert(
      { user_id: userId, chat_id: chatId, message_id: messageId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  }

  async function getStoredDashMsg(userId) {
    const { data } = await supabase.from('user_log_messages')
      .select('dash_chat_id, dash_message_id').eq('user_id', userId).maybeSingle();
    return data?.dash_message_id ? { chat_id: data.dash_chat_id, message_id: data.dash_message_id } : null;
  }

  async function storeDashMsg(userId, chatId, messageId) {
    const { data: existing } = await supabase.from('user_log_messages')
      .select('chat_id, message_id').eq('user_id', userId).maybeSingle();
    await supabase.from('user_log_messages').upsert(
      {
        user_id:         userId,
        chat_id:         existing?.chat_id    ?? chatId,
        message_id:      existing?.message_id ?? messageId,
        dash_chat_id:    chatId,
        dash_message_id: messageId,
        updated_at:      new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  }

  // ── /log command ──────────────────────────────────────────────────────────────

  bot.command('log', async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD (or /joinbaby CODE).');
    const { text, kb } = await render(ctx, baby);
    const stored = await getStoredLogMsg(ctx.from.id);
    if (stored && stored.chat_id === ctx.chat.id) {
      ctx.telegram.deleteMessage(stored.chat_id, stored.message_id).catch(() => {});
    }
    const sent = await ctx.reply(text, kb);
    await storeLogMsg(ctx.from.id, ctx.chat.id, sent.message_id);
  });

  // ── /logs — day view + navigation ─────────────────────────────────────────────

  async function getUserTz(userId) {
    const { data } = await supabase.from('users').select('timezone').eq('id', userId).maybeSingle();
    return data?.timezone || 'Asia/Singapore';
  }

  async function sendLogsView(ctx, baby, dateStr) {
    const now        = new Date();
    const isToday    = dateStr === currentSgtDate(now);
    const { start, end } = dayBoundsUtc(dateStr);
    const [{ data: events }, tz, { data: caregiverRows }] = await Promise.all([
      supabase.from('baby_events_effective')
        .select('kind, start_at, end_at, detail, source, logged_by')
        .eq('baby_id', baby.id)
        .gte('start_at', start)
        .lt('start_at', end)
        .order('start_at', { ascending: true }),
      getUserTz(ctx.from.id),
      supabase.from('users').select('id, name')
        .or(`id.eq.${baby.id},linked_user_id.eq.${baby.id}`),
    ]);
    // Build userId → firstName map; only show names when multiple caregivers log
    const nameMap = {};
    for (const u of caregiverRows || []) {
      if (u.name) nameMap[String(u.id)] = u.name.split(' ')[0];
    }
    const showNames = Object.keys(nameMap).length > 1 ? nameMap : null;
    let fw = null;
    if (isToday && events?.length) {
      const lastFeed = [...events].reverse().find(e => e.kind === 'feed');
      if (lastFeed) fw = await fetchFeedWindow(baby.id, lastFeed.detail, new Date(lastFeed.start_at), supabase, baby.birth_date);
    }
    const text = formatTodayEvents(events, baby.name, dateStr, now, tz, fw, showNames);
    const kb   = logsNavKeyboard(dateStr);
    return { text, kb };
  }

  async function sendPeriodView(ctx, baby, days) {
    const today = currentRowDateStr();
    const from  = addDays(today, -(days - 1));
    const rows  = await q.days(baby.id, from, today);
    const text  = formatPeriodSummary(rows, baby.name, days);
    const kb    = periodNavKeyboard(days);
    return { text, kb };
  }

  bot.command(['logs', 'dashboard'], async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD (or /joinbaby CODE).');
    const { text, kb } = await sendLogsView(ctx, baby, currentSgtDate());
    const stored = await getStoredDashMsg(ctx.from.id);
    if (stored && stored.chat_id === ctx.chat.id) {
      ctx.telegram.deleteMessage(stored.chat_id, stored.message_id).catch(() => {});
    }
    const sent = await ctx.reply(text, { parse_mode: 'Markdown', ...kb });
    await storeDashMsg(ctx.from.id, ctx.chat.id, sent.message_id);
  });

  bot.action(/^logs:date:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');
    await ctx.answerCbQuery();
    const { text, kb } = await sendLogsView(ctx, baby, ctx.match[1]);
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch (e) {
      if (!/message is not modified/.test(e.description || e.message)) throw e;
    }
  });

  bot.action(/^logs:period:(\d+)$/, async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');
    await ctx.answerCbQuery();
    const { text, kb } = await sendPeriodView(ctx, baby, +ctx.match[1]);
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch (e) {
      if (!/message is not modified/.test(e.description || e.message)) throw e;
    }
  });

  // ── Delete event ──────────────────────────────────────────────────────────────

  bot.action(/^logs:delmode:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');
    await ctx.answerCbQuery();

    const rowDate = ctx.match[1];
    const { start: dayStart, end: dayEnd } = dayBoundsUtc(rowDate);
    const { data: events } = await supabase.from('baby_events')
      .select('id, kind, start_at, end_at, detail')
      .eq('baby_id', baby.id).eq('source', 'tap')
      .neq('kind', 'pd_question')
      .gte('start_at', dayStart).lt('start_at', dayEnd)
      .order('start_at', { ascending: true });

    const today  = currentSgtDate();
    const header = rowDate === today ? `*${baby.name} today*` : `*${baby.name} — ${dayLabel(rowDate)}*`;

    if (!events?.length) {
      const kb = Markup.inlineKeyboard([[Markup.button.callback('← Back', `logs:date:${rowDate}`)]]);
      try {
        await ctx.editMessageText(`${header}\n\nNo tap-logged events to delete.\n_Events from paper scans cannot be deleted here._`,
          { parse_mode: 'Markdown', ...kb });
      } catch (e) { if (!/message is not modified/.test(e.description || e.message)) throw e; }
      return;
    }

    const rows = events.map(e =>
      [Markup.button.callback(eventDeleteLabel(e), `logs:del:${e.id}:${rowDate}`)]
    );
    rows.push([Markup.button.callback('← Back', `logs:date:${rowDate}`)]);

    try {
      await ctx.editMessageText(`${header}\n\n_Tap an event to delete it:_`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
    } catch (e) { if (!/message is not modified/.test(e.description || e.message)) throw e; }
  });

  bot.action(/^logs:del:(\d+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');

    const eventId = ctx.match[1];
    const rowDate = ctx.match[2];

    const { error } = await supabase.from('baby_events')
      .delete()
      .eq('id', eventId)
      .eq('baby_id', baby.id) // ensures ownership
      .eq('source', 'tap');

    if (error) {
      console.error('delete event failed', error);
      return ctx.answerCbQuery("Couldn't delete that event. Try again.");
    }

    await ctx.answerCbQuery('Deleted');
    const { text, kb } = await sendLogsView(ctx, baby, rowDate);
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb });
    } catch (e) { if (!/message is not modified/.test(e.description || e.message)) throw e; }
  });

  // ── Reconciliation callbacks (evening review approve/skip) ───────────────────

  bot.action(/^rec:feed:(\d+):(\d+)$/, async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first');
    const id1 = ctx.match[1], id2 = ctx.match[2];
    const [{ data: a }, { data: b }] = await Promise.all([
      supabase.from('baby_events').select('id, detail, start_at').eq('id', id1).eq('baby_id', baby.id).maybeSingle(),
      supabase.from('baby_events').select('id, detail, start_at').eq('id', id2).eq('baby_id', baby.id).maybeSingle(),
    ]);
    if (!a || !b) return ctx.answerCbQuery('Events not found');
    const parts   = [{ amount_ml: a.detail.amount_ml, t: a.start_at }, { amount_ml: b.detail.amount_ml, t: b.start_at }];
    const totalMl = a.detail.amount_ml + b.detail.amount_ml;
    await supabase.from('baby_events').update({ detail: { ...a.detail, amount_ml: totalMl, parts } }).eq('id', id1);
    await supabase.from('baby_events').delete().eq('id', id2);
    const icon = a.detail.type === 'formula' ? '🍶' : '🍼';
    const t    = new Date(a.start_at).toLocaleString('en-SG', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore' }).toLowerCase().replace(/ /g, '');
    await ctx.answerCbQuery('Merged ✓');
    await ctx.editMessageText(`${icon} Merged: ${totalMl}ml at ${t} ✅`, { parse_mode: 'Markdown' });
  });

  bot.action(/^rec:sleep:(\d+):(\d+)$/, async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first');
    const startMs = Number(ctx.match[1]) * 1000;
    const endMs   = Number(ctx.match[2]) * 1000;
    const { error } = await supabase.from('baby_events').insert({
      baby_id: baby.id, source: 'tap', logged_by: ctx.from.id,
      kind: 'sleep', start_at: new Date(startMs).toISOString(),
      end_at: new Date(endMs).toISOString(), precision_min: 5,
    });
    if (error) return ctx.answerCbQuery('Could not save — try again');
    const gapMin = Math.round((endMs - startMs) / 60000);
    const h = Math.floor(gapMin / 60), m = gapMin % 60;
    const durStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
    const fmt = (ms) => new Date(ms).toLocaleString('en-SG', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore' }).toLowerCase().replace(/ /g, '');
    await ctx.answerCbQuery('Sleep logged ✓');
    await ctx.editMessageText(`😴 Sleep logged: ${fmt(startMs)} – ${fmt(endMs)} (${durStr}) ✅`, { parse_mode: 'Markdown' });
  });

  bot.action('rec:skip', async (ctx) => {
    await ctx.answerCbQuery('Skipped');
    await ctx.editMessageText('_Skipped_', { parse_mode: 'Markdown' });
  });

  // ── Text handler for retro time input ─────────────────────────────────────────
  // Must be registered BEFORE the general message handler.

  bot.on('text', async (ctx, next) => {
    const text = ctx.message?.text?.trim() || '';
    if (text.startsWith('/')) return next(); // don't intercept commands

    // ── Persistent quick-access buttons ──────────────────────────────────────

    // Backwards-compat: old keyboard showed [📋 Log | 📊 Dashboard].
    // Handle them and push the new keyboard so Telegram upgrades it.
    const newQuickKb = Markup.keyboard([
      ['🍼 Feed',  '😴 Sleep', '📝 Note'],
      ['💧 Wet',   '💩 Dirty', '💧💩 Both'],
      ['📊 Logs'],
    ]).resize().persistent();

    if (text === '📋 Log' || text === '📊 Dashboard') {
      const baby = await q.babyFor(ctx.from.id);
      const label = baby ? baby.name : 'your baby';
      await ctx.reply(
        `Keyboard updated ✓\n\nUse the new buttons below to log for ${label} 👇`,
        newQuickKb,
      );
      return;
    }

    if (text === '🍼 Feed') {
      const baby = await q.babyFor(ctx.from.id);
      if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD.');
      const stored = await getStoredLogMsg(ctx.from.id);
      if (stored && stored.chat_id === ctx.chat.id) {
        ctx.telegram.deleteMessage(stored.chat_id, stored.message_id).catch(() => {});
      }
      const last = await lastFeedDetail(baby.id);
      if (last) pendingFeedRepeat.set(ctx.from.id, { detail: last, retroTs: null });
      const [st, names] = await Promise.all([q.status(baby.id), caregiverNames(baby.id, ctx.from.id)]);
      const now2 = new Date();
      const sl   = isSgtNight(now2) ? nightStatusLine(st, now2, baby.birth_date) : statusLine(st, now2, baby.birth_date, names);
      const sent = await ctx.reply(
        `${baby.name} · ${clock(now2)}\n\n${sl}\n\n_What type of feed?_`,
        { parse_mode: 'Markdown', ...feedTypeKeyboard(last) },
      );
      await storeLogMsg(ctx.from.id, ctx.chat.id, sent.message_id);
      return;
    }

    if (text === '😴 Sleep') {
      const baby = await q.babyFor(ctx.from.id);
      if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD.');
      const stored = await getStoredLogMsg(ctx.from.id);
      if (stored && stored.chat_id === ctx.chat.id) {
        ctx.telegram.deleteMessage(stored.chat_id, stored.message_id).catch(() => {});
      }
      const open = await openSleep(baby.id);
      let note;
      if (open) {
        note = `Already asleep since ${clock(open.start_at)}`;
      } else {
        const { error } = await insert(baby, ctx, { kind: 'sleep', end_at: null });
        if (error && error.code !== '23505') { await ctx.reply("Sorry, couldn't save."); return; }
        note = `Asleep from ${clock(new Date())}`;
      }
      const { text: t, kb } = await render(ctx, baby, note);
      const sent = await ctx.reply(t, kb);
      await storeLogMsg(ctx.from.id, ctx.chat.id, sent.message_id);
      return;
    }

    if (text === '💧 Wet' || text === '💩 Dirty' || text === '💧💩 Both') {
      const baby = await q.babyFor(ctx.from.id);
      if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD.');
      const stored = await getStoredLogMsg(ctx.from.id);
      if (stored && stored.chat_id === ctx.chat.id) {
        ctx.telegram.deleteMessage(stored.chat_id, stored.message_id).catch(() => {});
      }
      const detail = text === '💧 Wet'   ? { wet: true }
                   : text === '💩 Dirty'  ? { dirty: true }
                   : { wet: true, dirty: true };
      const { error } = await insert(baby, ctx, { kind: 'diaper', detail });
      if (error) { await ctx.reply("Sorry, couldn't save."); return; }
      await closeSleep(baby.id, new Date());
      const icon = text === '💧💩 Both' ? '💧💩' : text.split(' ')[0];
      const { text: t, kb } = await render(ctx, baby, `${icon} Diaper logged`);
      const sent = await ctx.reply(t, kb);
      await storeLogMsg(ctx.from.id, ctx.chat.id, sent.message_id);
      return;
    }

    if (text === '📝 Note') {
      const baby = await q.babyFor(ctx.from.id);
      if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD.');
      const stored = await getStoredLogMsg(ctx.from.id);
      if (stored && stored.chat_id === ctx.chat.id) {
        ctx.telegram.deleteMessage(stored.chat_id, stored.message_id).catch(() => {});
      }
      const [st, names] = await Promise.all([q.status(baby.id), caregiverNames(baby.id, ctx.from.id)]);
      const now2 = new Date();
      const sl   = isSgtNight(now2) ? nightStatusLine(st, now2, baby.birth_date) : statusLine(st, now2, baby.birth_date, names);
      const sent = await ctx.reply(
        `${baby.name} · ${clock(now2)}\n\n${sl}\n\n_Type your note and send it:_`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'tap:back')]]) },
      );
      await storeLogMsg(ctx.from.id, ctx.chat.id, sent.message_id);
      pendingNote.set(ctx.from.id, {
        chatId: ctx.chat.id, messageId: sent.message_id,
        retroTs: null, expiresAt: Date.now() + NOTE_TTL_MS,
      });
      return;
    }

    if (text === '📊 Logs') {
      const baby = await q.babyFor(ctx.from.id);
      if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD.');
      const { text: dashText, kb } = await sendLogsView(ctx, baby, currentSgtDate());
      const stored = await getStoredDashMsg(ctx.from.id);
      if (stored && stored.chat_id === ctx.chat.id) {
        ctx.telegram.deleteMessage(stored.chat_id, stored.message_id).catch(() => {});
      }
      const sent = await ctx.reply(dashText, { parse_mode: 'Markdown', ...kb });
      await storeDashMsg(ctx.from.id, ctx.chat.id, sent.message_id);
      return;
    }

    // ── Note text input ───────────────────────────────────────────────────────
    const noteState = getPendingNote(ctx.from.id);
    if (noteState) {
      pendingNote.delete(ctx.from.id);
      const baby = await q.babyFor(ctx.from.id);
      if (!baby) return next();
      const editLog = (msgText, kb) =>
        ctx.telegram.editMessageText(noteState.chatId, noteState.messageId, undefined, msgText,
          { parse_mode: 'Markdown', ...kb }).catch(() => {});
      try {
        if (noteState.isPdQuestion) {
          await insertAt(baby, ctx, { kind: 'pd_question', detail: { question: text } }, null);
          const { text: pdText, kb: pdKb } = await renderPdView(baby);
          await editLog(pdText, pdKb);
        } else {
          await insertAt(baby, ctx, { kind: 'note', detail: { text } }, noteState.retroTs);
          const ts  = noteState.retroTs ?? new Date();
          const st  = await q.status(baby.id);
          const msg = `${baby.name} right now\n\n${statusLine(st, new Date(), baby.birth_date)}\n\n✓ 📝 "${text}" at ${clock(ts)}`;
          await editLog(msg, keyboard());
        }
      } catch (e) {
        console.error('note log failed', e);
        await ctx.reply("Sorry, that didn't save. Try again.");
      }
      return;
    }

    // ── Custom value input (amount / duration) ────────────────────────────────
    const inp = getPendingInput(ctx.from.id);
    if (inp) {
      const num = parseInt(text, 10);
      if (isNaN(num) || num <= 0 || num > 9999) {
        await ctx.reply('_Enter a number (e.g. 45 for ml, or 25 for minutes)_', { parse_mode: 'Markdown' });
        return;
      }
      pendingInput.delete(ctx.from.id);
      const baby = await q.babyFor(ctx.from.id);
      if (!baby) return next();
      const editLog = (msgText, kb) =>
        ctx.telegram.editMessageText(inp.chatId, inp.messageId, undefined, msgText,
          { parse_mode: 'Markdown', ...kb }).catch(() => {});
      try {
        const retroTs = consumeRetroTime(ctx.from.id);
        let detail, note;
        if (inp.type === 'formula_amount') {
          detail = { type: 'formula', amount_ml: num };
          note   = `🍶 ${num}ml at ${clock(retroTs ?? new Date())}`;
        } else if (inp.type === 'breast_amount') {
          detail = { type: 'breast', amount_ml: num };
          note   = `🍼 ${num}ml (breast) at ${clock(retroTs ?? new Date())}`;
        } else {
          // latch_duration
          const sideWord  = inp.side === 'L' ? 'left' : inp.side === 'R' ? 'right' : 'both';
          const sideLabel = inp.side === 'B' ? 'Both' : inp.side === 'L' ? 'Left' : 'Right';
          detail = { type: 'latch', side: sideWord, duration_min: num };
          note   = `🤱 ${sideLabel} · ${num}m at ${clock(retroTs ?? new Date())}`;
        }
        const feedResult = await logFeed(ctx, baby, detail, retroTs);
        if (feedResult.merged) {
          if (inp.type === 'formula_amount') note = `🍶 ${feedResult.totalMl}ml total (2 parts)`;
          else if (inp.type === 'breast_amount') note = `🍼 ${feedResult.totalMl}ml breast total (2 parts)`;
        }
        const st  = await q.status(baby.id);
        const msg = `${baby.name} right now\n\n${statusLine(st, new Date(), baby.birth_date)}\n\n✓ ${note}`;
        await editLog(msg, keyboard());
      } catch (e) {
        console.error('custom value log failed', e);
        await ctx.reply("Sorry, that didn't save. Try again.");
      }
      return;
    }

    // ── Retro time input ──────────────────────────────────────────────────────
    const pending = getRetro(ctx.from.id);
    if (!pending) return next();

    const ts = parseTimeStr(text);
    if (!ts) {
      // Not a valid time — give a hint and eat the message
      await ctx.reply('_Enter a time like 2:30pm or 14:30_', { parse_mode: 'Markdown' });
      return;
    }

    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return next();

    // Helper to edit the stored /log message
    const editLog = (msgText, kb) =>
      ctx.telegram.editMessageText(pending.chatId, pending.messageId, undefined, msgText,
        { parse_mode: 'Markdown', ...kb }).catch(() => {});

    if (pending.kind === 'feed') {
      // Store the time, then show feed type keyboard via the stored log message
      pendingRetro.set(ctx.from.id, { ...pending, ts, expiresAt: Date.now() + RETRO_TTL_MS });
      const last = await lastFeedDetail(baby.id);
      if (last) pendingFeedRepeat.set(ctx.from.id, { detail: last, retroTs: ts });
      const st  = await q.status(baby.id);
      const now2 = new Date();
      const sl2  = isSgtNight(now2) ? nightStatusLine(st, now2, baby.birth_date) : statusLine(st, now2, baby.birth_date);
      const msg = `${baby.name} right now\n\n${sl2}\n\n_What type of feed? (${clock(ts)})_`;
      await editLog(msg, feedTypeKeyboard(last));
      return; // don't call next()
    }

    if (pending.kind === 'note') {
      // Time captured — now ask for the note text
      pendingRetro.delete(ctx.from.id);
      pendingNote.set(ctx.from.id, {
        chatId: pending.chatId, messageId: pending.messageId,
        retroTs: ts, expiresAt: Date.now() + NOTE_TTL_MS,
      });
      const st  = await q.status(baby.id);
      const msg = `${baby.name} right now\n\n${statusLine(st, new Date(), baby.birth_date)}\n\n_Type your note for ${clock(ts)}:_`;
      await editLog(msg, Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'tap:back')]]));
      return;
    }

    // Non-feed: log directly with the retro time
    pendingRetro.delete(ctx.from.id);
    try {
      let note;
      if (pending.kind === 'sleep') {
        const open = await openSleep(baby.id);
        if (open) {
          note = `Already asleep since ${clock(open.start_at)}`;
        } else {
          const { error } = await insertAt(baby, ctx, { kind: 'sleep', end_at: null }, ts);
          if (error && error.code !== '23505') throw error;
          // Look for events already logged after ts that should have closed this sleep
          const tsIso = ts instanceof Date ? ts.toISOString() : ts;
          const { data: nextCloser } = await supabase.from('baby_events')
            .select('start_at').eq('baby_id', baby.id)
            .in('kind', ['feed', 'diaper']).gt('start_at', tsIso)
            .order('start_at', { ascending: true }).limit(1).maybeSingle();
          if (nextCloser) {
            await closeSleep(baby.id, new Date(nextCloser.start_at));
            note = `😴 Asleep ${clock(ts)} → ☀️ ${clock(nextCloser.start_at)}`;
          } else {
            note = `😴 Asleep at ${clock(ts)}`;
          }
        }
      } else {
        const detailMap = {
          wet:   { wet: true },
          dirty: { dirty: true },
          both:  { wet: true, dirty: true },
        };
        await insertAt(baby, ctx, { kind: 'diaper', detail: detailMap[pending.kind] }, ts);
        await closeSleep(baby.id, ts);
        const icons = { wet: '💧', dirty: '💩', both: '💧💩' };
        note = `${icons[pending.kind]} at ${clock(ts)}`;
      }
      const st  = await q.status(baby.id);
      const msg = `${baby.name} right now\n\n${statusLine(st, new Date(), baby.birth_date)}\n\n✓ ${note}`;
      await editLog(msg, keyboard());
    } catch (e) {
      console.error('retro log failed', e);
      await ctx.reply("Sorry, that didn't save. Try again.");
    }
  });

  // ── Simple tap actions ────────────────────────────────────────────────────────

  // All event-kind actions go through the "when?" gate first
  function stageWhen(ctx, baby, kind) {
    pendingRetro.delete(ctx.from.id);
    pendingNote.delete(ctx.from.id);
    pendingAction.delete(ctx.from.id);
    const chatId = ctx.callbackQuery.message.chat.id;
    const messageId = ctx.callbackQuery.message.message_id;
    pendingAction.set(ctx.from.id, { kind, chatId, messageId, expiresAt: Date.now() + RETRO_TTL_MS });
    return renderWithPrompt(ctx, baby, '_When did this happen?_', whenKeyboard());
  }

  const actions = {
    async feed(ctx, baby)  { await ctx.answerCbQuery(); activeLatch.delete(String(ctx.from.id)); await stageWhen(ctx, baby, 'feed');  return null; },
    async sleep(ctx, baby) { await ctx.answerCbQuery(); await stageWhen(ctx, baby, 'sleep'); return null; },
    async remind(ctx, baby) {
      await ctx.answerCbQuery();
      const existing = getFeedReminder(ctx.from.id);
      const prompt   = existing
        ? `_Reminder set for ${clock(existing.remindAt)} — change or cancel:_`
        : '_Remind me for next feed in:_';
      await renderWithPrompt(ctx, baby, prompt, remindKeyboard());
      return null;
    },
    async wet(ctx, baby)   { await ctx.answerCbQuery(); await stageWhen(ctx, baby, 'wet');   return null; },
    async dirty(ctx, baby) { await ctx.answerCbQuery(); await stageWhen(ctx, baby, 'dirty'); return null; },
    async both(ctx, baby)  { await ctx.answerCbQuery(); await stageWhen(ctx, baby, 'both');  return null; },
    async note(ctx, baby)  { await ctx.answerCbQuery(); await stageWhen(ctx, baby, 'note');  return null; },
    async pd(ctx, baby) {
      await ctx.answerCbQuery();
      const { text, kb } = await renderPdView(baby);
      try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb }); }
      catch (e) { if (!/message is not modified/.test(e.description || e.message)) throw e; }
      return null;
    },
    async undo(ctx, baby) {
      pendingRetro.delete(ctx.from.id);
      pendingAction.delete(ctx.from.id);
      const since = new Date(Date.now() - UNDO_MINUTES * 60e3).toISOString();
      const [{ data: made }, { data: woke }] = await Promise.all([
        supabase.from('baby_events').select('*').eq('baby_id', baby.id).eq('source', 'tap')
          .eq('logged_by', ctx.from.id).neq('kind', 'pd_question').gte('created_at', since)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('baby_events').select('*').eq('baby_id', baby.id).eq('source', 'tap')
          .eq('kind', 'sleep').eq('detail->>ended_by', String(ctx.from.id)).gte('end_at', since)
          .order('end_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const wakeIsLater = woke && (!made || new Date(woke.end_at) >= new Date(made.created_at));
      if (wakeIsLater) {
        const { ended_by, ...rest } = woke.detail || {};
        await supabase.from('baby_events').update({ end_at: null, detail: rest }).eq('id', woke.id);
        return 'Undone: back to asleep';
      }
      if (!made) return `Nothing of yours to undo from the last ${UNDO_MINUTES} minutes.`;
      await supabase.from('baby_events').delete().eq('id', made.id);
      return `Undone: ${made.kind} at ${clock(made.start_at)}`;
    },
    async history(ctx, baby) {
      const today         = currentSgtDate();
      const { start, end } = dayBoundsUtc(today);
      const [{ data: events }, tz] = await Promise.all([
        supabase.from('baby_events_effective')
          .select('kind, start_at, end_at, detail, source')
          .eq('baby_id', baby.id)
          .gte('start_at', start)
          .lt('start_at', end)
          .order('start_at', { ascending: true }),
        getUserTz(ctx.from.id),
      ]);
      await ctx.answerCbQuery();
      const text = formatTodayEvents(events, baby.name, today, new Date(), tz);
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('← Back', 'tap:back')]]),
        });
      } catch (e) {
        if (!/message is not modified/.test(e.description || e.message)) throw e;
      }
      return null;
    },
    async back(ctx, baby) {
      pendingInput.delete(ctx.from.id);
      pendingNote.delete(ctx.from.id);
      pendingAction.delete(ctx.from.id);
      activeLatch.delete(String(ctx.from.id));
      await ctx.answerCbQuery();
      const { text, kb } = await render(ctx, baby);
      try { await ctx.editMessageText(text, kb); } catch (e) {
        if (!/message is not modified/.test(e.description || e.message)) throw e;
      }
      return null;
    },
    refresh: async () => undefined,
  };

  async function diaper(ctx, baby, detail) {
    const { error } = await insert(baby, ctx, { kind: 'diaper', detail });
    if (error) throw error;
    await closeSleep(baby.id, new Date());
    return `Diaper logged (${Object.keys(detail).join(' + ')})`;
  }

  // ── Simple action handler ─────────────────────────────────────────────────────

  bot.action(/^tap:(\w+)$/, async (ctx) => {
    const fn   = actions[ctx.match[1]];
    const baby = await q.babyFor(ctx.from.id);
    if (!fn || !baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');
    let note;
    try {
      note = await fn(ctx, baby);
    } catch (e) {
      console.error('tap log failed', e);
      return ctx.answerCbQuery("Sorry, that didn't save. Try again?");
    }
    if (note === null) return; // action managed its own message
    await ctx.answerCbQuery(note || 'Updated');
    const { text, kb } = await render(ctx, baby, note);
    try {
      await ctx.editMessageText(text, kb);
    } catch (e) {
      if (!/message is not modified/.test(e.description || e.message)) throw e;
    }
  });

  // ── PD questions view ─────────────────────────────────────────────────────────

  async function renderPdView(baby) {
    const { data: questions } = await supabase.from('baby_events')
      .select('id, detail, start_at')
      .eq('baby_id', baby.id)
      .eq('kind', 'pd_question')
      .eq('source', 'tap')
      .order('start_at', { ascending: true });

    let text;
    if (!questions?.length) {
      text = `*${baby.name} — Questions for PD*\n\nNo questions yet.\nTap the button below to add one.`;
    } else {
      const lines = questions.map((q, i) => `${i + 1}. ${q.detail?.question || '(question)'}`);
      text = `*${baby.name} — Questions for PD*\n\n${lines.join('\n')}\n\n_Tap ✓ to mark a question as asked._`;
    }

    const qButtons = (questions || []).map((q, i) => [
      Markup.button.callback(`✓ #${i + 1}`, `pd:done:${q.id}`),
    ]);
    const kb = Markup.inlineKeyboard([
      ...qButtons,
      [Markup.button.callback('📝 Add question', 'pd:add')],
      [Markup.button.callback('← Back', 'tap:back')],
    ]);
    return { text, kb };
  }

  bot.command('pd', async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD (or /joinbaby CODE).');
    const { text, kb } = await renderPdView(baby);
    return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  });

  bot.action('pd:add', async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');
    await ctx.answerCbQuery();
    const chatId = ctx.callbackQuery.message.chat.id;
    const messageId = ctx.callbackQuery.message.message_id;
    pendingNote.set(ctx.from.id, {
      chatId, messageId, retroTs: null, isPdQuestion: true,
      expiresAt: Date.now() + NOTE_TTL_MS,
    });
    const st = await q.status(baby.id);
    const text = `${baby.name} right now\n\n${statusLine(st, new Date(), baby.birth_date)}\n\n_Type your question for the PD appointment:_`;
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'tap:back')]]),
      });
    } catch (e) { if (!/message is not modified/.test(e.description || e.message)) throw e; }
  });

  bot.action(/^pd:done:(\d+)$/, async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');
    await supabase.from('baby_events')
      .delete().eq('id', ctx.match[1]).eq('baby_id', baby.id).eq('kind', 'pd_question');
    await ctx.answerCbQuery('Marked as asked ✓');
    const { text, kb } = await renderPdView(baby);
    try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...kb }); }
    catch (e) { if (!/message is not modified/.test(e.description || e.message)) throw e; }
  });

  // ── When? gate handlers ───────────────────────────────────────────────────────

  const TIME_PROMPTS = {
    feed:  '_What time was the feed?_\nReply with e.g. `2:30pm` or `14:30`',
    sleep: '_What time did baby fall asleep?_\nReply with e.g. `9:30pm` or `21:30`',
    wake:  '_What time did baby wake up?_\nReply with e.g. `9:30am` or `9:30`',
    wet:   '_What time was the wet nappy?_\nReply with e.g. `3pm` or `15:00`',
    dirty: '_What time was the dirty nappy?_\nReply with e.g. `3pm` or `15:00`',
    both:  '_What time was the nappy change?_\nReply with e.g. `3pm` or `15:00`',
    note:  '_What time did this happen?_\nReply with e.g. `2:30pm` or `14:30`',
  };

  bot.action('tap:when:now', async (ctx) => {
    await ctx.answerCbQuery();
    const pa = getPendingAction(ctx.from.id);
    pendingAction.delete(ctx.from.id);
    if (!pa) return;
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return;

    const { kind } = pa;
    let note;
    try {
      if (kind === 'feed') {
        const last = await lastFeedDetail(baby.id);
        if (last) pendingFeedRepeat.set(ctx.from.id, { detail: last, retroTs: null });
        await renderWithPrompt(ctx, baby, '_What type of feed?_', feedTypeKeyboard(last));
        return;
      }
      if (kind === 'note') {
        pendingNote.set(ctx.from.id, {
          chatId: ctx.callbackQuery.message.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
          retroTs: null, expiresAt: Date.now() + NOTE_TTL_MS,
        });
        await renderWithPrompt(ctx, baby, '_Type your note and send it:_',
          Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'tap:back')]]));
        return;
      }
      if (kind === 'sleep') {
        const open = await openSleep(baby.id);
        if (open) { note = `Already asleep since ${clock(open.start_at)}`; }
        else {
          const { error } = await insert(baby, ctx, { kind: 'sleep', end_at: null });
          if (error && error.code !== '23505') throw error;
          note = `Asleep from ${clock(new Date())}`;
        }
      } else if (kind === 'wet')   { note = await diaper(ctx, baby, { wet: true }); }
      else if (kind === 'dirty')   { note = await diaper(ctx, baby, { dirty: true }); }
      else if (kind === 'both')    { note = await diaper(ctx, baby, { wet: true, dirty: true }); }
    } catch (e) {
      console.error('tap:when:now failed', e);
      return;
    }

    if (note !== undefined) {
      const { text, kb } = await render(ctx, baby, note);
      try { await ctx.editMessageText(text, kb); }
      catch (e) { if (!/message is not modified/.test(e.description || e.message)) throw e; }
    }
  });

  bot.action('tap:when:custom', async (ctx) => {
    await ctx.answerCbQuery();
    const pa = getPendingAction(ctx.from.id);
    pendingAction.delete(ctx.from.id);
    if (!pa) return;
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return;

    pendingRetro.set(ctx.from.id, {
      kind: pa.kind, chatId: pa.chatId, messageId: pa.messageId,
      expiresAt: Date.now() + RETRO_TTL_MS,
    });

    await renderWithPrompt(ctx, baby,
      TIME_PROMPTS[pa.kind] || '_What time?\nReply with e.g. `2:30pm`_',
      Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'tap:back')]]));
  });

  // ── Feed detail sub-steps ─────────────────────────────────────────────────────
  // Callback data format:
  //   tap:feed:skip                  → log plain feed now
  //   tap:feed:breast                → show side keyboard
  //   tap:feed:breast:skip           → log breast (no side/duration)
  //   tap:feed:breast:L|R|B          → show duration keyboard
  //   tap:feed:breast:L|R|B:N|skip   → log breast with side + optional duration
  //   tap:feed:formula               → show amount keyboard
  //   tap:feed:formula:N|skip        → log formula with optional amount

  bot.action(/^tap:feed:(.+)$/, async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');

    const parts    = ctx.match[1].split(':');
    const retroTs  = parts[parts.length - 1] === 'final' ? null : null; // consumed below at log step

    try {
      // ── repeat → re-log the previous feed detail unchanged ───────────────────
      if (parts[0] === 'repeat') {
        const stored = pendingFeedRepeat.get(ctx.from.id);
        pendingFeedRepeat.delete(ctx.from.id);
        const detail = stored?.detail ?? {};
        const ts     = stored?.retroTs ?? consumeRetroTime(ctx.from.id);
        const result = await logFeed(ctx, baby, detail, ts);
        const label  = feedRepeatLabel(detail) ?? 'Feed';
        const note   = result.merged
          ? `${label} · ${result.totalMl}ml total (2 parts)`
          : `${label} at ${clock(ts ?? new Date())}`;
        await ctx.answerCbQuery(note);
        const { text, kb } = await render(ctx, baby, note);
        return ctx.editMessageText(text, kb);
      }

      // ── skip → plain feed ────────────────────────────────────────────────────
      if (parts[0] === 'skip') {
        const ts   = consumeRetroTime(ctx.from.id);
        await logFeed(ctx, baby, {}, ts);
        const note = `Feed logged at ${clock(ts ?? new Date())}`;
        await ctx.answerCbQuery(note);
        const { text, kb } = await render(ctx, baby, note);
        return ctx.editMessageText(text, kb);
      }

      // ── latch (from breast; measured in minutes) ─────────────────────────────
      if (parts[0] === 'latch') {
        if (!parts[1]) {
          await ctx.answerCbQuery();
          return renderWithPrompt(ctx, baby, '_Latch — which side?_', latchSideKeyboard());
        }

        const side = parts[1]; // 'L' | 'R' | 'B' | 'timer' | 'skip'

        if (side === 'timer') {
          // Start latch timer without a side selected yet
          await ctx.answerCbQuery('Timer started');
          activeLatch.set(String(ctx.from.id), { startedAt: new Date(), side: null, retroTs: consumeRetroTime(ctx.from.id) });
          const { text, kb } = await render(ctx, baby);
          try { await ctx.editMessageText(text, kb); } catch (e) { if (!/not modified/.test(e.description || e.message)) throw e; }
          return;
        }

        if (side === 'skip') {
          const ts   = consumeRetroTime(ctx.from.id);
          await logFeed(ctx, baby, { type: 'latch' }, ts);
          const note = `🤱 Latch at ${clock(ts ?? new Date())}`;
          await ctx.answerCbQuery(note);
          const { text, kb } = await render(ctx, baby, note);
          return ctx.editMessageText(text, kb);
        }

        if (!parts[2]) {
          await ctx.answerCbQuery();
          const sLabel = side === 'L' ? 'Left' : side === 'R' ? 'Right' : 'Both';
          return renderWithPrompt(ctx, baby, `_${sLabel} latch — how long?_`, latchDurationKeyboard(side));
        }

        if (parts[2] === 'custom') {
          await ctx.answerCbQuery();
          pendingInput.set(ctx.from.id, {
            type: 'latch_duration', side,
            chatId: ctx.callbackQuery.message.chat.id,
            messageId: ctx.callbackQuery.message.message_id,
            expiresAt: Date.now() + RETRO_TTL_MS,
          });
          const sLabel = side === 'L' ? 'Left' : side === 'R' ? 'Right' : 'Both';
          return renderWithPrompt(ctx, baby, `_${sLabel} latch — how many minutes?_\nType a number e.g. \`25\``,
            Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'tap:back')]]));
        }

        const dur       = parts[2]; // number or 'skip'
        const sideWord  = side === 'L' ? 'left' : side === 'R' ? 'right' : 'both';
        const detail    = { type: 'latch', side: sideWord, ...(dur !== 'skip' ? { duration_min: +dur } : {}) };
        const ts        = consumeRetroTime(ctx.from.id);
        await logFeed(ctx, baby, detail, ts);
        const sideShort = side === 'B' ? 'Both' : side === 'L' ? 'Left' : 'Right';
        const note      = `🤱 ${sideShort}${dur !== 'skip' ? ` · ${dur}m` : ''} at ${clock(ts ?? new Date())}`;
        await ctx.answerCbQuery(note);
        const { text, kb } = await render(ctx, baby, note);
        return ctx.editMessageText(text, kb);
      }

      // ── breast (expressed/reheated; measured in ml) ───────────────────────────
      if (parts[0] === 'breast') {
        if (!parts[1]) {
          await ctx.answerCbQuery();
          return renderWithPrompt(ctx, baby, '_Breast milk — how much?_', breastAmountKeyboard());
        }

        if (parts[1] === 'custom') {
          await ctx.answerCbQuery();
          pendingInput.set(ctx.from.id, {
            type: 'breast_amount',
            chatId: ctx.callbackQuery.message.chat.id,
            messageId: ctx.callbackQuery.message.message_id,
            expiresAt: Date.now() + RETRO_TTL_MS,
          });
          return renderWithPrompt(ctx, baby, '_Breast milk — how much? Type amount in ml e.g. `45`_',
            Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'tap:back')]]));
        }

        const amount = parts[1]; // number or 'skip'
        const detail = { type: 'breast', ...(amount !== 'skip' ? { amount_ml: +amount } : {}) };
        const ts     = consumeRetroTime(ctx.from.id);
        const result = await logFeed(ctx, baby, detail, ts);
        const note   = amount !== 'skip'
          ? (result.merged ? `🍼 ${result.totalMl}ml breast total (2 parts)` : `🍼 ${amount}ml (breast) at ${clock(ts ?? new Date())}`)
          : `🍼 Breast milk at ${clock(ts ?? new Date())}`;
        await ctx.answerCbQuery(note);
        const { text, kb } = await render(ctx, baby, note);
        return ctx.editMessageText(text, kb);
      }

      // ── formula ──────────────────────────────────────────────────────────────
      if (parts[0] === 'formula') {
        if (!parts[1]) {
          await ctx.answerCbQuery();
          return renderWithPrompt(ctx, baby, '_Formula — how much?_', formulaAmountKeyboard());
        }

        if (parts[1] === 'custom') {
          await ctx.answerCbQuery();
          pendingInput.set(ctx.from.id, {
            type: 'formula_amount',
            chatId: ctx.callbackQuery.message.chat.id,
            messageId: ctx.callbackQuery.message.message_id,
            expiresAt: Date.now() + RETRO_TTL_MS,
          });
          return renderWithPrompt(ctx, baby, '_Formula — how much? Type amount in ml e.g. \`45\`_',
            Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'tap:back')]]));
        }

        const amount = parts[1]; // number or 'skip'
        const detail = { type: 'formula', ...(amount !== 'skip' ? { amount_ml: +amount } : {}) };
        const ts     = consumeRetroTime(ctx.from.id);
        const result = await logFeed(ctx, baby, detail, ts);
        const note   = amount !== 'skip'
          ? (result.merged ? `🍶 ${result.totalMl}ml total (2 parts)` : `🍶 ${amount}ml at ${clock(ts ?? new Date())}`)
          : `🍶 Formula feed at ${clock(ts ?? new Date())}`;
        await ctx.answerCbQuery(note);
        const { text, kb } = await render(ctx, baby, note);
        return ctx.editMessageText(text, kb);
      }
    } catch (e) {
      console.error('tap feed detail failed', e);
      return ctx.answerCbQuery("Sorry, that didn't save. Try again?");
    }
  });

  // ── Feed interval reminder ────────────────────────────────────────────────────

  bot.action(/^tap:remind:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return;
    const h = ctx.match[1];
    if (h === 'off') {
      clearFeedReminder(ctx.from.id);
      const { text, kb } = await render(ctx, baby, 'Reminder cancelled');
      try { await ctx.editMessageText(text, kb); } catch (e) { if (!/not modified/.test(e.description || e.message)) throw e; }
      return;
    }
    const hours    = parseInt(h, 10);
    const remindAt = new Date(Date.now() + hours * 3600 * 1000);
    setFeedReminder(ctx.from.id, remindAt, baby.name);
    const { text, kb } = await render(ctx, baby, `⏰ Reminder set for ${clock(remindAt)}`);
    try { await ctx.editMessageText(text, kb); } catch (e) { if (!/not modified/.test(e.description || e.message)) throw e; }
  });

  // ── Active latch timer controls ──────────────────────────────────────────────

  bot.action('tap:latch:switch', async (ctx) => {
    await ctx.answerCbQuery();
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return;
    const t = activeLatch.get(String(ctx.from.id));
    if (!t) {
      const { text, kb } = await render(ctx, baby);
      try { await ctx.editMessageText(text, kb); } catch (e) { if (!/not modified/.test(e.description || e.message)) throw e; }
      return;
    }
    const CYCLE = [null, 'left', 'right', 'both'];
    const cur   = CYCLE.indexOf(t.side);
    const next  = CYCLE[(cur + 1) % CYCLE.length];
    activeLatch.set(String(ctx.from.id), { ...t, side: next });
    const { text, kb } = await render(ctx, baby);
    try { await ctx.editMessageText(text, kb); } catch (e) { if (!/not modified/.test(e.description || e.message)) throw e; }
  });

  bot.action('tap:latch:stop', async (ctx) => {
    await ctx.answerCbQuery('Feed logged ✓');
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return;
    const t = activeLatch.get(String(ctx.from.id));
    activeLatch.delete(String(ctx.from.id));
    const now         = new Date();
    const startedAt   = t?.startedAt ?? now;
    const durationMin = Math.max(1, Math.round((now - startedAt) / 60000));
    const sideWord    = t?.side ?? null;
    const detail      = { type: 'latch', ...(sideWord ? { side: sideWord } : {}), duration_min: durationMin };
    const retroTs     = t?.retroTs ?? null;
    const logTs       = retroTs ?? startedAt;
    await logFeed(ctx, baby, detail, logTs);
    clearFeedReminder(ctx.from.id);
    const sideShort = sideWord === 'left' ? ' ⬅️' : sideWord === 'right' ? ' ➡️' : sideWord === 'both' ? ' ↔️' : '';
    const note = `🤱 Latch${sideShort} · ${durationMin}m at ${clock(logTs)}`;
    const { text, kb } = await render(ctx, baby, note);
    try { await ctx.editMessageText(text, kb); } catch (e) { if (!/not modified/.test(e.description || e.message)) throw e; }
  });

  // ── /weight command ───────────────────────────────────────────────────────────

  bot.command('weight', async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD.');
    const raw = ctx.message.text.replace(/^\/weight\s*/i, '').trim();
    const kg  = raw ? parseFloat(raw.replace(/kg/i, '').trim()) : NaN;
    if (!raw || isNaN(kg) || kg <= 0 || kg > 30) {
      const { data: recent } = await supabase.from('baby_events')
        .select('start_at, detail').eq('baby_id', baby.id).eq('kind', 'note')
        .eq('detail->>type', 'weight').order('start_at', { ascending: false }).limit(5);
      const lines = (recent || []).map(e => `${clock(e.start_at)}  ${e.detail.kg}kg`);
      const history = lines.length ? `\n\n_Recent weights:_\n${lines.join('\n')}` : '';
      return ctx.reply(`_Usage: /weight 3.65_\n\nSend the weight in kg (e.g. \`3.65\` or \`3.65kg\`).${history}`, { parse_mode: 'Markdown' });
    }
    await supabase.from('baby_events').insert({
      baby_id: baby.id, source: 'tap', logged_by: ctx.from.id,
      kind: 'note', start_at: new Date().toISOString(),
      detail: { type: 'weight', kg: +kg.toFixed(3) },
    });
    return ctx.reply(`⚖️ *${kg}kg* logged for ${baby.name}.`, { parse_mode: 'Markdown' });
  });

  // ── /milestone command ────────────────────────────────────────────────────────

  bot.command('milestone', async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD.');
    const text = ctx.message.text.replace(/^\/milestone\s*/i, '').trim();
    if (!text) {
      const { data: recent } = await supabase.from('baby_events')
        .select('start_at, detail').eq('baby_id', baby.id).eq('kind', 'note')
        .eq('detail->>type', 'milestone').order('start_at', { ascending: false }).limit(10);
      const lines = (recent || []).map((e, i) => `${i + 1}. ${e.detail.text} _(${clock(e.start_at)})_`);
      const list  = lines.length ? lines.join('\n') : '_None yet._';
      return ctx.reply(`*${baby.name} — milestones*\n\n${list}\n\n_Add one: /milestone First smile_`, { parse_mode: 'Markdown' });
    }
    await supabase.from('baby_events').insert({
      baby_id: baby.id, source: 'tap', logged_by: ctx.from.id,
      kind: 'note', start_at: new Date().toISOString(),
      detail: { type: 'milestone', text },
    });
    return ctx.reply(`🌟 *"${text}"* saved for ${baby.name}!`, { parse_mode: 'Markdown' });
  });
}
