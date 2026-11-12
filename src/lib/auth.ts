// Server-only sign-in with Amazon Cognito (managed login, OAuth code flow).
// The browser holds two httpOnly cookies: the Cognito ID token, and the refresh token that
// renews it when it runs out (Cognito ID tokens last 1 hour by default), so a session lasts 12 hours.
// Every API route calls requireUser(), which verifies that token's signature and expiry
// and returns the user's company ("org"). All data is stored under that company's prefix.
// Invited users carry a company ID (custom:org, which users can't change). People who sign up on their own
// get a private workspace keyed to their Cognito user ID, so they never see another company's data.
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = "tb_session";
export const REFRESH_COOKIE = "tb_refresh";
export const SESSION_MAX_AGE = 12 * 60 * 60; // seconds; how long a sign-in lasts

/** One short-lived cookie per sign-in attempt, named after its state, so parallel attempts never overwrite each other. */
export const loginCookie = (state: string) => `tb_login_${state.slice(0, 16)}`;

export const cognito = {
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
  clientId: process.env.COGNITO_CLIENT_ID ?? "",
  clientSecret: process.env.COGNITO_CLIENT_SECRET ?? "",
  domain: process.env.COGNITO_DOMAIN ?? "", // e.g. https://torchbearer.auth.us-east-1.amazoncognito.com
};

export interface User {
  email: string;
  name: string;
  org: string;
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create<{ userPoolId: string; tokenUse: "id"; clientId: string }>> | null = null;
const getVerifier = () =>
  (verifier ??= CognitoJwtVerifier.create({ userPoolId: cognito.userPoolId, tokenUse: "id", clientId: cognito.clientId }));

/** Prefix of the private workspace given to people who signed up themselves. */
export const PERSONAL_ORG_PREFIX = "user-";

/** The signed-in user for an ID token, or null if it is missing, forged or expired. */
export async function userFromToken(token: string | undefined): Promise<User | null> {
  if (!token || !cognito.userPoolId) return null;
  try {
    const p = await getVerifier().verify(token);
    const org = typeof p["custom:org"] === "string" && p["custom:org"] ? p["custom:org"] : `${PERSONAL_ORG_PREFIX}${p.sub}`;
    const email = typeof p.email === "string" ? p.email : "";
    const name = typeof p.name === "string" && p.name ? p.name : email.split("@")[0];
    return { email, name, org };
  } catch {
    return null;
  }
}

/** A fresh ID token from a refresh token, or null if Cognito refuses it (revoked or expired). */
export async function refreshIdToken(refreshToken: string | undefined): Promise<string | null> {
  if (!refreshToken || !cognito.domain) return null;
  try {
    const res = await fetch(`${cognito.domain}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${cognito.clientId}:${cognito.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: cognito.clientId, refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const { id_token } = (await res.json()) as { id_token?: string };
    return id_token && (await userFromToken(id_token)) ? id_token : null;
  } catch {
    return null;
  }
}

/** Cookie settings shared by the session and refresh cookies. */
export const sessionCookieOptions = (secure: boolean, maxAge = SESSION_MAX_AGE) => ({
  httpOnly: true,
  secure,
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

/** For API routes: the user, or a 401 response to return as is. */
export async function requireUser(): Promise<User | NextResponse> {
  const user = await userFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return user ?? NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

/** The app's own address as the browser sees it (Amplify sits behind a proxy). */
export function appOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}
