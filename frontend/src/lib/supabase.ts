import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// We use `createBrowserClient` (from @supabase/ssr) instead of the plain
// `createClient` so the session is persisted in cookies. The middleware
// (frontend/src/middleware.ts) reads those same cookies server-side to
// gate routes — using the default localStorage-only client meant the
// server didn't see the session, so verifyOtp would log the user in
// client-side but the next navigation would redirect back to /login.
export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createBrowserClient(supabaseUrl, supabaseAnonKey)
    : null;

/** Returns the current session's access token, or null if not authenticated. */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Returns the current user, or null if not authenticated. */
export async function getCurrentUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
