// GET / PUT /api/progress?workflow=<id> — learned / relearn per step for the signed-in person, merged on save.
// GET ?workflow=<id>&learner=<user id> lets a manager or admin read someone else's progress.
// Progress is written only by the person themselves (as they practise) and, when a review is submitted, by the review route.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isAssignedTo, progressPath } from "@/lib/assignments";
import { orgDb } from "@/lib/db";
import { canAssign } from "@/lib/roles";
import type { StepMastery } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const q = new URL(req.url).searchParams;
  const learner = q.get("learner") ?? u.id;
  if (learner !== u.id && !canAssign(u)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json((await orgDb(u.org).readJson<Record<string, StepMastery>>(progressPath(q.get("workflow") ?? "none", learner))) ?? {});
}

export async function PUT(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const workflow = new URL(req.url).searchParams.get("workflow") ?? "none";
  if (!(await isAssignedTo(u, workflow))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = orgDb(u.org);
  const patch = (await req.json()) as Record<string, StepMastery>;
  const p = progressPath(workflow, u.id);
  const merged = { ...((await db.readJson<Record<string, StepMastery>>(p)) ?? {}), ...patch };
  await db.writeJson(p, merged);
  return NextResponse.json(merged);
}
