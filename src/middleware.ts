import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Session-refresh middleware (issue #9 acceptance criteria F,
// project-structure.md §4). Builds its own `createServerClient` from the
// request/response cookies rather than reusing lib/supabase/server.ts's
// helper: middleware needs to read *and* write cookies onto the same
// outgoing response, which next/headers' `cookies()` (what server.ts is
// built on) isn't set up for -- this is the one place a distinct client is
// warranted, per server.ts's own comment about middleware. Follows the
// standard @supabase/ssr middleware pattern documented for Next.js.

// Reachable with no session -- everything else requires one.
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth/confirm",
]);

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write to both the incoming request (so this same middleware
          // invocation and the page it forwards to see the refreshed
          // cookies) and a fresh response built from that mutated request
          // (so the refreshed cookies actually reach the browser).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run any code between createServerClient and this call: it
  // refreshes the session token (via the refresh token, if the access
  // token has expired) and is what actually keeps a user logged in across
  // a hard reload (acceptance criteria F's last bullet).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.has(request.nextUrl.pathname);
  // API Route Handlers (issue #29's /api/export, the project's first) own
  // their own auth response (401 JSON, not a redirect) -- an HTML redirect
  // to /login here would otherwise intercept every unauthenticated request
  // before the route handler ever runs, which is wrong for a fetch/download
  // caller expecting a real status code rather than a 200 login page.
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  if (!user && !isPublic && !isApiRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Standard Supabase SSR middleware exclusions: static assets, image
  // optimization, and the favicon never need a session-refresh pass.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
