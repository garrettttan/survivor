// Backend: admin sign-in with Supabase Auth. An admin is a user whose app_metadata.role is "admin"
// (set in SQL; users can't change their own app_metadata). This only decides what the page shows —
// admin writes must still be checked server-side (RLS or the edge function).

const authClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

function isAdmin(user) {
  return user?.app_metadata?.role === 'admin';
}

// The signed-in admin, or null (supabase-js keeps the session in localStorage and refreshes it)
async function getAdminUser() {
  const { data } = await authClient.auth.getSession();
  const user = data.session?.user;
  return isAdmin(user) ? user : null;
}

// Signs in and returns the user; a valid account without the admin role is signed straight back out
async function signIn(email, password) {
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (!isAdmin(data.user)) {
    await authClient.auth.signOut();
    throw new Error('This account is not an admin.');
  }
  return data.user;
}

async function signOut() {
  await authClient.auth.signOut();
}

// Calls fn(adminUserOrNull) whenever the session changes (sign in/out here or in another tab)
function onAdminChange(fn) {
  authClient.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    fn(isAdmin(user) ? user : null);
  });
}
