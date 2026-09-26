// Read side of the baby log. All data access goes through the SQL functions so
// paper-vs-tap merging lives in Postgres, not in JS.
//
// Option A adaptation: no babies/baby_caregivers tables.
// The "baby" is identified by the primary caregiver's Telegram user ID.
// users.baby_name, users.baby_dob, users.baby_role hold the profile.

import { addDays, currentRowDateStr } from './format.js';

function createQueries(supabase) {
  async function rpc(fn, args) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    return data;
  }

  return {
    /** Baby profile for this Telegram user, or null if not set up yet. */
    async babyFor(userId) {
      const { data, error } = await supabase.from('users')
        .select('id, baby_name, baby_dob, baby_role')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data || !data.baby_name) return null;
      return { id: data.id, name: data.baby_name, birth_date: data.baby_dob, role: data.baby_role || 'mother' };
    },

    /** Every primary caregiver who has a baby set up, for scheduled messages. */
    async allCaregivers() {
      const { data, error } = await supabase.from('users')
        .select('id, baby_name, baby_dob, baby_role, chat_id')
        .not('baby_name', 'is', null);
      if (error) throw error;
      return (data || []).map(u => ({
        telegram_user_id: u.chat_id || u.id,
        role: u.baby_role || 'mother',
        babies: { id: u.id, name: u.baby_name, birth_date: u.baby_dob },
      }));
    },

    status: (babyId) => rpc('baby_status', { p_baby: babyId }),

    days: (babyId, from, to) => rpc('baby_days', { p_baby: babyId, p_from: from, p_to: to }),

    averages: (babyId, days) => rpc('baby_averages', { p_baby: babyId, p_days: days }),

    async lastCompleteDay(babyId, now = new Date()) {
      const d = addDays(currentRowDateStr(now), -1);
      const [row] = await rpc('baby_days', { p_baby: babyId, p_from: d, p_to: d });
      return row;
    },

    claimJob: (job, key) => rpc('claim_job', { p_job: job, p_key: key }),
  };
}

export { createQueries };
