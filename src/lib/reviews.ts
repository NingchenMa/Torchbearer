// Server-only helpers for review batches: one per workflow and learner, found through reviews/index.json.
import type { User } from "./auth";
import { orgDb, safe } from "./db";
import { canReviewWorkflow } from "./roles";
import type { ReviewBatch, WorkflowSummary } from "./types";
import { WORKFLOW_INDEX } from "./workflows";

export const REVIEW_INDEX = "reviews/index.json";
export const reviewPath = (workflowId: string, learnerId: string) => `reviews/${safe(workflowId)}/${safe(learnerId)}.json`;

export interface ReviewKey {
  workflowId: string;
  learnerId: string;
}

/** Every batch this person may review: all of them for a manager or admin, only those on their own workflows for an employee. */
export async function reviewableBatches(u: User): Promise<ReviewBatch[]> {
  const db = orgDb(u.org);
  const keys = (await db.readJson<ReviewKey[]>(REVIEW_INDEX)) ?? [];
  const workflows = (await db.readJson<WorkflowSummary[]>(WORKFLOW_INDEX)) ?? [];
  const mine = keys.filter((k) => {
    const w = workflows.find((x) => x.id === k.workflowId);
    return w && canReviewWorkflow(u, w); // a deleted workflow's reviews are no longer listed
  });
  const batches = await Promise.all(mine.map((k) => db.readJson<ReviewBatch>(reviewPath(k.workflowId, k.learnerId))));
  return batches.filter((b): b is ReviewBatch => !!b && b.items.length > 0);
}
