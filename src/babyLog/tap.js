// Quick-tap logging for the hours before the notebook is scanned.
// /log shows one message with buttons; every tap updates that message.
// Once the day's notebook line is confirmed, paper replaces these taps
// automatically (baby_events_effective view), so nothing is double counted.

import { Markup } from 'telegraf';
import { clock, span, statusLine } from './format.js';

const UNDO_MINUTES = 30;

// ── Keyboards ────────────────────────────────────────────────────────────────

function keyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🍼 Feed', 'tap:feed'), Markup.button.callback('😴 Asleep', 'tap:sleep'),
      Markup.button.callback('☀️ Awake', 'tap:wake')],
    [Markup.button.callback('💧 Wet', 'tap:wet'), Markup.button.callback('💩 Dirty', 'tap:dirty'),
      Markup.button.callback('💧💩 Both', 'tap:both')],
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
    [Markup.button.callback('⏭ Skip', `tap:feed:breast:${side}:skip`)],
  ]);
}

function formulaAmountKeyboard() {
  return Markup.inlineKeyboard([
    [[30, 60, 90, 120].map(ml => Markup.button.callback(`${ml}ml`, `tap:feed:formula:${ml}`))],
    [Markup.button.callback('⏭ Skip', 'tap:feed:formula:skip')],
  ]);
}

// ── Render helpers ───────────────────────────────────────────────────────────

export function registerTapLog(bot, { supabase, queries }) {
  const q = queries;

  async function render(ctx, baby, note) {
    const st = await q.status(baby.id);
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

  bot.command('log', async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD (or /joinbaby CODE).');
    const { text, kb } = await render(ctx, baby);
    return ctx.reply(text, kb);
  });

  const insert = (baby, ctx, row) => supabase.from('baby_events').insert({
    baby_id: baby.id, source: 'tap', logged_by: ctx.from.id, start_at: new Date().toISOString(),
    precision_min: 1, ...row,
  });

  async function logFeed(ctx, baby, detail) {
    const { error } = await insert(baby, ctx, {
      kind: 'feed',
      detail: detail && Object.keys(detail).length ? detail : null,
    });
    if (error) throw error;
  }

  async function openSleep(babyId) {
    const { data } = await supabase.from('baby_events').select('*')
      .eq('baby_id', babyId).eq('kind', 'sleep').eq('source', 'tap').is('end_at', null).maybeSingle();
    return data;
  }

  // ── Simple tap actions (all except feed) ────────────────────────────────────

  const actions = {
    async feed(ctx, baby) {
      // Show feed type keyboard — the tap:feed:* handler finalises the log
      await ctx.answerCbQuery();
      await renderWithPrompt(ctx, baby, '_What type of feed?_', feedTypeKeyboard());
      return null; // handled
    },
    async sleep(ctx, baby) {
      const open = await openSleep(baby.id);
      if (open) return `Already asleep since ${clock(open.start_at)}`;
      const { error } = await insert(baby, ctx, { kind: 'sleep', end_at: null });
      if (error && error.code !== '23505') throw error;
      return `Asleep from ${clock(new Date())}`;
    },
    async wake(ctx, baby) {
      const open = await openSleep(baby.id);
      if (!open) return 'No sleep running. Tap 😴 when baby falls asleep next time.';
      const end = new Date();
      const { error } = await supabase.from('baby_events')
        .update({ end_at: end.toISOString(), detail: { ...(open.detail || {}), ended_by: ctx.from.id } })
        .eq('id', open.id);
      if (error) throw error;
      return `Slept ${span(end - new Date(open.start_at))}`;
    },
    wet:   (ctx, baby) => diaper(ctx, baby, { wet: true }),
    dirty: (ctx, baby) => diaper(ctx, baby, { dirty: true }),
    both:  (ctx, baby) => diaper(ctx, baby, { wet: true, dirty: true }),
    async undo(ctx, baby) {
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
    refresh: async () => null,
  };

  async function diaper(ctx, baby, detail) {
    const { error } = await insert(baby, ctx, { kind: 'diaper', detail });
    if (error) throw error;
    return `Diaper logged (${Object.keys(detail).join(' + ')})`;
  }

  // ── Simple action handler ────────────────────────────────────────────────────

  bot.action(/^tap:(\w+)$/, async (ctx) => {
    const fn = actions[ctx.match[1]];
    const baby = await q.babyFor(ctx.from.id);
    if (!fn || !baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');
    let note;
    try {
      note = await fn(ctx, baby);
    } catch (e) {
      console.error('tap log failed', e);
      return ctx.answerCbQuery("Sorry, that didn't save. Try again?");
    }
    if (note === null) return; // action managed its own message update
    await ctx.answerCbQuery(note || 'Updated');
    const { text, kb } = await render(ctx, baby, note);
    try {
      await ctx.editMessageText(text, kb);
    } catch (e) {
      if (!/message is not modified/.test(e.description || e.message)) throw e;
    }
  });

  // ── Feed detail sub-steps ────────────────────────────────────────────────────
  // Callback data format:
  //   tap:feed:skip                    → log plain feed, back to main keyboard
  //   tap:feed:breast                  → show side keyboard
  //   tap:feed:breast:skip             → log breast (no side/duration)
  //   tap:feed:breast:L|R|B            → show duration keyboard
  //   tap:feed:breast:L|R|B:N|skip     → log breast with side + optional duration
  //   tap:feed:formula                 → show amount keyboard
  //   tap:feed:formula:N|skip          → log formula with optional amount

  bot.action(/^tap:feed:(.+)$/, async (ctx) => {
    const baby = await q.babyFor(ctx.from.id);
    if (!baby) return ctx.answerCbQuery('Set up a profile first with /newbaby');

    const parts = ctx.match[1].split(':');

    try {
      // ── Skip → plain feed ──────────────────────────────────────────────────
      if (parts[0] === 'skip') {
        await logFeed(ctx, baby, {});
        const note = `Feed logged at ${clock(new Date())}`;
        await ctx.answerCbQuery(note);
        const { text, kb } = await render(ctx, baby, note);
        return ctx.editMessageText(text, kb);
      }

      // ── Breast ─────────────────────────────────────────────────────────────
      if (parts[0] === 'breast') {
        // Step 1: no side chosen yet → show side keyboard
        if (!parts[1]) {
          await ctx.answerCbQuery();
          return renderWithPrompt(ctx, baby, '_Breast — which side?_', breastSideKeyboard());
        }

        const side = parts[1]; // 'L' | 'R' | 'B' | 'skip'

        // 'skip' here means: log breast, no further detail
        if (side === 'skip') {
          await logFeed(ctx, baby, { type: 'breast' });
          const note = `🤱 Breast feed at ${clock(new Date())}`;
          await ctx.answerCbQuery(note);
          const { text, kb } = await render(ctx, baby, note);
          return ctx.editMessageText(text, kb);
        }

        // Step 2: side chosen, no duration yet → show duration keyboard
        if (!parts[2]) {
          await ctx.answerCbQuery();
          const sideLabel = side === 'L' ? 'Left' : side === 'R' ? 'Right' : 'Both';
          return renderWithPrompt(ctx, baby, `_${sideLabel} breast — how long?_`, breastDurationKeyboard(side));
        }

        // Step 3: side + duration → log and return to main keyboard
        const dur = parts[2]; // number string or 'skip'
        const sideLabel  = side === 'L' ? 'left' : side === 'R' ? 'right' : 'both';
        const detail = {
          type: 'breast',
          side: sideLabel,
          ...(dur !== 'skip' ? { duration_min: +dur } : {}),
        };
        await logFeed(ctx, baby, detail);
        const sideShort = side === 'B' ? 'Both' : side === 'L' ? 'Left' : 'Right';
        const durLabel  = dur !== 'skip' ? ` · ${dur}m` : '';
        const note      = `🤱 ${sideShort}${durLabel} at ${clock(new Date())}`;
        await ctx.answerCbQuery(note);
        const { text, kb } = await render(ctx, baby, note);
        return ctx.editMessageText(text, kb);
      }

      // ── Formula ────────────────────────────────────────────────────────────
      if (parts[0] === 'formula') {
        // Step 1: no amount yet → show amount keyboard
        if (!parts[1]) {
          await ctx.answerCbQuery();
          return renderWithPrompt(ctx, baby, '_Formula — how much?_', formulaAmountKeyboard());
        }

        // Step 2: amount chosen (or skipped) → log and return to main keyboard
        const amount = parts[1]; // number string or 'skip'
        const detail = {
          type: 'formula',
          ...(amount !== 'skip' ? { amount_ml: +amount } : {}),
        };
        await logFeed(ctx, baby, detail);
        const note = amount !== 'skip'
          ? `🍶 ${amount}ml at ${clock(new Date())}`
          : `🍶 Formula feed at ${clock(new Date())}`;
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
