// GET /api/auth/callback?code&state — Cognito sends the browser back here after sign-in.
// Swaps the one-time code for tokens (server to server, with the client secret), verifies the ID token,
// and stores it (plus the refresh token that renews it) in httpOnly cookies.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appOrigin, cognito, loginCookie, REFRESH_COOKIE, SESSION_COOKIE, sessionCookieOptions, userFromToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = appOrigin(req);
  const fail = (why: string) => NextResponse.redirect(`${origin}/signed-out?error=${encodeURIComponent(why)}`);

  const jar = await cookies();
  const state = url.searchParams.get("state") ?? "";
  let login: { state: string; verifier: string; next: string } | null = null;
  try {
    login = state ? JSON.parse(jar.get(loginCookie(state))?.value ?? "null") : null;
  } catch {}
  const code = url.searchParams.get("code");
  if (!login || !code || state !== login.state) return fail("Sign-in expired. Please try again.");

  const tokenRes = await fetch(`${cognito.domain}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${cognito.clientId}:${cognito.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/api/auth/callback`,
      code_verifier: login.verifier,
    }),
    cache: "no-store",
  });
  if (!tokenRes.ok) return fail("Sign-in failed. Please try again.");
  const { id_token, refresh_token } = (await tokenRes.json()) as { id_token?: string; refresh_token?: string };
  const user = await userFromToken(id_token);
  if (!user) return fail("Sign-in failed. Please try again.");

  const res = NextResponse.redirect(`${origin}${login.next}`);
  const secure = origin.startsWith("https://");
  res.cookies.set(SESSION_COOKIE, id_token!, sessionCookieOptions(secure));
  // The sign-in still ends after 12 hours: the refresh cookie expires then, even if Cognito would allow longer.
  if (refresh_token) res.cookies.set(REFRESH_COOKIE, refresh_token, sessionCookieOptions(secure));
  res.cookies.set(loginCookie(state), "", { path: "/api/auth", maxAge: 0 });
  return res;
}
