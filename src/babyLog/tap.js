// Quick-tap logging for the hours before the notebook is scanned.
// /log shows one message with buttons; every tap updates that message.
// Once the day's notebook line is confirmed, paper replaces these taps
// automatically (baby_events_effective view), so nothing is double counted.

import { Markup } from 'telegraf';
import { clock, span, statusLine } from './format.js';

const UNDO_MINUTES = 30;

function keyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🍼 Feed', 'tap:feed'), Markup.button.callback('😴 Asleep', 'tap:sleep'),
      Markup.button.callback('☀️ Awake', 'tap:wake')],
    [Markup.button.callback('💧 Wet', 'tap:wet'), Markup.button.callback('💩 Dirty', 'tap:dirty'),
      Markup.button.callback('💧💩 Both', 'tap:both')],
    [Markup.button.callback('↩️ Undo last', 'tap:undo'), Markup.button.callback('🔄', 'tap:refresh')],
  ]);
}

export function registerTapLog(bot, { supabase, queries }) {
  const q = queries;

  async function render(ctx, baby, note) {
    const st = await q.status(baby.id);
    const text = `${baby.name} right now\n\n${statusLine(st)}${note ? `\n\n✓ ${note}` : ''}`;
    return { text, kb: keyboard() };
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

  async function openSleep(babyId) {
    const { data } = await supabase.from('baby_events').select('*')
      .eq('baby_id', babyId).eq('kind', 'sleep').eq('source', 'tap').is('end_at', null).maybeSingle();
    return data;
  }

  const actions = {
    async feed(ctx, baby) {
      const { error } = await insert(baby, ctx, { kind: 'feed' });
      if (error) throw error;
      return `Feed logged at ${clock(new Date())}`;
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
    wet: (ctx, baby) => diaper(ctx, baby, { wet: true }),
    dirty: (ctx, baby) => diaper(ctx, baby, { dirty: true }),
    both: (ctx, baby) => diaper(ctx, baby, { wet: true, dirty: true }),
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
    await ctx.answerCbQuery(note || 'Updated');
    const { text, kb } = await render(ctx, baby, note);
    try {
      await ctx.editMessageText(text, kb);
    } catch (e) {
      if (!/message is not modified/.test(e.description || e.message)) throw e;
    }
  });
}
