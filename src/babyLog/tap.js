// Quick-tap logging for the hours before the notebook is scanned.
// /log shows one message with buttons; every tap updates that message.
// Once the day's notebook line is confirmed, paper replaces these taps
// automatically (baby_events_effective view), so nothing is double counted.

import { Markup } from 'telegraf';
import { clock, span, statusLine, currentRowDateStr, addDays, dayLabel, hrs } from './format.js';

const UNDO_MINUTES  = 30;
const RETRO_TTL_MS  = 3 * 60 * 1000; // 3 min to type a value before pending expires

// ── Retro state ───────────────────────────────────────────────────────────────
// userId → { kind, chatId, messageId, ts?, expiresAt }

const pendingRetro = new Map();

// ── Pending custom-value input ────────────────────────────────────────────────
// userId → { type: 'formula_amount'|'breast_duration', side?, chatId, messageId, expiresAt }

const pendingInput = new Map();

// ── Pending note text input ───────────────────────────────────────────────────
// userId → { chatId, messageId, retroTs: Date|null, expiresAt }

const pendingNote = new Map();

function getPendingNote(userId) {
  const p = pendingNote.get(userId);
  if (!p || Date.now() > p.expiresAt) { pendingNote.delete(userId); return null; }
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

function formatTodayEvents(events, babyName, rowDate = currentSgtDate(), now = new Date(), tz = 'Asia/Singapore') {
  const isToday = rowDate === currentSgtDate(now);
  if (!events?.length) {
    const header = isToday ? `*${babyName} today*` : `*${babyName} — ${dayLabel(rowDate)}*`;
    return `${header}\n\nNothing logged yet.`;
  }

  const lines = events.map(e => {
    const t = clockInTz(e.start_at, tz);
    let label;
    if (e.kind === 'feed') {
      const d = e.detail;
      if (d?.type === 'breast') {
        const side = d.side === 'left' ? 'L' : d.side === 'right' ? 'R' : 'B';
        label = `🤱 Feed (${side}${d.duration_min ? ` ${d.duration_min}m` : ''})`;
      } else if (d?.type === 'formula') {
        label = `🍶 Feed${d.amount_ml ? ` (${d.amount_ml}ml)` : ''}`;
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
    return `\`${t}\`  ${label}`;
  });

  const header = isToday ? `*${babyName} today*` : `*${babyName} — ${dayLabel(rowDate)}*`;
  return `${header}\n\n${lines.join('\n')}`;
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
    if (d?.type === 'breast') {
      const side = d.side === 'left' ? 'L' : d.side === 'right' ? 'R' : 'B';
      return `🤱 ${t}${d.duration_min ? ` · ${d.duration_min}m` : ''} (${side})`;
    }
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
    [Markup.button.callback('🍼 Feed', 'tap:feed'), Markup.button.callback('😴 Asleep', 'tap:sleep'),
      Markup.button.callback('☀️ Awake', 'tap:wake')],
    [Markup.button.callback('💧 Wet', 'tap:wet'), Markup.button.callback('💩 Dirty', 'tap:dirty'),
      Markup.button.callback('💧💩 Both', 'tap:both')],
    [Markup.button.callback('📋 Today', 'tap:history'), Markup.button.callback('⏰ Past event', 'tap:past'),
      Markup.button.callback('📝 Note', 'tap:note')],
    [Markup.button.callback('↩️ Undo last', 'tap:undo'), Markup.button.callback('🔄', 'tap:refresh')],
  ]);
}

function feedTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🤱 Breast', 'tap:feed:breast'),
     Markup.button.callback('🍶 Formula', 'tap:feed:formula')],
    [Markup.button.callback('⏭ Skip', 'tap:feed:skip')],
  ]);
}

function breastSideKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Left',  'tap:feed:breast:L'),
     Markup.button.callback('➡️ Right', 'tap:feed:breast:R'),
     Markup.button.callback('↔️ Both',  'tap:feed:breast:B')],
    [Markup.button.callback('⏭ Skip', 'tap:feed:breast:skip')],
  ]);
}

function breastDurationKeyboard(side) {
  return Markup.inlineKeyboard([
    [5, 10, 15, 20, 30].map(d => Markup.button.callback(`${d}m`, `tap:feed:breast:${side}:${d}`)),
    [Markup.button.callback('✏️ Other', `tap:feed:breast:${side}:custom`),
     Markup.button.callback('⏭ Skip', `tap:feed:breast:${side}:skip`)],
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

function pastEventKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🍼 Feed', 'tap:past:feed'), Markup.button.callback('😴 Asleep', 'tap:past:sleep'),
     Markup.button.callback('☀️ Awake', 'tap:past:wake')],
    [Markup.button.callback('💧 Wet',  'tap:past:wet'),  Markup.button.callback('💩 Dirty', 'tap:past:dirty'),
     Markup.button.callback('💧💩 Both', 'tap:past:both')],
    [Markup.button.callback('📝 Note', 'tap:past:note'), Markup.button.callback('❌ Cancel', 'tap:back')],
  ]);
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerTapLog(bot, { supabase, queries }) {
  const q = queries;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async function render(ctx, baby, note) {
    const st   = await q.status(baby.id);
    const text = `${baby.name} right now\n\n${statusLine(st)}${note ? `\n\n✓ ${note}` : ''}`;
    return { text, kb: keyboard() };
  }

  async function renderWithPrompt(ctx, baby, prompt, kb) {
    const st = await q.status(baby.id);
    const text = `${baby.name} right now\n\n${statusLine(st)}\n\n${prompt}`;
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
    const ts = overrideTs ?? null;
    const { error } = await insertAt(baby, ctx, {
      kind: 'feed',
      detail: detail && Object.keys(detail).length ? detail : null,
    }, ts);
    if (error) throw error;
  }

  async function openSleep(babyId) {
    const { data } = await supabase.from('baby_events').select('*')
      .eq('baby_id', babyId).eq('kind', 'sleep').eq('source', 'tap').is('end_at', null).maybeSingle();
    return data;
  }

  // ── /log command ──────────────────────────────────────────────────────────────

  bot.command('log', async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD (or /joinbaby CODE).');
    const { text, kb } = await render(ctx, baby);
    return ctx.reply(text, kb);
  });

  // ── /logs — day view + navigation ─────────────────────────────────────────────

  async function getUserTz(userId) {
    const { data } = await supabase.from('users').select('timezone').eq('id', userId).maybeSingle();
    return data?.timezone || 'Asia/Singapore';
  }

  async function sendLogsView(ctx, baby, dateStr) {
    const { start, end } = dayBoundsUtc(dateStr);
    const [{ data: events }, tz] = await Promise.all([
      supabase.from('baby_events_effective')
        .select('kind, start_at, end_at, detail, source')
        .eq('baby_id', baby.id)
        .gte('start_at', start)
        .lt('start_at', end)
        .order('start_at', { ascending: true }),
      getUserTz(ctx.from.id),
    ]);
    const text = formatTodayEvents(events, baby.name, dateStr, new Date(), tz);
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
    return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
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

  // ── Text handler for retro time input ─────────────────────────────────────────
  // Must be registered BEFORE the general message handler.

  bot.on('text', async (ctx, next) => {
    const text = ctx.message?.text?.trim() || '';
    if (text.startsWith('/')) return next(); // don't intercept commands

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
        await insertAt(baby, ctx, { kind: 'note', detail: { text } }, noteState.retroTs);
        const ts  = noteState.retroTs ?? new Date();
        const st  = await q.status(baby.id);
        const msg = `${baby.name} right now\n\n${statusLine(st)}\n\n✓ 📝 "${text}" at ${clock(ts)}`;
        await editLog(msg, keyboard());
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
        } else {
          const sideWord = inp.side === 'L' ? 'left' : inp.side === 'R' ? 'right' : 'both';
          const sideLabel = inp.side === 'B' ? 'Both' : inp.side === 'L' ? 'Left' : 'Right';
          detail = { type: 'breast', side: sideWord, duration_min: num };
          note   = `🤱 ${sideLabel} · ${num}m at ${clock(retroTs ?? new Date())}`;
        }
        await logFeed(ctx, baby, detail, retroTs);
        const st  = await q.status(baby.id);
        const msg = `${baby.name} right now\n\n${statusLine(st)}\n\n✓ ${note}`;
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
      const st  = await q.status(baby.id);
      const msg = `${baby.name} right now\n\n${statusLine(st)}\n\n_What type of feed? (${clock(ts)})_`;
      await editLog(msg, feedTypeKeyboard());
      return; // don't call next()
    }

    if (pending.kind === 'note') {
      // Time captured — now ask for the note text
      pendingRetro.delete(ctx.from.id);
      pendingNote.set(ctx.from.id, {
        chatId: pending.chatId, messageId: pending.messageId,
        retroTs: ts, expiresAt: Date.now() + RETRO_TTL_MS,
      });
      const st  = await q.status(baby.id);
      const msg = `${baby.name} right now\n\n${statusLine(st)}\n\n_Type your note for ${clock(ts)}:_`;
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
          note = `😴 Asleep at ${clock(ts)}`;
        }
      } else if (pending.kind === 'wake') {
        const open = await openSleep(baby.id);
        if (!open) {
          note = 'No open sleep to close — tap 😴 Asleep first.';
        } else {
          const { error } = await supabase.from('baby_events')
            .update({ end_at: ts.toISOString(), detail: { ...(open.detail || {}), ended_by: ctx.from.id } })
            .eq('id', open.id);
          if (error) throw error;
          note = `☀️ Woke up at ${clock(ts)} (slept ${span(ts - new Date(open.start_at))})`;
        }
      } else {
        const detailMap = {
          wet:   { wet: true },
          dirty: { dirty: true },
          both:  { wet: true, dirty: true },
        };
        await insertAt(baby, ctx, { kind: 'diaper', detail: detailMap[pending.kind] }, ts);
        const icons = { wet: '💧', dirty: '💩', both: '💧💩' };
        note = `${icons[pending.kind]} at ${clock(ts)}`;
      }
      const st  = await q.status(baby.id);
      const msg = `${baby.name} right now\n\n${statusLine(st)}\n\n✓ ${note}`;
      await editLog(msg, keyboard());
    } catch (e) {
      console.error('retro log failed', e);
      await ctx.reply("Sorry, that didn't save. Try again.");
    }
  });

  // ── Simple tap actions ────────────────────────────────────────────────────────

  const actions = {
    async feed(ctx, baby) {
      pendingRetro.delete(ctx.from.id); // clear stale retro state on normal feed tap
      await ctx.answerCbQuery();
      await renderWithPrompt(ctx, baby, '_What type of feed?_', feedTypeKeyboard());
      return null; // handled — don't call render() in outer handler
    },
    async sleep(ctx, baby) {
      pendingRetro.delete(ctx.from.id);
      const open = await openSleep(baby.id);
      if (open) return `Already asleep since ${clock(open.start_at)}`;
      const { error } = await insert(baby, ctx, { kind: 'sleep', end_at: null });
      if (error && error.code !== '23505') throw error;
      return `Asleep from ${clock(new Date())}`;
    },
    async wake(ctx, baby) {
      pendingRetro.delete(ctx.from.id);
      const open = await openSleep(baby.id);
      if (!open) return 'No sleep running. Tap 😴 when baby falls asleep next time.';
      const end = new Date();
      const { error } = await supabase.from('baby_events')
        .update({ end_at: end.toISOString(), detail: { ...(open.detail || {}), ended_by: ctx.from.id } })
        .eq('id', open.id);
      if (error) throw error;
      return `Slept ${span(end - new Date(open.start_at))}`;
    },
    wet:   (ctx, baby) => { pendingRetro.delete(ctx.from.id); return diaper(ctx, baby, { wet: true }); },
    dirty: (ctx, baby) => { pendingRetro.delete(ctx.from.id); return diaper(ctx, baby, { dirty: true }); },
    both:  (ctx, baby) => { pendingRetro.delete(ctx.from.id); return diaper(ctx, baby, { wet: true, dirty: true }); },
    async undo(ctx, baby) {
      pendingRetro.delete(ctx.from.id);
      const since = new Date(Date.now() - UNDO_MINUTES * 60e3).toISOString();
      const [{ data: made }, { data: woke }] = await Promise.all([
        supabase.from('baby_events').select('*').eq('baby_id', baby.id).eq('source', 'tap')
          .eq('logged_by', ctx.from.id).gte('created_at', since)
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
      return null; // handled
    },
    async back(ctx, baby) {
      pendingInput.delete(ctx.from.id);
      pendingNote.delete(ctx.from.id);
      await ctx.answerCbQuery();
      const { text, kb } = await render(ctx, baby);
      try { await ctx.editMessageText(text, kb); } catch (e) {
        if (!/message is not modified/.test(e.description || e.message)) throw e;
      }
      return null;
    },
    async past(ctx, baby) {
      await ctx.answerCbQuery();
      await renderWithPrompt(ctx, baby, '_What did you want to log?_', pastEventKeyboard());
      return null;
    },
    async note(ctx, baby) {
      await ctx.answerCbQuery();
      const chatId    = ctx.callbackQuery.message.chat.id;
      const messageId = ctx.callbackQuery.message.message_id;
      pendingNote.set(ctx.from.id, {
        chatId, messageId, retroTs: null,
        expiresAt: Date.now() + RETRO_TTL_MS,
      });
      await renderWithPrompt(ctx, baby, '_Type your note and send it:_',
        Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'tap:back')]]));
      return null;
    },
    refresh: async () => undefined,
  };

  async function diaper(ctx, baby, detail) {
    const { error } = await insert(baby, ctx, { kind: 'diaper', detail });
    if (error) throw error;
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

  // ── Retro event type selection ────────────────────────────────────────────────

  bot.action(/^tap:past:(\w+)$/, async (ctx) => {
    const kind = ctx.match[1];
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');

    await ctx.answerCbQuery();

    const chatId     = ctx.callbackQuery.message.chat.id;
    const messageId  = ctx.callbackQuery.message.message_id;
    const promptMap  = {
      feed:  '_What time was the feed?_\nReply with e.g. `2:30pm` or `14:30`',
      sleep: '_What time did baby fall asleep?_\nReply with e.g. `9:30pm` or `21:30`',
      wake:  '_What time did baby wake up?_\nReply with e.g. `9:30am` or `9:30`',
      wet:   '_What time was the wet nappy?_\nReply with e.g. `3pm` or `15:00`',
      dirty: '_What time was the dirty nappy?_\nReply with e.g. `3pm` or `15:00`',
      both:  '_What time was the nappy change?_\nReply with e.g. `3pm` or `15:00`',
      note:  '_What time did this happen?_\nReply with e.g. `2:30pm` or `14:30`',
    };

    const prompt = promptMap[kind];
    if (!prompt) return; // unknown kind

    pendingRetro.set(ctx.from.id, {
      kind, chatId, messageId,
      expiresAt: Date.now() + RETRO_TTL_MS,
    });

    await renderWithPrompt(ctx, baby, prompt,
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
      // ── skip → plain feed ────────────────────────────────────────────────────
      if (parts[0] === 'skip') {
        const ts   = consumeRetroTime(ctx.from.id);
        await logFeed(ctx, baby, {}, ts);
        const note = `Feed logged at ${clock(ts ?? new Date())}`;
        await ctx.answerCbQuery(note);
        const { text, kb } = await render(ctx, baby, note);
        return ctx.editMessageText(text, kb);
      }

      // ── breast ───────────────────────────────────────────────────────────────
      if (parts[0] === 'breast') {
        if (!parts[1]) {
          // Show side keyboard
          await ctx.answerCbQuery();
          return renderWithPrompt(ctx, baby, '_Breast — which side?_', breastSideKeyboard());
        }

        const side = parts[1]; // 'L' | 'R' | 'B' | 'skip'

        if (side === 'skip') {
          const ts   = consumeRetroTime(ctx.from.id);
          await logFeed(ctx, baby, { type: 'breast' }, ts);
          const note = `🤱 Breast feed at ${clock(ts ?? new Date())}`;
          await ctx.answerCbQuery(note);
          const { text, kb } = await render(ctx, baby, note);
          return ctx.editMessageText(text, kb);
        }

        if (!parts[2]) {
          // Show duration keyboard
          await ctx.answerCbQuery();
          const sLabel = side === 'L' ? 'Left' : side === 'R' ? 'Right' : 'Both';
          return renderWithPrompt(ctx, baby, `_${sLabel} breast — how long?_`, breastDurationKeyboard(side));
        }

        if (parts[2] === 'custom') {
          // Ask user to type a duration
          await ctx.answerCbQuery();
          pendingInput.set(ctx.from.id, {
            type: 'breast_duration', side,
            chatId: ctx.callbackQuery.message.chat.id,
            messageId: ctx.callbackQuery.message.message_id,
            expiresAt: Date.now() + RETRO_TTL_MS,
          });
          const sLabel = side === 'L' ? 'Left' : side === 'R' ? 'Right' : 'Both';
          return renderWithPrompt(ctx, baby, `_${sLabel} breast — how many minutes?_\nType a number e.g. \`25\``,
            Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'tap:back')]]));
        }

        // Log breast with side + optional duration
        const dur      = parts[2]; // number or 'skip'
        const sideWord = side === 'L' ? 'left' : side === 'R' ? 'right' : 'both';
        const detail   = { type: 'breast', side: sideWord, ...(dur !== 'skip' ? { duration_min: +dur } : {}) };
        const ts       = consumeRetroTime(ctx.from.id);
        await logFeed(ctx, baby, detail, ts);
        const sideShort = side === 'B' ? 'Both' : side === 'L' ? 'Left' : 'Right';
        const note      = `🤱 ${sideShort}${dur !== 'skip' ? ` · ${dur}m` : ''} at ${clock(ts ?? new Date())}`;
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
        await logFeed(ctx, baby, detail, ts);
        const note   = amount !== 'skip'
          ? `🍶 ${amount}ml at ${clock(ts ?? new Date())}`
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
}
