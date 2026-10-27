// Evening reconciliation report — sent at 8:30pm SGT.
// 1. Feed merge candidates: same-type feeds 30–90 min apart that weren't auto-merged.
// 2. Sleep inference candidates: event gaps 30 min–6h with no sleep logged.

const SG_OFFSET_MS = 8 * 3600 * 1000;

function currentSgtDate(now = new Date()) {
  return new Date(now.getTime() + SG_OFFSET_MS).toISOString().slice(0, 10);
}

function dayBoundsUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, d, -8, 0, 0, 0)).toISOString(),
    end:   new Date(Date.UTC(y, m - 1, d + 1, -8, 0, 0, 0)).toISOString(),
  };
}

function clockSgt(ts) {
  return new Date(ts).toLocaleString('en-SG', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore',
  }).toLowerCase().replace(/ /g, '');
}

export async function sendReconciliationReport(bot, supabase, queries) {
  const caregivers = await queries.allCaregivers();
  const today      = currentSgtDate();

  for (const c of caregivers) {
    const { start, end } = dayBoundsUtc(today);

    const { data: events } = await supabase.from('baby_events')
      .select('id, kind, start_at, end_at, detail, source')
      .eq('baby_id', c.babies.id)
      .eq('source', 'tap')
      .gte('start_at', start)
      .lt('start_at', end)
      .order('start_at', { ascending: true });

    if (!events?.length) continue;

    // ── Feed merge candidates ────────────────────────────────────────────────
    // Same type, 30–90 min apart, both have amounts, neither already merged (no parts[])
    const feeds = events.filter(e => e.kind === 'feed' && e.detail?.amount_ml > 0);
    const mergeCandidates = [];
    for (let i = 1; i < feeds.length; i++) {
      const a = feeds[i - 1], b = feeds[i];
      const diffMin = (new Date(b.start_at) - new Date(a.start_at)) / 60000;
      if (
        diffMin > 30 && diffMin <= 90 &&
        a.detail.type === b.detail.type &&
        !a.detail.parts && !b.detail.parts
      ) {
        mergeCandidates.push({ a, b, diffMin: Math.round(diffMin) });
      }
    }

    // ── Sleep inference candidates ───────────────────────────────────────────
    // Gaps between active events (non-sleep) that have no sleep record overlapping
    const active = events.filter(e => e.kind !== 'sleep' && e.kind !== 'pd_question');
    const sleeps = events.filter(e => e.kind === 'sleep');
    const sleepCandidates = [];
    for (let i = 1; i < active.length; i++) {
      const gapStart = new Date(active[i - 1].start_at);
      const gapEnd   = new Date(active[i].start_at);
      const gapMin   = (gapEnd - gapStart) / 60000;
      if (gapMin < 30 || gapMin > 360) continue;
      const covered = sleeps.some(s => {
        const ss = new Date(s.start_at);
        const se = s.end_at ? new Date(s.end_at) : null;
        return ss < gapEnd && (!se || se > gapStart);
      });
      if (!covered) {
        sleepCandidates.push({ gapStart, gapEnd, gapMin: Math.round(gapMin) });
      }
    }

    const total = mergeCandidates.length + sleepCandidates.length;
    if (total === 0) continue;

    try {
      const babyName = c.babies.name;
      await bot.telegram.sendMessage(
        c.telegram_user_id,
        `🌙 *${babyName} — Evening review*\n\nFound ${total} item${total !== 1 ? 's' : ''} to check:`,
        { parse_mode: 'Markdown' },
      );

      for (const { a, b, diffMin } of mergeCandidates) {
        const icon      = a.detail.type === 'formula' ? '🍶' : '🍼';
        const typeLabel = a.detail.type === 'formula' ? 'Formula' : a.detail.type === 'breast' ? 'Breast' : 'Feed';
        const combined  = a.detail.amount_ml + b.detail.amount_ml;
        const msgText   = `${icon} *Merge feeds?*\n${clockSgt(a.start_at)} · ${a.detail.amount_ml}ml\n${clockSgt(b.start_at)} · ${b.detail.amount_ml}ml (${diffMin} min later)\n→ ${combined}ml as one ${typeLabel} feed`;
        await bot.telegram.sendMessage(c.telegram_user_id, msgText, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Merge', callback_data: `rec:feed:${a.id}:${b.id}` },
              { text: '❌ Skip',  callback_data: 'rec:skip' },
            ]],
          },
        });
      }

      for (const { gapStart, gapEnd, gapMin } of sleepCandidates) {
        const startSec = Math.floor(gapStart.getTime() / 1000);
        const endSec   = Math.floor(gapEnd.getTime() / 1000);
        const h        = Math.floor(gapMin / 60);
        const m        = gapMin % 60;
        const durStr   = h > 0 ? `${h}h ${m}m` : `${m}m`;
        const msgText  = `😴 *Log sleep?*\n${clockSgt(gapStart)} – ${clockSgt(gapEnd)} (${durStr})\nNo sleep event recorded for this gap.`;
        await bot.telegram.sendMessage(c.telegram_user_id, msgText, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Log sleep', callback_data: `rec:sleep:${startSec}:${endSec}` },
              { text: '❌ Skip',      callback_data: 'rec:skip' },
            ]],
          },
        });
      }
    } catch (e) {
      console.error('reconciliation report failed for', c.telegram_user_id, e.description || e.message);
    }
  }
}
