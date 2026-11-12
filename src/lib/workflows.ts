// Server-only helpers for reading a workflow with the access rules applied (rules in roles.ts).
import { NextResponse } from "next/server";
import type { User } from "./auth";
import { orgDb, safe } from "./db";
import { canManageWorkflow, isManager } from "./roles";
import type { WorkflowRecord, WorkflowSummary } from "./types";

export const WORKFLOW_INDEX = "workflows/index.json";
export const workflowPath = (id: string) => `workflows/${safe(id)}.json`;

export const summaryOf = (w: WorkflowRecord, trainedBy?: string): WorkflowSummary => ({
  id: w.id,
  name: w.name,
  createdAt: w.createdAt,
  published: !!w.map.published,
  stepCount: w.map.steps.length,
  ...(trainedBy ? { trainedBy } : {}),
  ...(w.ownerId ? { ownerId: w.ownerId } : {}),
});

/**
 * The workflow, if this person may open, edit or review it (a manager, admin, or its recorder);
 * otherwise the response to return as is. An employee gets 403 for a workflow that doesn't exist too,
 * so the answer never reveals which workflows exist.
 */
export async function openWorkflow(u: User, id: string): Promise<WorkflowRecord | NextResponse> {
  const record = await orgDb(u.org).readJson<WorkflowRecord>(workflowPath(id));
  if (!record) return NextResponse.json({ error: "Not found" }, { status: isManager(u.role) ? 404 : 403 });
  if (!canManageWorkflow(u, record)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return record;
}
