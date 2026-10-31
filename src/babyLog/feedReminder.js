// In-memory feed reminders. Lost on restart — acceptable for convenience nudges.

// ── Manual reminders (user-set via ⏰ button) ─────────────────────────────────
// userId → { remindAt: Date, babyName: string }
const store = new Map();

export function setFeedReminder(userId, remindAt, babyName) {
  store.set(String(userId), { remindAt, babyName });
}

export function clearFeedReminder(userId) {
  store.delete(String(userId));
}

export function getFeedReminder(userId) {
  return store.get(String(userId)) ?? null;
}

export function popDueReminders(now = new Date()) {
  const due = [];
  for (const [userId, r] of store.entries()) {
    if (r.remindAt <= now) { due.push({ userId, ...r }); store.delete(userId); }
  }
  return due;
}

// ── Auto reminders (set automatically after every feed) ───────────────────────
// Fires 15 min before the Bayesian-predicted next feed time.
// userId → [{ remindAt: Date, type: 'next_feed', babyName: string }]
const autoStore = new Map();

export function setAutoFeedReminders(userId, babyName, predictedMs) {
  autoStore.set(String(userId), [
    { remindAt: new Date(predictedMs - 15 * 60 * 1000), type: 'next_feed', babyName },
  ]);
}

export function clearAutoFeedReminders(userId) {
  autoStore.delete(String(userId));
}

export function popDueAutoReminders(now = new Date()) {
  const due = [];
  for (const [userId, reminders] of autoStore.entries()) {
    const still = reminders.filter(r => {
      if (r.remindAt <= now) { due.push({ userId, ...r }); return false; }
      return true;
    });
    if (still.length) autoStore.set(userId, still);
    else autoStore.delete(userId);
  }
  return due;
}
