// get-drafts: every draft and its season, for the site's season picker. Public (called with the publishable key).
//
// GET → { data: [{ id, season }] }, oldest season first

// From npm rather than jsr.io: fetching from jsr.io kept timing out while Supabase bundled the function
import { withSupabase } from "npm:@supabase/server@1";

export default {
  fetch: withSupabase({ auth: "none" }, async (_req, { supabase }) => {
    const { data, error } = await supabase.from("drafts").select("id, season").order("season");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  }),
};
