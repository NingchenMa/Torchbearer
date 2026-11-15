// PATCH / DELETE /api/assignments/<id> — change the finish-by date or note, or take the assignment back.
// Managers and admins only.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ASSIGNMENTS, readAssignments } from "@/lib/assignments";
import { orgDb } from "@/lib/db";
import { canAssign } from "@/lib/roles";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  if (!canAssign(u)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const patch = (await req.json()) as { due?: string | null; note?: string | null };
  if (patch.due && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) return NextResponse.json({ error: "Bad date" }, { status: 400 });
  const all = await readAssignments(u.org);
  const found = all.find((a) => a.id === id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const next = { ...found };
  if ("due" in patch) {
    if (patch.due) next.due = patch.due;
    else delete next.due;
  }
  if ("note" in patch) {
    if (patch.note?.trim()) next.note = patch.note.trim().slice(0, 500);
    else delete next.note;
  }
  await orgDb(u.org).writeJson(ASSIGNMENTS, all.map((a) => (a.id === id ? next : a)));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  if (!canAssign(u)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const all = await readAssignments(u.org);
  if (!all.some((a) => a.id === id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await orgDb(u.org).writeJson(ASSIGNMENTS, all.filter((a) => a.id !== id));
  return NextResponse.json({ ok: true });
}
