// GET  /api/assignments  managers and admins: every assignment at the company, with progress.
//                        employees: only the ones given to them.
// GET  /api/assignments?mine=1   only the ones given to the signed-in person, whatever their role (Training lists these).
// POST /api/assignments  { workflowId, learnerIds, due?, note? }: give a workflow to people. Managers and admins only.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ASSIGNMENTS, isDone, readAssignments, withProgress } from "@/lib/assignments";
import { orgDb } from "@/lib/db";
import { listMembers } from "@/lib/members";
import { canAssign } from "@/lib/roles";
import type { Assignment, WorkflowSummary } from "@/lib/types";
import { WORKFLOW_INDEX } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const all = await readAssignments(u.org);
  const everyone = canAssign(u) && !new URL(req.url).searchParams.get("mine");
  return NextResponse.json(await withProgress(u.org, everyone ? all : all.filter((a) => a.learnerId === u.id)));
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  if (!canAssign(u)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as { workflowId?: string; learnerIds?: string[]; due?: string; note?: string };
  const learnerIds = [...new Set(Array.isArray(body.learnerIds) ? body.learnerIds : [])];
  if (!body.workflowId || !learnerIds.length) return NextResponse.json({ error: "Choose a workflow and at least one person" }, { status: 400 });
  if (body.due && !/^\d{4}-\d{2}-\d{2}$/.test(body.due)) return NextResponse.json({ error: "Bad date" }, { status: 400 });

  const db = orgDb(u.org);
  const workflow = ((await db.readJson<WorkflowSummary[]>(WORKFLOW_INDEX)) ?? []).find((w) => w.id === body.workflowId);
  if (!workflow || !workflow.published) return NextResponse.json({ error: "Only approved workflows can be assigned" }, { status: 400 });

  const members = await listMembers(u.org);
  const existing = await readAssignments(u.org);
  const views = await withProgress(u.org, existing);
  const created: Assignment[] = [];
  const skipped: string[] = [];
  for (const id of learnerIds) {
    const person = members.find((m) => m.id === id);
    if (!person) return NextResponse.json({ error: "Unknown person" }, { status: 400 });
    // Someone who is still working on this workflow doesn't get it twice.
    if (views.some((v) => v.workflowId === workflow.id && v.learnerId === id && !isDone(v))) {
      skipped.push(person.name);
      continue;
    }
    created.push({
      id: crypto.randomUUID(),
      workflowId: workflow.id,
      learnerId: person.id,
      learnerName: person.name,
      assignedById: u.id,
      assignedByName: u.name,
      ...(body.due ? { due: body.due } : {}),
      ...(body.note?.trim() ? { note: body.note.trim().slice(0, 500) } : {}),
      createdAt: new Date().toISOString(),
    });
  }
  if (created.length) await db.writeJson(ASSIGNMENTS, [...created, ...existing]);
  return NextResponse.json({ created: created.length, skipped }, { status: 201 });
}
