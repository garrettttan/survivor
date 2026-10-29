-- Phase 2 of editing episodes as cards: keep each episode's cards, and replace several episodes at once.
--
-- The admin page describes an episode as cards, and episode-entry turns them into events rows. Until now only the
-- rows were kept. This keeps the cards too (episode_cards), so an entered episode can be opened as cards again, and
-- adds replace_episodes, which an edit saves through: an edit to one episode can change the rows of every episode
-- after it, and they're all saved in one transaction.
--
-- Run it once in the SQL editor. Then run supabase/tests/episode_cards_test.sql, which rolls everything back.
-- insert_episode_events keeps working with its old four arguments, so the deployed episode-entry is fine until
-- it's redeployed.

begin;

-- ── Already applied on 2026-10-28 and 2026-10-29, kept here for the record ───
-- What a castaway goes by, if not their first name ("Ozzy" for Oscar Lusth): the site's short name, and in quotes in
-- their full name. Null for none.
alter table public.castaways add column if not exists nickname text;

-- A Starting tribe row may have no tribe (someone who joins the game later); other tribe changes still need one
create or replace function public.check_event_fields()
 returns trigger
 language plpgsql
as $function$declare
  t public.event_types;
begin
  select * into t from public.event_types where id = new.event_type_id;

  if t.advantage_effect is not null and new.advantage_id is null then
    raise exception '"%" requires advantage_id', t.name;
  end if;

  if t.changes_tribe and new.tribe_id is null and t.name <> 'Starting tribe' then
    raise exception '"%" requires tribe_id', t.name;
  end if;

  return new;
end$function$;

-- ── Each episode's cards ─────────────────────────────────────────────────────
-- The cards as the page sent them (shapes in js/admin/admin-cards.js). Only admins can see or change them: the
-- site reads events, never cards.
create table public.episode_cards (
  season     smallint    not null,
  episode    smallint    not null,
  cards      jsonb       not null,
  format     smallint    not null default 1,   -- bumped if card shapes change, so old cards can be upgraded
  updated_at timestamptz not null default now(),
  primary key (season, episode)
);

alter table public.episode_cards enable row level security;
revoke all on public.episode_cards from anon, authenticated;
grant select, insert, update, delete on public.episode_cards to authenticated;

create policy "Admins can read" on public.episode_cards for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins can insert" on public.episode_cards for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins can update" on public.episode_cards for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admins can delete" on public.episode_cards for delete to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ── Saving a new episode, with its cards ─────────────────────────────────────
-- Same as before, plus p_cards: the episode's cards, kept in episode_cards (null = keep none). The old four-argument
-- version is dropped; calls without p_cards still work through the default.
drop function public.insert_episode_events(smallint, smallint, jsonb, jsonb);

create function public.insert_episode_events(
  p_season smallint, p_episode smallint, p_new_advantages jsonb, p_rows jsonb, p_cards jsonb default null
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
  -- Editing an entered episode goes through replace_episodes
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

  if p_cards is not null then
    insert into public.episode_cards (season, episode, cards) values (p_season, p_episode, p_cards)
    on conflict (season, episode) do update set cards = excluded.cards, format = default, updated_at = now();
  end if;
  return v_count;
end;
$$;

-- ── Replacing entered episodes ───────────────────────────────────────────────
-- p_episodes: the episodes to replace, each with its rows and cards in insert_episode_events's shapes:
--   [{ "episode": 4, "new_advantages": [...], "rows": [...], "cards": [...] }, { "episode": 5, ... }]
-- Their old rows and cards are deleted, then each is saved through insert_episode_events, all in one transaction: if
-- any row fails a check, nothing changes. Advantages only the old rows used, and nothing uses now, are deleted;
-- other advantages aren't touched. Returns how many events rows were written.
create function public.replace_episodes(p_season smallint, p_episodes jsonb) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_episodes smallint[];
  v_old_advantages bigint[];
  v_episode jsonb;
  v_count integer := 0;
begin
  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only admins can enter events' using errcode = '42501';
  end if;
  select array_agg((e ->> 'episode')::smallint) into v_episodes from jsonb_array_elements(p_episodes) as e;
  if v_episodes is null then
    raise exception 'No episodes to replace';
  end if;
  if cardinality(v_episodes) <> (select count(distinct e) from unnest(v_episodes) as e) then
    raise exception 'An episode is listed more than once';
  end if;

  select array_agg(distinct advantage_id) into v_old_advantages
  from public.events where season = p_season and episode = any(v_episodes) and advantage_id is not null;

  delete from public.events where season = p_season and episode = any(v_episodes);
  delete from public.episode_cards where season = p_season and episode = any(v_episodes);

  for v_episode in select * from jsonb_array_elements(p_episodes) loop
    v_count := v_count + public.insert_episode_events(p_season, (v_episode ->> 'episode')::smallint,
      v_episode -> 'new_advantages', v_episode -> 'rows', v_episode -> 'cards');
  end loop;

  delete from public.advantages a
  where a.id = any(v_old_advantages)
    and not exists (select 1 from public.events e where e.advantage_id = a.id);
  return v_count;
end;
$$;

-- Replaced by replace_episodes; nothing called it
drop function public.replace_episode_events(smallint, smallint, jsonb, jsonb);

revoke execute on function public.insert_episode_events(smallint, smallint, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.replace_episodes(smallint, jsonb) from public, anon;
grant execute on function public.insert_episode_events(smallint, smallint, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.replace_episodes(smallint, jsonb) to authenticated;

commit;
