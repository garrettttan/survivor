-- Phase 1 of the episode entry page: lock down writes.
--
-- Until now every public table had only a read policy, so writes through the API were blocked for everyone and
-- events were entered in the Table Editor (which bypasses RLS). This lets an admin (a user whose app_metadata.role
-- is "admin") write events, advantages and tribes through the API, adds the SQL functions the episode-entry edge
-- function saves through, and a season-level events view that doesn't depend on drafts.
--
-- Run it once in the SQL editor. Then run supabase/tests/lock_down_writes_test.sql, which checks that anonymous
-- and non-admin users are blocked and an admin can save, and rolls everything back.

begin;

-- ── Clean up rights the API never needs ──────────────────────────────────────
-- TRUNCATE skips RLS, and nothing uses TRIGGER or REFERENCES through the API. The two views can't be written to.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke insert, update, delete on public.events_readable, public.rosters_readable from anon, authenticated;
-- Season setup and scoring stay in the Table Editor, so the API gets no writes to them
revoke insert, update, delete on public.drafts, public.event_types, public.scoring, public.events_import from authenticated;

-- ── Admin writes to events, advantages and tribes ────────────────────────────
grant insert, update, delete on public.tribes to authenticated;

create policy "Admins can insert" on public.events for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins can update" on public.events for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins can delete" on public.events for delete to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can insert" on public.advantages for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins can update" on public.advantages for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins can delete" on public.advantages for delete to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can insert" on public.tribes for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins can update" on public.tribes for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins can delete" on public.tribes for delete to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ── Saving an episode in one transaction ─────────────────────────────────────
-- supabase-js can't wrap several calls in a transaction, so episode-entry saves through these. Both run as the
-- caller (security invoker), so the policies above still decide; the role check up front just gives a clear error.
--
-- p_new_advantages: advantages first found this episode, created before the rows that use them:
--   [{ "key": "new:1", "name": "Extra vote (Hina)" }]
-- p_rows: the episode's events rows, in order. A row names an existing advantage by advantage_id, or a new one by
-- advantage_key (a key from p_new_advantages):
--   [{ "seq": 1, "castaway_id": 12, "event_type_id": 4, "advantage_id": null, "advantage_key": "new:1",
--      "other_castaway_id": null, "tribe_id": null, "quantity": 1, "details": null }]
-- Returns how many events rows were written.
create function public.insert_episode_events(
  p_season smallint, p_episode smallint, p_new_advantages jsonb, p_rows jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new record;
  v_id bigint;
  v_keys jsonb := '{}';
  v_count integer;
begin
  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only admins can enter events' using errcode = '42501';
  end if;
  -- Editing an entered episode goes through replace_episode_events
  if exists (select 1 from public.events where season = p_season and episode = p_episode) then
    raise exception 'Season % episode % already has events', p_season, p_episode;
  end if;

  for v_new in select * from jsonb_to_recordset(coalesce(p_new_advantages, '[]')) as a(key text, name text) loop
    insert into public.advantages (season, name) values (p_season, v_new.name) returning id into v_id;
    v_keys := v_keys || jsonb_build_object(v_new.key, v_id);
  end loop;

  insert into public.events
    (season, episode, seq, castaway_id, event_type_id, advantage_id, other_castaway_id, tribe_id, quantity, details)
  select p_season, p_episode, r.seq, r.castaway_id, r.event_type_id,
         coalesce(r.advantage_id, (v_keys ->> r.advantage_key)::bigint),
         r.other_castaway_id, r.tribe_id, coalesce(r.quantity, 1), r.details
  from jsonb_to_recordset(p_rows) as r(
    seq numeric, castaway_id bigint, event_type_id bigint, advantage_id bigint, advantage_key text,
    other_castaway_id bigint, tribe_id bigint, quantity numeric, details text
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- For edit mode (phase 6): swaps an entered episode's rows for new ones, same arguments
create function public.replace_episode_events(
  p_season smallint, p_episode smallint, p_new_advantages jsonb, p_rows jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only admins can enter events' using errcode = '42501';
  end if;
  delete from public.events where season = p_season and episode = p_episode;
  return public.insert_episode_events(p_season, p_episode, p_new_advantages, p_rows);
end;
$$;

revoke execute on function public.insert_episode_events(smallint, smallint, jsonb, jsonb) from public, anon;
revoke execute on function public.replace_episode_events(smallint, smallint, jsonb, jsonb) from public, anon;
grant execute on function public.insert_episode_events(smallint, smallint, jsonb, jsonb) to authenticated;
grant execute on function public.replace_episode_events(smallint, smallint, jsonb, jsonb) to authenticated;

-- ── Season-level events view ─────────────────────────────────────────────────
-- events_readable joins drafts, so it has one row per event per draft and nothing for a season without a draft.
-- This has one row per event, with points from the season's default scoring only. episode-entry replays it;
-- get-draft-data keeps reading events_readable for its draft.
create view public.season_events_readable with (security_invoker = true) as
select e.id as event_id,
       e.season,
       e.episode,
       e.seq,
       e.castaway_id,
       c.first_name as castaway_first_name,
       c.last_name as castaway_last_name,
       t.category,
       t.name as event,
       t.changes_tribe,
       t.ends_game,
       t.advantage_effect,
       e.advantage_id,
       a.name as advantage,
       e.tribe_id,
       tr.name as tribe,
       tr.color as tribe_color,
       e.other_castaway_id,
       oc.name as other_castaway,
       e.details,
       e.quantity,
       coalesce(dr.points, 0) * coalesce(e.quantity, 1) as points
from public.events e
join public.castaways c on c.id = e.castaway_id
join public.event_types t on t.id = e.event_type_id
left join public.advantages a on a.id = e.advantage_id
left join public.tribes tr on tr.id = e.tribe_id
left join public.castaways oc on oc.id = e.other_castaway_id
left join public.scoring dr on dr.draft_id is null and dr.season = e.season and dr.event_type_id = e.event_type_id;

revoke all on public.season_events_readable from anon, authenticated;
grant select on public.season_events_readable to anon, authenticated;

-- ── Unused ───────────────────────────────────────────────────────────────────
-- Refers to event_types.season, which no longer exists
drop function public.game_bundle(smallint, bigint);

commit;
