-- Let anyone read episode_cards, like events, so the public get-episode-recap function can show an episode as the
-- cards it was entered from (which ad-hoc team won a challenge, who was safe at Tribal and why, who sat out). The
-- cards hold nothing the events rows don't already make public. Writes stay admin-only.
--
-- Applied with the GitHub integration on a push to main, or run it once in the SQL editor. Then run
-- supabase/tests/episode_cards_test.sql, which rolls everything back.

begin;

grant select on public.episode_cards to anon;

drop policy if exists "Admins can read" on public.episode_cards;
create policy "Anyone can read" on public.episode_cards for select to anon, authenticated
  using (true);

commit;
