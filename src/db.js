import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUser(telegramId) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', telegramId)
    .single();
  return data;
}

export async function upsertUser(telegramId, fields) {
  const { data, error } = await supabase
    .from('users')
    .upsert({ id: telegramId, ...fields, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getAllUsers() {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('onboarding', 'done');
  return data || [];
}

// ── Task completions ───────────────────────────────────────────────────────────

export async function getCompletedTaskIds(userId, mode) {
  const { data } = await supabase
    .from('task_completions')
    .select('task_id')
    .eq('user_id', userId)
    .eq('mode', mode);
  return (data || []).map(r => r.task_id);
}

export async function markTasksDone(userId, mode, taskIds) {
  if (!taskIds.length) return;
  const rows = taskIds.map(task_id => ({ user_id: userId, mode, task_id }));
  await supabase
    .from('task_completions')
    .upsert(rows, { onConflict: 'user_id,task_id,mode', ignoreDuplicates: true });

  // Update streak
  await updateStreak(userId);
}

export async function unmarkLastTask(userId, mode) {
  // Find the most recently logged task
  const { data } = await supabase
    .from('task_completions')
    .select('id, task_id')
    .eq('user_id', userId)
    .eq('mode', mode)
    .order('id', { ascending: false })
    .limit(1);
  if (!data?.length) return null;
  const row = data[0];
  await supabase.from('task_completions').delete().eq('id', row.id);
  return row.task_id;
}

// ── Streak tracking ────────────────────────────────────────────────────────────

async function updateStreak(userId) {
  const today = new Date().toISOString().split('T')[0];
  const user  = await getUser(userId);
  if (!user) return;

  if (user.last_active_date === today) return; // already counted today

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split('T')[0];

  const newStreak = user.last_active_date === yStr
    ? (user.streak_days || 0) + 1
    : 1; // streak reset

  await supabase
    .from('users')
    .update({ streak_days: newStreak, last_active_date: today })
    .eq('id', userId);
}

// ── Reminders ──────────────────────────────────────────────────────────────────

export async function addReminder(userId, text, remindOn) {
  const { data, error } = await supabase
    .from('reminders')
    .insert({ user_id: userId, text, remind_on: remindOn })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTodayReminders(userId) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('reminders')
    .select('*')
    .eq('user_id', userId)
    .eq('remind_on', today)
    .eq('done', false)
    .order('created_at');
  return data || [];
}

export async function getUpcomingReminders(userId) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('reminders')
    .select('*')
    .eq('user_id', userId)
    .eq('done', false)
    .gte('remind_on', today)
    .order('remind_on')
    .limit(10);
  return data || [];
}

export async function markReminderDone(reminderId) {
  await supabase
    .from('reminders')
    .update({ done: true })
    .eq('id', reminderId);
}

export async function deleteReminder(reminderId) {
  await supabase
    .from('reminders')
    .delete()
    .eq('id', reminderId);
}

// ── Health logs — feeding, weight, nappy ──────────────────────────────────────

export async function addHealthLog(userId, logType, value, unit, note, side) {
  const { data, error } = await supabase
    .from('health_logs')
    .insert({ user_id: userId, log_type: logType, value, unit, note, side })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTodayHealthLogs(userId, logType) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('health_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('log_type', logType)
    .gte('logged_at', today + 'T00:00:00')
    .order('logged_at', { ascending: false });
  return data || [];
}

export async function getHealthLogsSince(userId, logType, sinceDays) {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const { data } = await supabase
    .from('health_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('log_type', logType)
    .gte('logged_at', since.toISOString())
    .order('logged_at', { ascending: false });
  return data || [];
}

// ── EPDS sessions ─────────────────────────────────────────────────────────────

export async function getEpdsSession(userId, dayMarker) {
  const { data } = await supabase
    .from('epds_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('day_marker', dayMarker)
    .single();
  return data;
}

export async function getActiveEpdsSession(userId) {
  const { data } = await supabase
    .from('epds_sessions')
    .select('*')
    .eq('user_id', userId)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

export async function startEpdsSession(userId, dayMarker) {
  // Upsert — if already exists for this day marker, return existing
  const existing = await getEpdsSession(userId, dayMarker);
  if (existing && !existing.completed_at) return existing;

  const { data, error } = await supabase
    .from('epds_sessions')
    .insert({ user_id: userId, day_marker: dayMarker, current_question: 1, responses: {} })
    .select()
    .single();
  if (error) {
    // Already exists — return it
    return await getEpdsSession(userId, dayMarker);
  }
  return data;
}

export async function updateEpdsResponse(sessionId, question, response) {
  const { data: session } = await supabase
    .from('epds_sessions')
    .select('responses')
    .eq('id', sessionId)
    .single();

  const responses = { ...(session?.responses || {}), [question]: response };
  const nextQ = question + 1;
  const isDone = nextQ > 10;

  const updates = {
    responses,
    current_question: isDone ? 11 : nextQ,
  };

  if (isDone) {
    // Calculate score
    const score = calculateEpdsScore(responses);
    updates.score = score;
    updates.completed_at = new Date().toISOString();
  }

  const { data } = await supabase
    .from('epds_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single();
  return data;
}

function calculateEpdsScore(responses) {
  // Questions 1-2: normal scoring 0-3
  // Questions 3-10: reverse scored for some (3,5,6,7,8,9,10 → stored as 0=never, 1=sometimes, etc.)
  // EPDS standard: Q1,Q2 normal; Q3,Q5,Q6,Q7,Q8,Q9,Q10 reverse scored
  const reverseQ = [3, 5, 6, 7, 8, 9, 10];
  let total = 0;
  for (let q = 1; q <= 10; q++) {
    const v = parseInt(responses[q] ?? 0);
    total += reverseQ.includes(q) ? (3 - v) : v;
  }
  return total;
}

// ── Milestone completions (Tumbuh gating) ────────────────────────────────────

export async function upsertMilestoneCompletion(userId, weekId, tasksDone, tasksTotal) {
  const { data, error } = await supabase
    .from('milestone_completions')
    .upsert(
      { user_id: userId, week_id: weekId, tasks_done: tasksDone, tasks_total: tasksTotal },
      { onConflict: 'user_id,week_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getMilestoneCompletions(userId) {
  const { data } = await supabase
    .from('milestone_completions')
    .select('*')
    .eq('user_id', userId);
  return data || [];
}

// ── Share tokens ──────────────────────────────────────────────────────────────

export async function createShareToken(ownerId) {
  // Revoke any existing token for this user
  await supabase.from('share_tokens').delete().eq('owner_user_id', ownerId);

  const token = generateToken();
  await supabase.from('share_tokens').insert({
    token,
    owner_user_id: ownerId,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return token;
}

export async function resolveShareToken(token) {
  const { data } = await supabase
    .from('share_tokens')
    .select('owner_user_id, expires_at')
    .eq('token', token)
    .single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data.owner_user_id;
}

function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
