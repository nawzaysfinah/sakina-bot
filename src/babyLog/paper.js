// Paper notebook scan flow.
//
// Commands:
//   /newbaby Aisyah 2026-10-03 mother   set up a baby profile on this user's account
//   /joinbaby CODE                      (dad feature — coming soon)
//   /scan [month]                       start a scan session, then send photos
// A photo captioned "log" (or "log oct") also opens a scan.
//
// Option A: baby profile lives on the users table, not a separate babies table.
// /newbaby updates users.baby_name, baby_dob, baby_role, baby_join_code.

import { randomBytes } from 'node:crypto';
import { Markup } from 'telegraf';
import { createReaderClient, ReaderError } from './readerClient.js';
import {
  monthFromText, monthTitle, changedRows, reviewText, rowDate, daysInMonth, shortDate,
} from './format.js';

const SESSION_MINUTES = 20;
const roleOf = (s) => (['mother', 'father'].includes((s || '').toLowerCase()) ? s.toLowerCase() : 'parent');
const OVERLAY_CAPTION = "Here is what I read. Purple = asleep, orange circles = feeds, amber boxes = squares I wasn't sure about.";

export function registerPaperLog(bot, {
  supabase,
  reader = createReaderClient({ url: process.env.PAPER_READER_URL, key: process.env.PAPER_READER_KEY }),
  tz = 'Asia/Singapore',
} = {}) {
  if (!supabase) throw new Error('registerPaperLog needs a supabase client');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- data helpers

  async function babyFor(userId) {
    const { data } = await supabase.from('users')
      .select('id, baby_name').eq('id', userId).maybeSingle();
    return (data && data.baby_name) ? { id: data.id, name: data.baby_name } : null;
  }

  async function openScan(chatId) {
    const since = new Date(Date.now() - SESSION_MINUTES * 60e3).toISOString();
    const { data } = await supabase.from('paper_scans').select('*')
      .eq('chat_id', chatId).eq('status', 'collecting').gte('updated_at', since)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    return data;
  }

  async function newScan(chatId, babyId, month) {
    await supabase.from('paper_scans').update({ status: 'discarded', file_ids: [], result: null })
      .eq('chat_id', chatId).in('status', ['collecting', 'review']);
    const { data, error } = await supabase.from('paper_scans')
      .insert({ chat_id: chatId, baby_id: babyId, month: `${month}-01` }).select().single();
    if (error) throw error;
    return data;
  }

  async function savedRows(babyId, month) {
    const { data } = await supabase.from('paper_rows').select('*').eq('baby_id', babyId)
      .gte('row_date', rowDate(month, 1)).lte('row_date', rowDate(month, daysInMonth(month)));
    return Object.fromEntries((data || []).map((r) => [r.row_date, r]));
  }

  async function download(ctx, fileId) {
    const link = await ctx.telegram.getFileLink(fileId);
    const res = await fetch(link.href || String(link));
    if (!res.ok) throw new Error(`Telegram download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  const monthOf = (scan) => scan.month.slice(0, 7);

  // ---------- commands

  bot.command('newbaby', async (ctx) => {
    const parts = (ctx.message.text || '').split(/\s+/);
    const name = parts[1];
    const birth = parts[2];
    const roleArg = parts[3];
    if (!name) return ctx.reply('Usage: /newbaby Name YYYY-MM-DD [mother|father]');
    const birth_date = /^\d{4}-\d{2}-\d{2}$/.test(birth || '') ? birth : null;
    const join_code = randomBytes(4).toString('hex').toUpperCase();
    const { error } = await supabase.from('users').update({
      baby_name: name,
      baby_dob: birth_date,
      baby_role: roleOf(roleArg),
      baby_join_code: join_code,
    }).eq('id', ctx.from.id);
    if (error) return ctx.reply("Sorry, I couldn't create that profile.");
    return ctx.reply(`Created ${name}'s log 🤍\nYour partner can join with:\n/joinbaby ${join_code}`);
  });

  // Partner linking is a future feature (dad role). For now, show a friendly placeholder.
  bot.command('joinbaby', async (ctx) => {
    const [, codeArg] = ctx.message.text.split(/\s+/);
    const code = (codeArg || '').toUpperCase();
    const { data: owner } = await supabase.from('users')
      .select('id, baby_name').eq('baby_join_code', code).maybeSingle();
    if (!owner) return ctx.reply("That code didn't match. Check it and try again.");
    return ctx.reply(`Partner linking is coming soon 🤍 When it's ready, you'll be connected to ${owner.baby_name}'s log.`);
  });

  async function startScan(ctx, text) {
    const baby = await babyFor(ctx.from.id);
    if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD (or /joinbaby CODE).');
    const month = monthFromText(text);
    await newScan(ctx.chat.id, baby.id, month);
    return ctx.reply(`📷 Send ${monthTitle(month)}: one photo of the left page, then one of the right.\n`
      + 'Lay the book flat, fill the frame with the page, and keep your shadow off it.');
  }

  bot.command('scan', (ctx) => startScan(ctx, ctx.message.text));
  bot.action('pl:start', async (ctx) => { await ctx.answerCbQuery(); return startScan(ctx, ''); });

  // ---------- photos

  bot.on('photo', async (ctx, next) => {
    const caption = ctx.message.caption || '';
    const album = ctx.message.media_group_id;
    let scan = await openScan(ctx.chat.id);
    if (!scan && album && !/^\s*log\b/i.test(caption)) {
      await sleep(1500);
      scan = await openScan(ctx.chat.id);
    }
    if (!scan && !/^\s*log\b/i.test(caption)) return next();

    if (!scan || /^\s*log\b/i.test(caption)) {
      const baby = await babyFor(ctx.from.id);
      if (!baby) return ctx.reply('Set up a profile first with /newbaby Name YYYY-MM-DD (or /joinbaby CODE).');
      if (!scan) scan = await newScan(ctx.chat.id, baby.id, monthFromText(caption));
    }

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const { data: updated, error } = await supabase.rpc('paper_scan_add_photo', { p_scan_id: scan.id, p_file_id: fileId });
    if (error) throw error;
    scan = Array.isArray(updated) ? updated[0] : updated;

    if (album && scan.file_ids.length < 2) {
      await sleep(2000);
      const again = await supabase.from('paper_scans').select('*').eq('id', scan.id).single();
      if (again.data.file_ids.length >= 2 || again.data.status !== 'collecting') return;
      scan = again.data;
    }
    return processScan(ctx, scan);
  });

  async function processScan(ctx, scan) {
    const month = monthOf(scan);
    await ctx.sendChatAction('typing');
    let res;
    try {
      const images = await Promise.all(scan.file_ids.map((id) => download(ctx, id)));
      res = await reader.readSpread(images);
    } catch (e) {
      if (e instanceof ReaderError) {
        const keep = ctx.message?.media_group_id ? [] : scan.file_ids.slice(0, -1);
        await supabase.from('paper_scans').update({ file_ids: keep }).eq('id', scan.id);
        return ctx.reply(`${e.message}\nPlease send that page again.`);
      }
      console.error('paper log read failed', e);
      return ctx.reply('Sorry, something went wrong reading that. Please try again in a moment.');
    }

    if (!res.complete) {
      const other = res.sides[0] === 'left' ? 'right' : 'left';
      return ctx.reply(`Got the ${res.sides[0]} page 👍 Now send the ${other} page.`);
    }

    const saved = await savedRows(scan.baby_id, month);
    const rows = changedRows(month, res.rows, saved);
    const text = reviewText(month, rows, saved, res.warnings);

    if (!rows.length) {
      await supabase.from('paper_scans').update({ status: 'discarded', file_ids: [], result: null }).eq('id', scan.id);
      return ctx.reply(text);
    }

    await supabase.from('paper_scans').update({
      status: 'review',
      result: { rows, warnings: res.warnings },
      skipped_rows: [],
      updated_at: new Date().toISOString(),
    }).eq('id', scan.id);

    await ctx.replyWithPhoto({ source: Buffer.from(res.overlay_jpeg_b64, 'base64') }, { caption: OVERLAY_CAPTION });
    return ctx.reply(text, reviewKeyboard(scan.id, month, rows, []));
  }

  function reviewKeyboard(scanId, month, rows, skipped) {
    const flagged = rows.filter((r) => r.uncertain.length).slice(0, 8);
    const skipButtons = flagged.map((r) => Markup.button.callback(
      `${skipped.includes(r.row) ? '↩️ Keep' : '⏭ Skip'} ${shortDate(month, r.row)}`, `pl:skip:${scanId}:${r.row}`));
    const grid = [];
    for (let i = 0; i < skipButtons.length; i += 2) grid.push(skipButtons.slice(i, i + 2));
    grid.push([Markup.button.callback('✅ Save', `pl:save:${scanId}`), Markup.button.callback('🗑 Discard', `pl:discard:${scanId}`)]);
    return Markup.inlineKeyboard(grid);
  }

  async function scanForAction(ctx, id) {
    const { data } = await supabase.from('paper_scans').select('*').eq('id', id).maybeSingle();
    if (!data || data.chat_id !== ctx.chat.id || data.status !== 'review') {
      await ctx.answerCbQuery('This scan is already closed.');
      return null;
    }
    return data;
  }

  // ---------- review buttons

  bot.action(/^pl:skip:(\d+):(\d+)$/, async (ctx) => {
    const scan = await scanForAction(ctx, +ctx.match[1]);
    if (!scan) return;
    const row = +ctx.match[2];
    const skipped = scan.skipped_rows.includes(row)
      ? scan.skipped_rows.filter((r) => r !== row) : [...scan.skipped_rows, row];
    await supabase.from('paper_scans').update({ skipped_rows: skipped }).eq('id', scan.id);
    const month = monthOf(scan);
    const saved = await savedRows(scan.baby_id, month);
    await ctx.answerCbQuery();
    return ctx.editMessageText(
      reviewText(month, scan.result.rows, saved, scan.result.warnings, skipped),
      reviewKeyboard(scan.id, month, scan.result.rows, skipped));
  });

  bot.action(/^pl:discard:(\d+)$/, async (ctx) => {
    const scan = await scanForAction(ctx, +ctx.match[1]);
    if (!scan) return;
    await supabase.from('paper_scans').update({ status: 'discarded', file_ids: [], result: null }).eq('id', scan.id);
    await ctx.answerCbQuery('Discarded');
    return ctx.editMessageText('Discarded. Nothing was saved.');
  });

  bot.action(/^pl:save:(\d+)$/, async (ctx) => {
    const scan = await scanForAction(ctx, +ctx.match[1]);
    if (!scan) return;
    await ctx.answerCbQuery('Saving…');
    const month = monthOf(scan);
    const keep = scan.result.rows.filter((r) => !scan.skipped_rows.includes(r.row));

    const upserts = keep.map((r) => ({
      baby_id: scan.baby_id,
      row_date: rowDate(month, r.row),
      sleep: r.sleep,
      feeds: r.feeds,
      wet: r.wet,
      dirty: r.dirty,
      uncertain: r.uncertain,
      scan_id: scan.id,
      confirmed_by: ctx.from.id,
      confirmed_at: new Date().toISOString(),
    }));
    if (upserts.length) {
      const { error } = await supabase.from('paper_rows').upsert(upserts, { onConflict: 'baby_id,row_date' });
      if (error) { console.error(error); return ctx.reply('Sorry, saving failed. Please try Save again.'); }
    }

    try {
      await rebuildPaperEvents(scan.baby_id, month);
    } catch (e) {
      console.error('paper log events rebuild failed', e);
    }
    await supabase.from('paper_scans').update({ status: 'saved', file_ids: [], result: null }).eq('id', scan.id);
    const skippedNote = scan.skipped_rows.length ? ` (${scan.skipped_rows.length} skipped)` : '';
    return ctx.editMessageText(`Saved ${upserts.length} line${upserts.length === 1 ? '' : 's'}${skippedNote} ✓ Thank you for keeping the log \u{1F90D}`);
  });

  async function rebuildPaperEvents(babyId, month) {
    const saved = Object.values(await savedRows(babyId, month));
    const rows = saved.map((r) => ({ row: +r.row_date.slice(8, 10), sleep: r.sleep, feeds: r.feeds || [] }));
    const { events } = await reader.events(month, rows, tz);
    const first = rowDate(month, 1);
    const last = rowDate(month, daysInMonth(month));
    const del = await supabase.from('baby_events').delete()
      .eq('baby_id', babyId).eq('source', 'paper').gte('row_date', first).lte('row_date', last);
    if (del.error) throw del.error;
    if (!events.length) return;
    const ins = await supabase.from('baby_events').insert(events.map((e) => ({
      baby_id: babyId,
      kind: e.kind,
      start_at: e.start_at,
      end_at: e.end_at,
      source: 'paper',
      row_date: e.row_date,
      precision_min: e.precision_min,
      detail: e.kind === 'sleep' ? { open_start: e.open_start, open_end: e.open_end } : null,
    })));
    if (ins.error) throw ins.error;
  }

  return { rebuildPaperEvents };
}
