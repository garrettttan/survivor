-- Shot in the Dark: a castaway at Tribal gives up their vote to roll for safety. The Tribal card records one row per
-- roll, for how it turned out, so each outcome scores exactly its own points. Neither scores in any season yet (no
-- scoring rows, so 0); add scoring rows to give them points.
--
-- Run it once in the SQL editor.

begin;

insert into public.event_types (id, category, name, description) values
  (33, 'Voting', 'Played Shot in the Dark (not safe)',
   'Gave up their vote at Tribal Council to play Shot in the Dark, and it didn''t save them.'),
  (34, 'Voting', 'Safe from Shot in the Dark',
   'Gave up their vote at Tribal Council to play Shot in the Dark, and it saved them: votes against them didn''t count.');

commit;
