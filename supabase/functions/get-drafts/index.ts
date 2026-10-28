// From npm rather than jsr.io: fetching from jsr.io kept timing out while Supabase bundled the function
import { withSupabase } from "npm:@supabase/server@1";

// This endpoint uses 'user' access, credentials is required.
export default {
  fetch: withSupabase({ auth: "none" }, async (_req, { supabase }) => {
    const { data, error } = await supabase.from("drafts").select("id, season").order("season");

    if (error) {
      return Response.json(
        { error: error.message },
        { status: 500 },
      );
    }

    return Response.json({ data });
  }),
};
