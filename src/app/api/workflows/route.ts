// GET /api/workflows — summaries of the workflows the signed-in user may see:
// every workflow at their company for a manager or admin, only the ones they recorded for an employee.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { orgDb } from "@/lib/db";
import { canSeeAllWorkflows, ownsWorkflow } from "@/lib/roles";
import type { WorkflowSummary } from "@/lib/types";
import { WORKFLOW_INDEX } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const index = (await orgDb(u.org).readJson<WorkflowSummary[]>(WORKFLOW_INDEX)) ?? [];
  return NextResponse.json(canSeeAllWorkflows(u) ? index : index.filter((w) => ownsWorkflow(u, w)));
}
