-- Shot in the Dark: a castaway at Tribal gives up their vote to roll for safety. The Tribal card records one row per
-- roll, for how it turned out, so each outcome scores exactly its own points. Neither scores in any season yet (no
-- scoring rows, so 0); add scoring rows to give them points.
--
-- Applied by the deployment (or supabase db push), not by hand, so the migration history records it.

begin;

-- event_types.id is generated; episode-entry finds event types by name
insert into public.event_types (category, name, description) values
  ('Voting', 'Played Shot in the Dark (not safe)',
   'Gave up their vote at Tribal Council to play Shot in the Dark, and it didn''t save them.'),
  ('Voting', 'Safe from Shot in the Dark',
   'Gave up their vote at Tribal Council to play Shot in the Dark, and it saved them: votes against them didn''t count.');

commit;
