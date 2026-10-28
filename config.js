const CONFIG = {
  // Supabase project URL and anon (publishable) key — Project Settings → API
  SUPABASE_URL: "https://zhwtgahrpnlywjaqmhjt.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_d_we7LacUwrG62LXVT9KZw_eWJl-iLI",
  // The season shown when the URL has no ?season=N. It's always there, so it loads without waiting for the
  // get-drafts list that fills the header picker. draftId is get-draft-data's draft_id.
  DEFAULT_SEASON: { season: 51, draftId: 1 },
};
