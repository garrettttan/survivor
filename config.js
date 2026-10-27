const CONFIG = {
  // Supabase project URL and anon (publishable) key — Project Settings → API
  SUPABASE_URL: "https://zhwtgahrpnlywjaqmhjt.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_d_we7LacUwrG62LXVT9KZw_eWJl-iLI",
  // Seasons in the header picker; the first is shown by default, others via ?season=N.
  // draftId is get-draft-data's draft_id; a missing logo falls back to the title as text.
  SEASONS: [
    { season: 51, draftId: 1, title: "Season 51", logo: "logos/51.png" },
    { season: 50, draftId: 2, title: "Season 50", logo: "logos/50.png" },
    { season: 49, draftId: 5, title: "Season 49", logo: "logos/49.png" },
    { season: 48, draftId: 4, title: "Season 48", logo: "logos/48.png" },
    { season: 47, draftId: 3, title: "Season 47", logo: "logos/47.webp" },
  ],
};
