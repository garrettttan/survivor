-- Checks supabase/migrations/20261029120000_episode_cards.sql. Run it in the SQL editor after the migration.
--
-- Test rows go in season 51, episodes 97–99. Like lock_down_writes_test.sql, it always ends with an error whose
-- message lists PASS or FAIL for each check: ending with an error is what rolls back everything it wrote.

do $$
declare
  v_castaway bigint;
  v_cried bigint;
  v_found bigint;
  v_adv_a bigint;      -- found in episode 98, still used after the replace
  v_adv_b bigint;      -- found in episode 99, unused after the replace
  v_results text[] := '{}';
  v_count integer;
  v_cards jsonb;
begin
  select id into v_castaway from public.castaways where season = 51 order by id limit 1;
  select id into v_cried from public.event_types where name = 'Cried on camera';
  select id into v_found from public.event_types where name = 'Found advantage';

  -- ── 1. Admin: a new episode keeps its cards ────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"role": "authenticated", "sub": "00000000-0000-0000-0000-000000000002", "app_metadata": {"role": "admin"}}', true);

  perform public.insert_episode_events(51::smallint, 98::smallint,
    '[{"key": "new:a", "name": "Test advantage A (episode cards)"}]',
    jsonb_build_array(jsonb_build_object('seq', 1, 'castaway_id', v_castaway, 'event_type_id', v_found, 'advantage_key', 'new:a')),
    '[{"type": "test", "n": 98}]');
  perform public.insert_episode_events(51::smallint, 99::smallint,
    '[{"key": "new:b", "name": "Test advantage B (episode cards)"}]',
    jsonb_build_array(
      jsonb_build_object('seq', 1, 'castaway_id', v_castaway, 'event_type_id', v_cried),
      jsonb_build_object('seq', 2, 'castaway_id', v_castaway, 'event_type_id', v_found, 'advantage_key', 'new:b')),
    '[{"type": "test", "n": 99}]');
  select id into v_adv_a from public.advantages where season = 51 and name = 'Test advantage A (episode cards)';
  select id into v_adv_b from public.advantages where season = 51 and name = 'Test advantage B (episode cards)';

  select cards into v_cards from public.episode_cards where season = 51 and episode = 99;
  if v_cards = '[{"type": "test", "n": 99}]'::jsonb then
    v_results := array_append(v_results, 'PASS: a saved episode keeps its cards');
  else
    v_results := array_append(v_results, format('FAIL: episode 99''s cards are %s', v_cards));
  end if;

  -- The deployed episode-entry calls with four arguments until it's redeployed
  perform public.insert_episode_events(51::smallint, 97::smallint, '[]',
    jsonb_build_array(jsonb_build_object('seq', 1, 'castaway_id', v_castaway, 'event_type_id', v_cried)));
  if exists (select 1 from public.events where season = 51 and episode = 97)
     and not exists (select 1 from public.episode_cards where season = 51 and episode = 97) then
    v_results := array_append(v_results, 'PASS: a call without cards still saves the rows, and keeps no cards');
  else
    v_results := array_append(v_results, 'FAIL: a call without cards didn''t save as before');
  end if;

  -- ── 2. Others can't see cards or replace episodes ──────────────────────────
  perform set_config('request.jwt.claims',
    '{"role": "authenticated", "sub": "00000000-0000-0000-0000-000000000001", "app_metadata": {}}', true);
  select count(*) into v_count from public.episode_cards where season = 51 and episode between 97 and 99;
  if v_count = 0 then
    v_results := array_append(v_results, 'PASS: a non-admin sees no cards');
  else
    v_results := array_append(v_results, format('FAIL: a non-admin sees %s card rows', v_count));
  end if;
  begin
    perform public.replace_episodes(51::smallint, '[{"episode": 99, "rows": []}]');
    v_results := array_append(v_results, 'FAIL: a non-admin replaced an episode');
  exception when insufficient_privilege then
    v_results := array_append(v_results, format('PASS: a non-admin can''t replace episodes (%s)', sqlerrm));
  end;

  set local role anon;
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  begin
    perform 1 from public.episode_cards limit 1;
    v_results := array_append(v_results, 'FAIL: anon read episode_cards');
  exception when insufficient_privilege then
    v_results := array_append(v_results, format('PASS: anon can''t read cards (%s)', sqlerrm));
  end;
  begin
    perform public.replace_episodes(51::smallint, '[{"episode": 99, "rows": []}]');
    v_results := array_append(v_results, 'FAIL: anon replaced an episode');
  exception when insufficient_privilege then
    v_results := array_append(v_results, format('PASS: anon can''t call replace_episodes (%s)', sqlerrm));
  end;

  -- ── 3. Admin: replacing is all or nothing ──────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"role": "authenticated", "sub": "00000000-0000-0000-0000-000000000002", "app_metadata": {"role": "admin"}}', true);

  -- Episode 98 is fine; episode 99's Found advantage row has no advantage, which check_event_fields refuses
  begin
    perform public.replace_episodes(51::smallint, jsonb_build_array(
      jsonb_build_object('episode', 98, 'cards', '[]'::jsonb,
        'rows', jsonb_build_array(jsonb_build_object('seq', 1, 'castaway_id', v_castaway, 'event_type_id', v_cried))),
      jsonb_build_object('episode', 99, 'cards', '[]'::jsonb,
        'rows', jsonb_build_array(jsonb_build_object('seq', 1, 'castaway_id', v_castaway, 'event_type_id', v_found)))));
    v_results := array_append(v_results, 'FAIL: a replace with a bad row went through');
  exception when raise_exception then
    if (select advantage_id from public.events where season = 51 and episode = 98) = v_adv_a
       and (select count(*) from public.events where season = 51 and episode = 99) = 2
       and (select cards from public.episode_cards where season = 51 and episode = 98) = '[{"type": "test", "n": 98}]'::jsonb then
      v_results := array_append(v_results, format('PASS: a bad row in episode 99 left episode 98 as it was (%s)', sqlerrm));
    else
      v_results := array_append(v_results, 'FAIL: a failed replace changed episode 98');
    end if;
  end;

  -- ── 4. Admin: replacing two episodes, and tidying advantages ───────────────
  -- Episode 98 keeps finding A; episode 99 no longer finds B
  v_count := public.replace_episodes(51::smallint, jsonb_build_array(
    jsonb_build_object('episode', 98, 'cards', '[{"type": "test", "n": 980}]'::jsonb,
      'rows', jsonb_build_array(jsonb_build_object('seq', 1, 'castaway_id', v_castaway, 'event_type_id', v_found, 'advantage_id', v_adv_a))),
    jsonb_build_object('episode', 99, 'cards', '[{"type": "test", "n": 990}]'::jsonb,
      'rows', jsonb_build_array(jsonb_build_object('seq', 1, 'castaway_id', v_castaway, 'event_type_id', v_cried)))));
  if v_count = 2
     and (select count(*) from public.events where season = 51 and episode = 99) = 1
     and (select cards from public.episode_cards where season = 51 and episode = 99) = '[{"type": "test", "n": 990}]'::jsonb then
    v_results := array_append(v_results, 'PASS: replace_episodes swapped both episodes'' rows and cards');
  else
    v_results := array_append(v_results, format('FAIL: replace wrote %s rows', v_count));
  end if;

  if exists (select 1 from public.advantages where id = v_adv_a)
     and not exists (select 1 from public.advantages where id = v_adv_b) then
    v_results := array_append(v_results, 'PASS: the advantage nothing uses now was deleted; the one still used stayed');
  else
    v_results := array_append(v_results, 'FAIL: advantages weren''t tidied as expected');
  end if;

  begin
    perform public.replace_episodes(51::smallint, '[{"episode": 99, "rows": []}, {"episode": 99, "rows": []}]');
    v_results := array_append(v_results, 'FAIL: an episode listed twice was replaced');
  exception when raise_exception then
    v_results := array_append(v_results, format('PASS: an episode listed twice is refused (%s)', sqlerrm));
  end;

  begin
    perform public.replace_episodes(51::smallint, '[]');
    v_results := array_append(v_results, 'FAIL: an empty replace went through');
  exception when raise_exception then
    v_results := array_append(v_results, format('PASS: an empty replace is refused (%s)', sqlerrm));
  end;

  -- Raising undoes everything above; the message carries the results out
  raise exception E'Test finished; everything it wrote was rolled back. Results:\n%', array_to_string(v_results, E'\n');
end $$;
