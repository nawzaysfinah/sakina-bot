-- Dad feature: link a secondary caregiver (dad/partner) to the primary caregiver's baby.
-- Run this in the Supabase SQL editor after supabase_baby_log.sql.

alter table users add column if not exists linked_user_id bigint references users(id);

comment on column users.linked_user_id is
  'Points to the primary caregiver whose baby this user is linked to via /joinbaby. '
  'When set, all baby log queries use that user''s id as the baby_id.';
