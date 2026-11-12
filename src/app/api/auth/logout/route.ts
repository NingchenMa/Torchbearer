// GET /api/auth/logout — clears the session here and at Cognito, then shows /signed-out.
import { NextResponse } from "next/server";
import { appOrigin, cognito, REFRESH_COOKIE, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URLSearchParams({ client_id: cognito.clientId, logout_uri: `${appOrigin(req)}/signed-out` });
  const res = NextResponse.redirect(`${cognito.domain}/logout?${q}`);
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
