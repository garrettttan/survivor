-- Received votes come after all of their Tribal's votes, in order of the voter's name (episode-entry/cards.ts makes
-- them that way now). 20261112120000_received_votes put each one right after its vote, so this moves the rows already
-- saved: each goes just before the row for whoever went home at its Tribal (the first Voted out or rock draw after
-- it), ordered by the voter's name as cards.ts sorts them (lower(name) COLLATE "C", then id), and each episode they
-- are in is renumbered 1..n. Safe to re-run: rows already in this order stay where they are.
--
-- Event types by id (supabase/functions/_shared/event-types.ts): 21 Voted out, 26 Went home on rocks,
-- 37 Received a vote, 38 Received a nullified vote.
--
-- Applied with the GitHub integration on a push to main, or run it once in the SQL editor.

begin;

-- Each received vote's place: just before its Tribal's boot row, by voter name (and, for a pair's two rows from one
-- voter, by castaway id, as the card makes them)
with received as (
  select r.id,
         coalesce((select min(b.seq) from public.events b
                   where b.event_type_id in (21, 26)
                     and b.season = r.season and b.episode = r.episode and b.seq > r.seq), r.seq + 1) as boot_seq,
         lower(coalesce(v.name, v.first_name || ' ' || v.last_name)) as voter_name,
         r.other_castaway_id as voter_id,
         r.castaway_id,
         r.season, r.episode
  from public.events r
  join public.castaways v on v.id = r.other_castaway_id
  where r.event_type_id in (37, 38)
),
placed as (
  select id, boot_seq - 0.5 + 0.0001 * row_number() over (
           partition by season, episode, boot_seq order by voter_name collate "C", voter_id, castaway_id) as seq
  from received
)
update public.events e set seq = p.seq from placed p where e.id = p.id;

-- Renumber each episode with received votes 1..n in its new order. Through negative numbers first, so no row passes
-- through a seq another row still has.
with renumbered as (
  select e.id, row_number() over (partition by e.season, e.episode order by e.seq, e.id) as new_seq
  from public.events e
  where (e.season, e.episode) in (select distinct season, episode from public.events where event_type_id in (37, 38))
)
update public.events e set seq = -r.new_seq from renumbered r where e.id = r.id;

update public.events set seq = -seq where seq < 0;

commit;
