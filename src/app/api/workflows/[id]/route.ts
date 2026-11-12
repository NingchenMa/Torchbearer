// GET / PUT / DELETE /api/workflows/<id> — one trained workflow of the signed-in user's company
// (steps, the expert's reasons and rules, screenshots, approval state).
//   GET     a manager, an admin, or the person who recorded it
//   PUT     the same people; anyone may create a new workflow, which they then own
//   DELETE  managers and admins only
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { orgDb } from "@/lib/db";
import { ASSIGNMENTS, readAssignments } from "@/lib/assignments";
import { canDeleteWorkflow, canManageWorkflow } from "@/lib/roles";
import type { WorkflowRecord, WorkflowSummary } from "@/lib/types";
import { WORKFLOW_INDEX, openWorkflow, summaryOf, workflowPath } from "@/lib/workflows";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const { id } = await params;
  const record = await openWorkflow(u, id);
  return record instanceof NextResponse ? record : NextResponse.json(record);
}

export async function PUT(req: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const db = orgDb(u.org);
  const { id } = await params;
  const body = (await req.json()) as WorkflowRecord;
  if (!body?.map?.steps || body.id !== id) return NextResponse.json({ error: "Bad workflow" }, { status: 400 });

  // A workflow that already exists can only be changed by someone allowed to manage it.
  const existing = await db.readJson<WorkflowRecord>(workflowPath(id));
  if (existing && !canManageWorkflow(u, existing)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The owner is decided here, never taken from the browser: the recorder on first save, unchanged after that.
  const { ownerId: _ignored, ...rest } = body;
  void _ignored;
  const ownerId = existing ? existing.ownerId : u.id;
  const record: WorkflowRecord = { ...rest, ...(ownerId ? { ownerId } : {}) };
  await db.writeJson(workflowPath(id), record);

  const index = (await db.readJson<WorkflowSummary[]>(WORKFLOW_INDEX)) ?? [];
  const before = index.find((w) => w.id === id);
  await db.writeJson(WORKFLOW_INDEX, [summaryOf(record, before?.trainedBy ?? u.name), ...index.filter((w) => w.id !== id)]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  if (!canDeleteWorkflow(u)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = orgDb(u.org);
  const { id } = await params;
  await db.remove(workflowPath(id));
  const index = (await db.readJson<WorkflowSummary[]>(WORKFLOW_INDEX)) ?? [];
  await db.writeJson(WORKFLOW_INDEX, index.filter((w) => w.id !== id));
  // Nobody is left training on a workflow that no longer exists.
  const assignments = await readAssignments(u.org);
  if (assignments.some((a) => a.workflowId === id)) await db.writeJson(ASSIGNMENTS, assignments.filter((a) => a.workflowId !== id));
  return NextResponse.json({ ok: true });
}
