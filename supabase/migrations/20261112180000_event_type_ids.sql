-- Code names event types by id (supabase/functions/_shared/event-types.ts), never by name, so a renamed event type
-- keeps working. The functions read events through these two views, which only had the type's name: add its id.
-- A view can only gain columns at the end, so event_type_id goes last. Safe to re-run.
--
-- events_readable was made in the dashboard, so this is the first migration that defines it; its body is the live
-- one, unchanged but for the new column.
--
-- Applied with the GitHub integration on a push to main, or run it once in the SQL editor.

begin;

create or replace view public.events_readable with (security_invoker = true) as
select d.id as draft_id,
       e.id as event_id,
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
       coalesce(lr.points, dr.points, 0::numeric) * coalesce(e.quantity, 1::numeric) as points,
       e.event_type_id
from public.events e
join public.drafts d on d.season = e.season
join public.castaways c on c.id = e.castaway_id
join public.event_types t on t.id = e.event_type_id
left join public.advantages a on a.id = e.advantage_id
left join public.tribes tr on tr.id = e.tribe_id
left join public.castaways oc on oc.id = e.other_castaway_id
left join public.scoring lr on lr.draft_id = d.id and lr.event_type_id = e.event_type_id
left join public.scoring dr on dr.draft_id is null and dr.season = e.season and dr.event_type_id = e.event_type_id;

create or replace view public.season_events_readable with (security_invoker = true) as
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
       coalesce(dr.points, 0) * coalesce(e.quantity, 1) as points,
       e.event_type_id
from public.events e
join public.castaways c on c.id = e.castaway_id
join public.event_types t on t.id = e.event_type_id
left join public.advantages a on a.id = e.advantage_id
left join public.tribes tr on tr.id = e.tribe_id
left join public.castaways oc on oc.id = e.other_castaway_id
left join public.scoring dr on dr.draft_id is null and dr.season = e.season and dr.event_type_id = e.event_type_id;

-- create or replace keeps a view's grants; these restate them (read-only for the site's roles)
revoke all on public.events_readable, public.season_events_readable from anon, authenticated;
grant select on public.events_readable, public.season_events_readable to anon, authenticated;

commit;
