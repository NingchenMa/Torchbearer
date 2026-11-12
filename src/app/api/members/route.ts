// GET /api/members — the people at the signed-in user's company. Managers and admins only (it feeds Assign).
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listMembers } from "@/lib/members";
import { canAssign } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  if (!canAssign(u)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await listMembers(u.org));
}
