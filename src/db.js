import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
}

export async function getAllUsers() {
  const { data } = await supabase
    .from('users')
    .select('*')
    .not('onboarding', 'eq', 'start');
  return data || [];
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
