// GET /api/auth/me — who is signed in (id, name, email, company, role). Pages use the role to decide what to show;
// every API route still enforces it on the server.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await requireUser();
  return u instanceof NextResponse ? u : NextResponse.json(u);
}
