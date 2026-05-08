import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Global route gate.
 *
 * Anything outside `PUBLIC_PATHS` requires a Supabase session. Missing or
 * invalid session → 302 to /login?next=<original-path>. Designed for the
 * Phase 1 email wall; Phase 2 will swap the gate from "signed in" to
 * "subscription_status === 'active'" by reading a custom JWT claim.
 *
 * The middleware uses `@supabase/ssr` to refresh + read the session
 * cookie without an Auth API hop on every request.
 */

// Routes that must remain reachable without auth. Anything matching
// (exact OR prefix-based on the per-entry `prefix` flag) skips the gate.
const PUBLIC_PATHS: { path: string; prefix?: boolean }[] = [
  { path: "/" },                  // landing
  { path: "/login" },             // sign-in / sign-up entry
  { path: "/auth/callback" },     // OTP redirect target
  { path: "/admin", prefix: true },  // admin uses X-Admin-Secret, not Supabase
  { path: "/_next", prefix: true },
  { path: "/api", prefix: true }, // Next.js internal route handlers
  { path: "/favicon.ico" },
];

function isPublic(pathname: string): boolean {
  for (const entry of PUBLIC_PATHS) {
    if (entry.prefix) {
      if (pathname === entry.path || pathname.startsWith(entry.path + "/")) {
        return true;
      }
    } else if (pathname === entry.path) {
      return true;
    }
  }
  // Static assets pass through (Next 14 doesn't always route them through
  // /_next/static, e.g. /og-image.png in /public/).
  if (/\.(png|jpe?g|gif|svg|ico|webp|avif|css|js|woff2?|ttf|map)$/i.test(pathname)) {
    return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Build a response we can mutate cookies on (Supabase ssr writes
  // refreshed-token cookies back via this object).
  const response = NextResponse.next({ request: { headers: request.headers } });

  let isSignedIn = false;
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    const { data } = await supabase.auth.getUser();
    isSignedIn = !!data.user;
  } catch {
    // Treat any cookie / network error as "not signed in" rather than
    // 500-ing the user. They'll land on /login and can retry.
    isSignedIn = false;
  }

  if (!isSignedIn) {
    const next = pathname + (search || "");
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

// Match every path except those Next.js manages internally. Per-route
// public allowlisting still happens inside `middleware()` above.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
