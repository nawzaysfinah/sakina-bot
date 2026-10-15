// In-memory feed reminders. Lost on restart — acceptable for a convenience nudge.
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
