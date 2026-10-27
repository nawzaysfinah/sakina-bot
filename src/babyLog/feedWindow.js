// Computes a personalised "next feed window" by blending:
//   1. Volume-based estimate (ml × multiplier, or duration × 0.15 oz)
//   2. Historical inter-feed weighted average, conditioned on:
//      - feed type (formula / breast / latch)
//      - time of day (night 10pm–6am SGT vs day)
//      - recency (exponential decay, recent intervals weighted higher)
//
// Bucket priority: type+night > type > night > all intervals.
// Falls back to a wider bucket when the best has <2 points.
//
// Blend weights (volume vs trend):
//   <3 valid intervals: volume only (or trend-only / age prior if no volume)
//   3-5 intervals:  60% volume + 40% trend
//   6+ intervals:   40% volume + 60% trend

const MULTIPLIERS  = { latch: 1.0, breast: 1.0, formula: 1.25, combo: 1.1 };
const ML_PER_OZ    = 29.5735;
const MAX_GAP_H    = 8;    // ignore intervals longer than this (logging gaps)
const HARD_CAP_H   = 3;
const MIN_H        = 1.5;
const TREND_DECAY  = 0.85; // recency weight: most-recent = 1.0, each older step × 0.85

function volumeHours(detail) {
  if (!detail) return null;
  const type = detail.type || 'breast';
  const mult = MULTIPLIERS[type] ?? 1.0;
  let oz;
  if (detail.amount_ml && detail.amount_ml > 0) {
    oz = detail.amount_ml / ML_PER_OZ;
  } else if (detail.duration_min && detail.duration_min > 0) {
    oz = Math.min(detail.duration_min * 0.15, 2.5);
  } else {
    return null;
  }
  return oz * mult;
}

// Weighted average with exponential recency decay (diffs sorted oldest→newest)
function weightedAvg(diffs) {
  const n = diffs.length;
  let wSum = 0, wTotal = 0;
  for (let i = 0; i < n; i++) {
    const w  = Math.pow(TREND_DECAY, n - 1 - i);
    wSum    += diffs[i] * w;
    wTotal  += w;
  }
  return wSum / wTotal;
}

function sgtHour(ms) {
  return new Date(ms + 8 * 3600 * 1000).getUTCHours();
}

function isNight(h) { return h >= 22 || h < 6; }

// Age-based prior: grows from 1.5h at birth to 3.0h at 10 weeks
function agePrior(birthDate, feedMs) {
  if (!birthDate) return 3.0;
  const ageDays = Math.max(0, (feedMs - new Date(birthDate).getTime()) / 86400000);
  return Math.min(3.0, 1.5 + (ageDays / 70) * 1.5);
}

export async function fetchFeedWindow(babyId, feedDetail, feedTime, supabase, birthDate = null) {
  const feedMs    = feedTime instanceof Date ? feedTime.getTime() : new Date(feedTime).getTime();
  const feedType  = feedDetail?.type ?? null;
  const volH      = volumeHours(feedDetail);
  const baseH     = agePrior(birthDate, feedMs);
  const feedNight = isNight(sgtHour(feedMs));

  // Fetch last 20 feeds with type for conditioning
  const { data: recent } = await supabase
    .from('baby_events')
    .select('start_at, detail')
    .eq('baby_id', babyId)
    .eq('kind', 'feed')
    .eq('source', 'tap')
    .order('start_at', { ascending: false })
    .limit(20);

  let trendH = null;
  if (recent && recent.length >= 2) {
    const feeds = recent
      .map(r => ({
        ms:    new Date(r.start_at).getTime(),
        type:  r.detail?.type ?? null,
        night: isNight(sgtHour(new Date(r.start_at).getTime())),
      }))
      .sort((a, b) => a.ms - b.ms); // chronological for recency weighting

    // Build intervals annotated with conditioning flags
    const intervals = [];
    for (let i = 1; i < feeds.length; i++) {
      const diff = (feeds[i].ms - feeds[i - 1].ms) / 3600000;
      if (diff < 0.5 || diff > MAX_GAP_H) continue;
      const prevType    = feeds[i - 1].type;
      intervals.push({
        diff,
        sameType:  feedType && prevType ? prevType === feedType : false,
        sameNight: feeds[i - 1].night === feedNight,
      });
    }

    // Walk priority buckets — use first with ≥2 intervals
    const buckets = [
      intervals.filter(x => x.sameType && x.sameNight).map(x => x.diff),
      intervals.filter(x => x.sameType).map(x => x.diff),
      intervals.filter(x => x.sameNight).map(x => x.diff),
      intervals.map(x => x.diff),
    ];
    for (const b of buckets) {
      if (b.length >= 2) { trendH = weightedAvg(b); break; }
    }
  }

  // Blend volume + trend
  const n = recent?.length ?? 0;
  let predictedH;
  if (trendH === null || volH === null) {
    predictedH = volH ?? trendH ?? baseH;
  } else if (n >= 6) {
    predictedH = 0.4 * volH + 0.6 * trendH;
  } else {
    predictedH = 0.6 * volH + 0.4 * trendH;
  }
  predictedH = Math.max(MIN_H, predictedH);

  const latestRaw   = feedMs + (predictedH + 0.5) * 3600000;
  const hardCapMs   = feedMs + HARD_CAP_H * 3600000;
  const needsWake   = latestRaw > hardCapMs;
  const predictedMs = feedMs + predictedH * 3600000;
  return { predictedMs, hardCapMs, needsWake, predictedH, trendH, volH };
}
