// Computes a personalised "next feed window" by blending:
//   1. Volume-based estimate (ml × multiplier, or duration × 0.15 oz)
//   2. Historical inter-feed median from this baby's own tap data
//
// With <3 valid intervals: volume only.
// With 3-5 intervals: 60% volume + 40% trend.
// With 6+ intervals: 40% volume + 60% trend.

const MULTIPLIERS = { latch: 1.0, breast: 1.0, formula: 1.25, combo: 1.1 };
const ML_PER_OZ   = 29.5735;
const MAX_GAP_H   = 8;    // ignore intervals longer than this (logging gaps)
const HARD_CAP_H  = 4;
const MIN_H       = 1.5;

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

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

export async function fetchFeedWindow(babyId, feedDetail, feedTime, supabase) {
  const feedMs = feedTime instanceof Date ? feedTime.getTime() : new Date(feedTime).getTime();
  const volH   = volumeHours(feedDetail);

  // Fetch last 13 feeds to compute up to 12 intervals
  const { data: recent } = await supabase
    .from('baby_events')
    .select('start_at')
    .eq('baby_id', babyId)
    .eq('kind', 'feed')
    .eq('source', 'tap')
    .order('start_at', { ascending: false })
    .limit(13);

  let trendH = null;
  if (recent && recent.length >= 3) {
    const times = recent
      .map(r => new Date(r.start_at).getTime())
      .sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < times.length; i++) {
      const diff = (times[i] - times[i - 1]) / 3600000;
      if (diff >= 0.5 && diff <= MAX_GAP_H) intervals.push(diff);
    }
    if (intervals.length >= 2) trendH = median(intervals);
  }

  // Blend
  let predictedH;
  const n = recent?.length ?? 0;
  if (trendH === null || volH === null) {
    predictedH = volH ?? trendH ?? 3.0;
  } else if (n >= 6) {
    predictedH = 0.4 * volH + 0.6 * trendH;
  } else {
    predictedH = 0.6 * volH + 0.4 * trendH;
  }
  predictedH = Math.max(MIN_H, predictedH);

  const earliestMs = feedMs + Math.max(MIN_H, predictedH - 0.5) * 3600000;
  const latestRaw  = feedMs + (predictedH + 0.5) * 3600000;
  const hardCapMs  = feedMs + HARD_CAP_H * 3600000;
  const needsWake  = latestRaw > hardCapMs;
  const latestMs   = needsWake ? hardCapMs : latestRaw;

  const predictedMs = feedMs + predictedH * 3600000;
  return { predictedMs, hardCapMs, needsWake, predictedH, trendH, volH };
}
