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
    /** Baby profile for this Telegram user, or null if not set up yet.
     *  Follows linked_user_id so dads resolve to the primary caregiver's baby. */
    async babyFor(userId) {
      const { data, error } = await supabase.from('users')
        .select('id, baby_name, baby_dob, baby_role, linked_user_id')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      if (data.linked_user_id) {
        const { data: owner, error: e2 } = await supabase.from('users')
          .select('id, baby_name, baby_dob')
          .eq('id', data.linked_user_id)
          .maybeSingle();
        if (e2) throw e2;
        if (!owner || !owner.baby_name) return null;
        return { id: owner.id, name: owner.baby_name, birth_date: owner.baby_dob, role: data.baby_role || 'father' };
      }

      if (!data.baby_name) return null;
      return { id: data.id, name: data.baby_name, birth_date: data.baby_dob, role: data.baby_role || 'mother' };
    },

    /** Every caregiver (primary + linked) who has a baby set up, for scheduled messages. */
    async allCaregivers() {
      const [{ data: primaries, error: e1 }, { data: linked, error: e2 }] = await Promise.all([
        supabase.from('users').select('id, baby_name, baby_dob, baby_role, chat_id').not('baby_name', 'is', null),
        supabase.from('users').select('id, baby_role, chat_id, linked_user_id').not('linked_user_id', 'is', null),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;

      const primaryMap = Object.fromEntries((primaries || []).map(u => [u.id, u]));

      const result = (primaries || []).map(u => ({
        telegram_user_id: u.chat_id || u.id,
        role: u.baby_role || 'mother',
        babies: { id: u.id, name: u.baby_name, birth_date: u.baby_dob },
      }));

      for (const u of (linked || [])) {
        const owner = primaryMap[u.linked_user_id];
        if (owner) {
          result.push({
            telegram_user_id: u.chat_id || u.id,
            role: u.baby_role || 'father',
            babies: { id: owner.id, name: owner.baby_name, birth_date: owner.baby_dob },
          });
        }
      }

      return result;
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
