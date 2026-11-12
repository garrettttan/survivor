-- Received votes: each final-round vote at Tribal now also gives whoever it was for a row, pointing back at the
-- voter, right after the vote row: Received a vote, or Received a nullified vote when they were safe (an idol, Shot
-- in the Dark or immunity), so a season's scoring can treat the two differently. A vote for a pair gives both
-- partners a row. Neither scores in any season yet (no scoring rows, so 0); add scoring rows to give them points.
--
-- Backfill: every vote already recorded gets its Received a vote row, so episodes entered before this change match
-- what their cards make now (reopening one and saving it changes nothing, and one with no stored cards still
-- rebuilds as a Tribal). Only season 51 has recorded votes, and none of them was for someone safe, so every backfilled
-- row is Received a vote. The new rows go in right after their vote, and each episode they go into is renumbered 1..n.
--
-- Applied by the deployment (or supabase db push), not by hand, so the migration history records it.

begin;

-- event_types.id is generated; episode-entry finds event types by name
insert into public.event_types (category, name, description) values
  ('Voting', 'Received a vote',
   'A final-round vote at Tribal Council was cast for them, and it counted.'),
  ('Voting', 'Received a nullified vote',
   'A final-round vote at Tribal Council was cast for them, but didn''t count: they were safe (an idol, Shot in the Dark or immunity).');

-- One Received a vote row per recorded vote for a castaway, for that castaway, pointing at the voter. Its seq puts it
-- just after the vote (the renumbering below makes it a whole number).
create temporary table received_backfill on commit drop as
select v.season, v.episode, v.seq + 0.5 as seq, v.other_castaway_id as castaway_id,
       (select id from public.event_types where name = 'Received a vote') as event_type_id,
       v.castaway_id as other_castaway_id
from public.events v
join public.event_types vt on vt.id = v.event_type_id
where vt.name in ('Voted correctly', 'Voted incorrectly')
  and v.other_castaway_id is not null
  and not exists (                               -- safe to run again: a vote that already has its row is skipped
    select 1 from public.events r
    join public.event_types rt on rt.id = r.event_type_id
    where rt.name in ('Received a vote', 'Received a nullified vote')
      and r.season = v.season and r.episode = v.episode
      and r.castaway_id = v.other_castaway_id and r.other_castaway_id = v.castaway_id);

insert into public.events (season, episode, seq, castaway_id, event_type_id, other_castaway_id)
select season, episode, seq, castaway_id, event_type_id, other_castaway_id from received_backfill;

-- Renumber each episode that got rows 1..n in its current order. Through negative numbers first, so no row passes
-- through a seq another row still has.
with renumbered as (
  select e.id, row_number() over (partition by e.season, e.episode order by e.seq, e.id) as new_seq
  from public.events e
  where (e.season, e.episode) in (select distinct season, episode from received_backfill)
)
update public.events e set seq = -r.new_seq from renumbered r where e.id = r.id;

update public.events set seq = -seq where seq < 0;

commit;
