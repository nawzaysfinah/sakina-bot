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
// Fires two nudges per feed cycle regardless of user action:
//   +2h → skin-on-skin prompt
//   +3h → feed due alert
// userId → [{ remindAt: Date, type: 'skin_on_skin'|'feed_due', babyName: string }]
const autoStore = new Map();

export function setAutoFeedReminders(userId, babyName, feedTime = new Date()) {
  autoStore.set(String(userId), [
    { remindAt: new Date(feedTime.getTime() + 2 * 3600 * 1000), type: 'skin_on_skin', babyName },
    { remindAt: new Date(feedTime.getTime() + 3 * 3600 * 1000), type: 'feed_due',     babyName },
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
