// Server-only helpers for assignments (which employee trains on which workflow) and their progress.
// Stored per company: assignments/index.json, and progress/<workflow>/<learner id>.json for each person.
import type { User } from "./auth";
import { orgDb, safe } from "./db";
import type { Assignment, AssignmentView, StepMastery, WorkflowSummary } from "./types";
import { WORKFLOW_INDEX } from "./workflows";

export { isDone } from "./assignmentStatus";

export const ASSIGNMENTS = "assignments/index.json";
export const progressPath = (workflowId: string, learnerId: string) => `progress/${safe(workflowId)}/${safe(learnerId)}.json`;

export async function readAssignments(org: string): Promise<Assignment[]> {
  return (await orgDb(org).readJson<Assignment[]>(ASSIGNMENTS)) ?? [];
}

/** Has this person been given this workflow? (Training is only open to people who have.) */
export async function isAssignedTo(u: User, workflowId: string): Promise<boolean> {
  return (await readAssignments(u.org)).some((a) => a.workflowId === workflowId && a.learnerId === u.id);
}

/** Add workflow details and progress to assignments. A workflow that has since been deleted is dropped. */
export async function withProgress(org: string, list: Assignment[]): Promise<AssignmentView[]> {
  const db = orgDb(org);
  const index = (await db.readJson<WorkflowSummary[]>(WORKFLOW_INDEX)) ?? [];
  const views = await Promise.all(
    list.map(async (a) => {
      const w = index.find((x) => x.id === a.workflowId);
      if (!w) return null;
      const mastery = (await db.readJson<Record<string, StepMastery>>(progressPath(a.workflowId, a.learnerId))) ?? {};
      const marks = Object.values(mastery);
      return {
        ...a,
        workflowName: w.name,
        ...(w.trainedBy ? { trainedBy: w.trainedBy } : {}),
        stepCount: w.stepCount,
        learned: marks.filter((m) => m === "learned").length,
        relearn: marks.filter((m) => m === "relearn").length,
      } satisfies AssignmentView;
    }),
  );
  return views.filter((v): v is AssignmentView => v !== null);
}

