-- Coin flip at Tribal Council: a castaway flips a coin and calls it. Wrong, and they're out of the game (no vote that
-- night). Right, and they're safe at this Tribal, win a new idol, and the tribe votes as usual. The Tribal card
-- records one row for the flip: Won the coin flip carries the idol they won (so it gains an advantage), Lost the coin
-- flip ends their game. Neither scores in any season yet (no scoring rows, so 0); add scoring rows to give them points.
--
-- Fixed ids (supabase/functions/_shared/event-types.ts). The id sequence had already handed out 39, so these are 40
-- and 41; the sequence is then moved past them so a later generated id can't collide.
--
-- Applied by the deployment (or supabase db push), not by hand, so the migration history records it.

begin;

insert into public.event_types (id, category, name, description, changes_tribe, ends_game, advantage_effect)
overriding system value values
  (40, 'Voting', 'Won the coin flip',
   'Called the coin flip at Tribal Council correctly: safe at that Tribal, and won an idol.', false, false, 'gain'),
  (41, 'Voting', 'Lost the coin flip',
   'Called the coin flip at Tribal Council wrong, and went home.', false, true, null);

select setval('public.event_types_id_seq',
  greatest((select max(id) from public.event_types), (select last_value from public.event_types_id_seq)));

commit;
