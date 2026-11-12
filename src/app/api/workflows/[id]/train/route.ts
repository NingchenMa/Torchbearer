// GET /api/workflows/<id>/train — the workflow for an employee to practise, if it was assigned to them.
// Only approved workflows teach. Open to the assigned person alone; managers and recorders use the normal route.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isAssignedTo } from "@/lib/assignments";
import { orgDb } from "@/lib/db";
import type { WorkflowRecord } from "@/lib/types";
import { workflowPath } from "@/lib/workflows";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const { id } = await params;
  if (!(await isAssignedTo(u, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const record = await orgDb(u.org).readJson<WorkflowRecord>(workflowPath(id));
  if (!record || !record.map.published) return NextResponse.json({ error: "Not available" }, { status: 404 });
  return NextResponse.json(record);
}
