// Feed combos — Pro feature. Saved formula+breast pairs for quick combo logging.

const MAX_COMBOS = 5;

export async function getCombos(supabase, babyId) {
  const { data } = await supabase
    .from('feed_combos')
    .select('id, name, formula_ml, breast_ml')
    .eq('baby_id', babyId)
    .order('created_at', { ascending: true })
    .limit(MAX_COMBOS);
  return data || [];
}

export async function saveCombo(supabase, babyId, userId, name, formulaMl, breastMl) {
  const existing = await getCombos(supabase, babyId);
  if (existing.length >= MAX_COMBOS) {
    throw new Error(`Max ${MAX_COMBOS} combos reached. Delete one first with /mycombos.`);
  }
  const { data, error } = await supabase
    .from('feed_combos')
    .insert({ baby_id: babyId, user_id: userId, name, formula_ml: formulaMl, breast_ml: breastMl })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteCombo(supabase, comboId, babyId) {
  const { error } = await supabase
    .from('feed_combos')
    .delete()
    .eq('id', comboId)
    .eq('baby_id', babyId);
  if (error) throw error;
}

export function comboLabel(combo) {
  const parts = [];
  if (combo.formula_ml) parts.push(`${combo.formula_ml}ml F`);
  if (combo.breast_ml)  parts.push(`${combo.breast_ml}ml B`);
  return `🍶🍼 ${combo.name} (${parts.join('+')})`;
}
