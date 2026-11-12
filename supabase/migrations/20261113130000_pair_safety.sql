-- Voting in pairs, one partner's safety covers the pair: when one plays an idol, is saved by Shot in the Dark or has
-- immunity, votes for the pair are nullified for both partners (episode-entry/cards.ts makes them that way now).
-- Before, only the partner marked safe got Received a nullified vote; the other got Received a vote. This fixes the
-- rows already saved, from the episode's stored Tribal card: a Received a vote row for someone at a Tribal voted in
-- pairs, from a voter at that Tribal, becomes Received a nullified vote when anyone in their pair is in the card's
-- `safe`. Only the event type changes, so the rows keep their place. Safe to re-run.
--
-- Event types by id (supabase/functions/_shared/event-types.ts): 37 Received a vote, 38 Received a nullified vote.
--
-- Applied with the GitHub integration on a push to main, or run it once in the SQL editor.

begin;

update public.events e set event_type_id = 38
from public.episode_cards ec, jsonb_array_elements(ec.cards) card
where e.event_type_id = 37
  and ec.season = e.season and ec.episode = e.episode
  and card->>'type' = 'tribal'
  and jsonb_typeof(card->'pairs') = 'object'
  -- the castaway and the voter were both at this Tribal (castaways at it are the pairs' keys)
  and card->'pairs' ? e.castaway_id::text
  and card->'pairs' ? e.other_castaway_id::text
  -- someone in the castaway's pair (them included) was safe
  and exists (
    select 1 from jsonb_each(card->'pairs') partner
    where partner.value = card->'pairs'->(e.castaway_id::text)
      and jsonb_typeof(card->'safe') = 'object'
      and card->'safe' ? partner.key);

commit;
