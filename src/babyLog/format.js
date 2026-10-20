// Pure helpers: dates, durations, review text. Singapore has no DST (+08:00 fixed).

const SG_OFFSET_MS = 8 * 3600 * 1000;
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function sgNow(now = new Date()) {
  const d = new Date(now.getTime() + SG_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours() };
}

function currentRowDate(now = new Date()) {
  const t = sgNow(now);
  const d = new Date(Date.UTC(t.y, t.m - 1, t.day + (t.hour >= 19 ? 1 : 0)));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const pad  = n => String(n).padStart(2, '0');
const monthKey = (y, m) => `${y}-${pad(m)}`;

export function monthFromText(text, now = new Date()) {
  const cur = currentRowDate(now);
  const s   = (text || '').toLowerCase();
  const iso = s.match(/(\d{4})-(\d{1,2})/);
  if (iso) return monthKey(+iso[1], +iso[2]);
  const idx = MONTHS.findIndex(m => new RegExp(`\\b${m}`).test(s));
  if (idx >= 0) {
    const yr = s.match(/\b(20\d\d)\b/);
    let y = yr ? +yr[1] : cur.y;
    if (!yr && idx + 1 > cur.m + 1) y -= 1;
    return monthKey(y, idx + 1);
  }
  return monthKey(cur.y, cur.m);
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const rowDate   = (month, row)  => `${month}-${pad(row)}`;
export const monthTitle = month => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
export const shortDate = (month, row) => {
  const [, m] = month.split('-').map(Number);
  return `${row} ${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)}`;
};

export function hrs(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}

export function changedRows(month, readerRows, savedByDate) {
  const days = daysInMonth(month);
  return readerRows.filter(r => {
    if (r.blank || r.row > days) return false;
    const old = savedByDate[rowDate(month, r.row)];
    if (!old) return true;
    return old.sleep !== r.sleep
      || JSON.stringify([...(old.feeds || [])].sort((a, b) => a - b)) !== JSON.stringify(r.feeds)
      || (r.wet != null && old.wet !== r.wet)
      || (r.dirty != null && old.dirty !== r.dirty);
  });
}

function rowLine(month, r, isNew, skipped) {
  const st    = r.stats;
  const parts = [];
  if (st.sleep_min) parts.push(`slept ${hrs(st.sleep_min)} (night ${hrs(st.night_sleep_min)}, ${st.naps} nap${st.naps === 1 ? '' : 's'})`);
  else parts.push('no sleep marked');
  parts.push(`${st.feeds} feed${st.feeds === 1 ? '' : 's'}`);
  if (r.wet != null || r.dirty != null) parts.push(`W${r.wet ?? '?'} D${r.dirty ?? '?'}`);
  const unsure = r.uncertain.length ? ` · ${r.uncertain.length} square${r.uncertain.length === 1 ? '' : 's'} unclear` : '';
  const mark   = skipped ? '⏭' : r.uncertain.length ? '⚠️' : '✓';
  const tag    = isNew ? '' : ' (updated)';
  return `${mark} ${shortDate(month, r.row)}${tag}: ${parts.join(' · ')}${unsure}`;
}

export function reviewText(month, rows, savedByDate, warnings, skipped = []) {
  if (!rows.length) return `${monthTitle(month)}: nothing new since your last scan 👍`;
  const lines = rows.map(r => rowLine(month, r, !savedByDate[rowDate(month, r.row)], skipped.includes(r.row)));
  const out   = [`${monthTitle(month)}: ${rows.length} line${rows.length === 1 ? '' : 's'} to save`, '', ...lines];
  if (warnings.length) out.push('', ...warnings.map(w => `• ${w}`));
  out.push('', 'If something is wrong, fix it in the book and send the photos again.');
  return out.join('\n').slice(0, 4000);
}

const iso = d => `${d.y}-${pad(d.m)}-${pad(d.day)}`;
export function currentRowDateStr(now = new Date()) { return iso(currentRowDate(now)); }

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function clock(ts) {
  const d  = new Date(new Date(ts).getTime() + SG_OFFSET_MS);
  let   h  = d.getUTCHours();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${pad(d.getUTCMinutes())}${ap}`;
}

export function span(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'just now';
  const h = Math.floor(min / 60);
  return h ? `${h}h ${pad(min % 60)}m` : `${min}m`;
}

export function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).toLocaleString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  return `${wd} ${d} ${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)}`;
}

export function ageText(birthDate, now = new Date()) {
  if (!birthDate) return null;
  const days = Math.floor(
    (new Date(`${currentRowDateStr(now)}T00:00:00Z`) - new Date(`${birthDate}T00:00:00Z`)) / 864e5
  );
  if (days < 0) return null;
  const w = Math.floor(days / 7);
  return w < 1
    ? `${days} day${days === 1 ? '' : 's'} old`
    : `${w} week${w === 1 ? '' : 's'}${days % 7 ? ` ${days % 7} day${days % 7 === 1 ? '' : 's'}` : ''} old`;
}

export function statusLine(st, now = new Date(), birthDate = null, caregiverNames = null) {
  const byName = (userId) => caregiverNames && userId ? caregiverNames[String(userId)] || null : null;
  const today  = st?.today || {};
  const parts  = [];

  if (st?.last_feed) {
    const fd = st.last_feed.detail;
    let icon = '🍼', extra = '';
    if (fd?.type === 'latch') {
      icon = '🤱';
      const side = fd.side === 'left' ? 'L' : fd.side === 'right' ? 'R' : fd.side === 'both' ? 'B' : '';
      const dur  = fd.duration_min ? ` ${fd.duration_min}m` : '';
      extra = (side || dur) ? ` (${side}${dur})` : '';
    } else if (fd?.type === 'breast') {
      icon = '🍼';
      extra = fd.amount_ml ? ` (${fd.amount_ml}ml BM)` : ' (BM)';
    } else if (fd?.type === 'formula') {
      icon = '🍶';
      extra = fd.amount_ml ? ` (${fd.amount_ml}ml)` : '';
    }
    const by        = byName(st.last_feed.logged_by);
    const mlPart    = today.ml    ? ` · ${today.ml}ml`              : '';
    const latchPart = today.latch_min ? ` · ${span(today.latch_min * 60000)} latch` : '';
    const feedCount = today.feeds ? ` · ${today.feeds} feeds${mlPart}${latchPart}` : '';
    parts.push(`${icon} ${clock(st.last_feed.start_at)}${extra}${feedCount}${by ? ` · ${by}` : ''}`);
  }

  if (st?.sleep?.ongoing) {
    const sleepTotal = today.sleep_min ? ` · ${span(today.sleep_min * 60000)} today` : '';
    parts.push(`😴 since ${clock(st.sleep.start_at)}${sleepTotal}`);
  } else if (st?.sleep?.end_at) {
    const sleepTotal = today.sleep_min ? ` · ${span(today.sleep_min * 60000)} today` : '';
    parts.push(`☀️ awake ${clock(st.sleep.end_at)}${sleepTotal}`);
  }

  if (st?.last_diaper) {
    const k     = [st.last_diaper.detail?.wet && 'wet', st.last_diaper.detail?.dirty && 'dirty'].filter(Boolean).join(' + ');
    const by    = byName(st.last_diaper.logged_by);
    const wet   = today.wet   ?? 0;
    const dirty = today.dirty ?? 0;
    const counts = (wet || dirty) ? ` · W${wet} D${dirty}` : '';
    parts.push(`🧷 ${clock(st.last_diaper.start_at)}${k ? ` (${k})` : ''}${counts}${by ? ` · ${by}` : ''}`);
  }

  const statusText = parts.length ? parts.join('\n') : 'Nothing logged yet today.';

  // Next feed deadline (last feed + 3h)
  let nextFeedLine = '';
  if (st?.last_feed) {
    const nextAt = new Date(st.last_feed.start_at).getTime() + 3 * 3600 * 1000;
    nextFeedLine = nextAt > now.getTime()
      ? `\n\n⏰ feed by ${clock(new Date(nextAt))}`
      : `\n\n⏰ feed overdue`;
  }

  if (birthDate) {
    const ageDays = (now - new Date(birthDate)) / 86400000;
    if (ageDays <= 14) {
      const sinceLastFeed   = st?.last_feed   ? now - new Date(st.last_feed.start_at)   : Infinity;
      const sinceLastDiaper = st?.last_diaper ? now - new Date(st.last_diaper.start_at) : Infinity;
      const dayNum = Math.floor(ageDays) + 1;
      const warnings = [];
      if (sinceLastFeed   > 3 * 3600 * 1000) warnings.push(`⚠️ _Day ${dayNum}: wake to feed — every 2–4h_`);
      if (sinceLastDiaper > 3 * 3600 * 1000 && sinceLastDiaper !== Infinity)
        warnings.push(`⚠️ _No diaper in ${Math.floor(sinceLastDiaper / 3600000)}h — check hydration_`);
      if (warnings.length) return `${statusText}${nextFeedLine}\n${warnings.join('\n')}`;
    }
  }

  return `${statusText}${nextFeedLine}`;
}

// Concise night-time status (10pm–6am SGT) — just what matters at 3am.
export function nightStatusLine(st, now = new Date(), birthDate = null) {
  if (!st?.last_feed) {
    if (!birthDate) return 'Not fed yet.';
    const ageDays = (now - new Date(birthDate)) / 86400000;
    if (ageDays <= 14) return `Not fed yet.\n⚠️ _Day ${Math.floor(ageDays) + 1}: wake to feed every 2–4h_`;
    return 'Not fed yet.';
  }
  const sinceLastFeed = now - new Date(st.last_feed.start_at);
  const fd = st.last_feed.detail;
  let icon = '🍼';
  if (fd?.type === 'latch') icon = '🤱';
  else if (fd?.type === 'formula') icon = '🍶';
  let text = `${icon} ${span(sinceLastFeed)} ago · ${clock(st.last_feed.start_at)}`;
  if (st?.sleep?.ongoing) text += `\n😴 asleep ${span(now - new Date(st.sleep.start_at))}`;
  if (birthDate) {
    const ageDays = (now - new Date(birthDate)) / 86400000;
    if (ageDays <= 14 && sinceLastFeed > 3 * 3600 * 1000)
      text += `\n⚠️ _Day ${Math.floor(ageDays) + 1}: feed overdue_`;
  }
  return text;
}

export { sgNow, currentRowDate };
