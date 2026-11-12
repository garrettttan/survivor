-- A vote for a pair names the pair in its details by short names, as the site shows them ("Kilby & Kristin", not
-- "Danny Kilby & Kristin Flickinger"); episode-entry/cards.ts writes them that way now. This rewrites the details
-- already saved: each " & "-separated full name in a Voted correctly or incorrectly row's details becomes that
-- castaway's short name in the season. Safe to re-run: a name that's already short isn't a full name, so it's kept.
--
-- The short name is the rule in js/shared/util.js shortNames() (and its port, functions/_shared/short-names.ts):
-- the nickname if set, else the first name, else the first word of the name; with a last initial when that clashes
-- in the season ("John A."), and the full name if that still clashes.
--
-- Event types by id (supabase/functions/_shared/event-types.ts): 18 Voted correctly, 19 Voted incorrectly.
--
-- Applied with the GitHub integration on a push to main, or run it once in the SQL editor.

begin;

create temporary table season_short_names on commit drop as
with named as (                                  -- one row per full name in a season, like shortNames()'s map
  select distinct on (season, full_name) season, full_name,
         coalesce(nullif(nickname, ''), nullif(first_name, ''), split_part(trim(full_name), ' ', 1)) as base,
         last_name
  from (select season, coalesce(name, first_name || ' ' || last_name) as full_name, first_name, last_name, nickname
        from public.castaways) c
  order by season, full_name
),
parts as (
  select season, full_name, base,
         case when nullif(last_name, '') is not null then last_name
              when left(full_name, length(base)) = base then trim(substr(full_name, length(base) + 1))
              else trim(regexp_replace(trim(full_name), '^\S+', '')) end as rest
  from named
),
initialed as (
  select season, full_name, base,
         case when rest <> '' then base || ' ' || left(rest, 1) || '.' else base end as initialed
  from parts
)
select season, full_name,
       case when count(*) over (partition by season, base) = 1 then base
            when count(*) over (partition by season, initialed) = 1 then initialed
            else full_name end as short_name
from initialed;

update public.events e
set details = (
  select string_agg(coalesce(s.short_name, part.name), ' & ' order by part.ord)
  from unnest(string_to_array(e.details, ' & ')) with ordinality as part(name, ord)
  left join season_short_names s on s.season = e.season and s.full_name = part.name)
where e.event_type_id in (18, 19)
  and e.details like '% & %';

commit;
