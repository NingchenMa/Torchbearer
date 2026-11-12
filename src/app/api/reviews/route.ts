// Review batches: what the new hire did that might differ from the approved way.
//   GET  /api/reviews                       the batches this person may review (managers and admins: all;
//                                           employees: practice on workflows they recorded)
//   GET  /api/reviews?mine=1&workflow=<id>  the signed-in person's own batch for a workflow (Training reads it on start)
//   POST /api/reviews { workflowId, items } the person training adds the items Training flagged. They only ever
//                                           write their own batch, and never decisions.
//   PUT  /api/reviews { workflowId, learnerId, decisions, submitted? }
//                                           a manager, an admin or the workflow's recorder decides items.
//                                           Submitting settles each step: fine = learned, needs correction = relearn.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isAssignedTo, progressPath } from "@/lib/assignments";
import { orgDb } from "@/lib/db";
import { REVIEW_INDEX, reviewPath, reviewableBatches, type ReviewKey } from "@/lib/reviews";
import { canReviewWorkflow } from "@/lib/roles";
import type { ReviewBatch, ReviewItem, StepMastery, WorkflowSummary } from "@/lib/types";
import { WORKFLOW_INDEX } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const q = new URL(req.url).searchParams;
  if (q.get("mine")) {
    const batch = await orgDb(u.org).readJson<ReviewBatch>(reviewPath(q.get("workflow") ?? "none", u.id));
    return NextResponse.json(batch);
  }
  return NextResponse.json(await reviewableBatches(u));
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const { workflowId, items } = (await req.json()) as { workflowId?: string; items?: ReviewItem[] };
  if (!workflowId || !Array.isArray(items)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (!(await isAssignedTo(u, workflowId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = orgDb(u.org);
  const workflow = ((await db.readJson<WorkflowSummary[]>(WORKFLOW_INDEX)) ?? []).find((w) => w.id === workflowId);
  if (!workflow) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const path = reviewPath(workflowId, u.id);
  const before = await db.readJson<ReviewBatch>(path);
  // A submitted batch is finished; practice after that starts a new one.
  const kept = before && !before.submitted ? before.items : [];
  const known = new Map(kept.map((i) => [i.id, i]));
  const merged = items.map((i) => {
    const old = known.get(i.id);
    // Whatever the supervisor already decided stays; the person training can't set a decision.
    const { decision: _d, comment: _c, ...fresh } = i;
    void _d;
    void _c;
    return old ? { ...fresh, ...(old.decision ? { decision: old.decision } : {}), ...(old.comment ? { comment: old.comment } : {}) } : { ...fresh, workflowId };
  });
  const batch: ReviewBatch = { learner: u.name, learnerId: u.id, workflowId, workflowName: workflow.name, items: merged, submitted: false };
  await db.writeJson(path, batch);

  const keys = (await db.readJson<ReviewKey[]>(REVIEW_INDEX)) ?? [];
  if (!keys.some((k) => k.workflowId === workflowId && k.learnerId === u.id)) await db.writeJson(REVIEW_INDEX, [...keys, { workflowId, learnerId: u.id }]);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const body = (await req.json()) as {
    workflowId?: string;
    learnerId?: string;
    decisions?: { id: string; decision?: "fine" | "needs_correction"; comment?: string }[];
    submitted?: boolean;
  };
  if (!body.workflowId || !body.learnerId || !Array.isArray(body.decisions)) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const db = orgDb(u.org);
  const workflow = ((await db.readJson<WorkflowSummary[]>(WORKFLOW_INDEX)) ?? []).find((w) => w.id === body.workflowId);
  // Same answer whether the workflow is missing or just not theirs.
  if (!workflow || !canReviewWorkflow(u, workflow)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const path = reviewPath(body.workflowId, body.learnerId);
  const batch = await db.readJson<ReviewBatch>(path);
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (batch.submitted) return NextResponse.json({ error: "Already submitted" }, { status: 409 });

  const byId = new Map(body.decisions.map((d) => [d.id, d]));
  const items = batch.items.map((i) => {
    const d = byId.get(i.id);
    if (!d) return i;
    const next: ReviewItem = { ...i };
    if (d.decision === "fine" || d.decision === "needs_correction") next.decision = d.decision;
    if (typeof d.comment === "string") next.comment = d.comment.trim().slice(0, 500);
    return next;
  });
  if (body.submitted && items.some((i) => !i.decision)) return NextResponse.json({ error: "Decide every item first" }, { status: 400 });

  await db.writeJson(path, { ...batch, items, submitted: !!body.submitted });
  if (body.submitted) {
    // The supervisor's decision settles the step: fine = learned, needs correction = relearn.
    const marks: Record<string, StepMastery> = {};
    for (const i of items) if (i.stepId && i.decision) marks[i.stepId] = i.decision === "fine" ? "learned" : "relearn";
    const p = progressPath(body.workflowId, body.learnerId);
    await db.writeJson(p, { ...((await db.readJson<Record<string, StepMastery>>(p)) ?? {}), ...marks });
  }
  return NextResponse.json({ ok: true });
}
