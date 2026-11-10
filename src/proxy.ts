// Every page and API route needs a signed-in user, except the sign-in flow itself and /signed-out.
// Pages redirect to sign-in; API calls get 401. API routes also verify on their own (requireUser).
// When the ID token has run out (Cognito: 1 hour by default) but the refresh token is still valid,
// it is renewed here, so a recording session isn't cut off mid-task.
import { NextResponse, type NextRequest } from "next/server";
import { REFRESH_COOKIE, SESSION_COOKIE, appOrigin, refreshIdToken, sessionCookieOptions, userFromToken } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  const user = await userFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  const renewed = await refreshIdToken(req.cookies.get(REFRESH_COOKIE)?.value);
  if (renewed) {
    // Hand the new token to this request (the route's own requireUser reads it) and to the browser.
    req.cookies.set(SESSION_COOKIE, renewed);
    const res = NextResponse.next({ request: { headers: req.headers } });
    res.cookies.set(SESSION_COOKIE, renewed, sessionCookieOptions(appOrigin(req).startsWith("https://"), 60 * 60));
    return res;
  }

  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const login = new URL("/api/auth/login", req.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api/auth|signed-out|_next/static|_next/image|favicon.ico).*)"],
};
