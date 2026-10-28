-- Checks supabase/migrations/20261027230000_lock_down_writes.sql. Run it in the SQL editor after the migration.
--
-- It acts as an anonymous visitor, a signed-in non-admin and an admin (test rows go in season 51, episode 99),
-- then always ends with an error whose message lists PASS or FAIL for each check. Ending with an error is what
-- rolls back everything the test wrote, so the error is expected: read the results in its message.

do $$
declare
  v_rows jsonb;       -- Cried on camera, then Found a new advantage, for the first Season 51 castaway
  v_results text[] := '{}';
  v_count integer;
  v_adv text;
begin
  select jsonb_build_array(
    jsonb_build_object('seq', 1, 'castaway_id', c.id, 'event_type_id', (select id from public.event_types where name = 'Cried on camera')),
    jsonb_build_object('seq', 2, 'castaway_id', c.id, 'event_type_id', (select id from public.event_types where name = 'Found advantage'),
                       'advantage_key', 'new:1'))
  into v_rows
  from public.castaways c where c.season = 51 order by c.id limit 1;

  -- ── 1. Anonymous visitor: can read, can't write ────────────────────────────
  set local role anon;
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);

  perform 1 from public.events limit 1;
  v_results := array_append(v_results, 'PASS: anon can read events');

  begin
    insert into public.events (season, episode, seq, castaway_id, event_type_id)
    values (51, 99, 1, (v_rows -> 0 ->> 'castaway_id')::bigint, (v_rows -> 0 ->> 'event_type_id')::bigint);
    v_results := array_append(v_results, 'FAIL: anon inserted an event');
  exception when insufficient_privilege then
    v_results := array_append(v_results, format('PASS: anon can''t insert events (%s)', sqlerrm));
  end;

  begin
    perform public.insert_episode_events(51::smallint, 99::smallint, '[]', v_rows);
    v_results := array_append(v_results, 'FAIL: anon called insert_episode_events');
  exception when insufficient_privilege then
    v_results := array_append(v_results, format('PASS: anon can''t call insert_episode_events (%s)', sqlerrm));
  end;

  -- ── 2. Signed in, not an admin: can't write ────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"role": "authenticated", "sub": "00000000-0000-0000-0000-000000000001", "app_metadata": {}}', true);

  begin
    insert into public.events (season, episode, seq, castaway_id, event_type_id)
    values (51, 99, 1, (v_rows -> 0 ->> 'castaway_id')::bigint, (v_rows -> 0 ->> 'event_type_id')::bigint);
    v_results := array_append(v_results, 'FAIL: a non-admin inserted an event');
  exception when insufficient_privilege then
    v_results := array_append(v_results, format('PASS: a non-admin can''t insert events (%s)', sqlerrm));
  end;

  begin
    insert into public.tribes (season, name, color) values (51, 'Test tribe', '#000000');
    v_results := array_append(v_results, 'FAIL: a non-admin inserted a tribe');
  exception when insufficient_privilege then
    v_results := array_append(v_results, format('PASS: a non-admin can''t insert tribes (%s)', sqlerrm));
  end;

  begin
    perform public.insert_episode_events(51::smallint, 99::smallint, '[]', v_rows);
    v_results := array_append(v_results, 'FAIL: a non-admin saved an episode');
  exception when insufficient_privilege then
    v_results := array_append(v_results, format('PASS: a non-admin can''t save an episode (%s)', sqlerrm));
  end;

  -- ── 3. Admin: can save, and the episode can't be saved twice ───────────────
  perform set_config('request.jwt.claims',
    '{"role": "authenticated", "sub": "00000000-0000-0000-0000-000000000002", "app_metadata": {"role": "admin"}}', true);

  v_count := public.insert_episode_events(51::smallint, 99::smallint,
    '[{"key": "new:1", "name": "Test advantage (lock down writes)"}]', v_rows);
  select advantage into v_adv from public.season_events_readable where season = 51 and episode = 99 and seq = 2;
  if v_count = 2 and v_adv = 'Test advantage (lock down writes)' then
    v_results := array_append(v_results, 'PASS: an admin saved 2 rows, with the new advantage created and linked');
  else
    v_results := array_append(v_results, format('FAIL: saved %s rows, advantage %s', v_count, v_adv));
  end if;

  begin
    perform public.insert_episode_events(51::smallint, 99::smallint, '[]', v_rows);
    v_results := array_append(v_results, 'FAIL: the same episode was saved twice');
  exception when raise_exception then
    v_results := array_append(v_results, format('PASS: an entered episode can''t be saved again (%s)', sqlerrm));
  end;

  v_count := public.replace_episode_events(51::smallint, 99::smallint, '[]', jsonb_build_array(v_rows -> 0));
  if v_count = 1 and (select count(*) from public.events where season = 51 and episode = 99) = 1 then
    v_results := array_append(v_results, 'PASS: replace_episode_events swapped the episode''s rows');
  else
    v_results := array_append(v_results, format('FAIL: replace wrote %s rows', v_count));
  end if;

  if (select count(*) from public.season_events_readable where season = 51)
     = (select count(*) from public.events where season = 51) then
    v_results := array_append(v_results, 'PASS: season_events_readable has one row per event');
  else
    v_results := array_append(v_results, 'FAIL: season_events_readable row count doesn''t match events');
  end if;

  -- Raising undoes everything above; the message carries the results out
  raise exception E'Test finished; everything it wrote was rolled back. Results:\n%', array_to_string(v_results, E'\n');
end $$;
