// Where an assignment stands. Pure, so the server and the pages agree.
import type { AssignmentView } from "./types";

export type AssignmentState = "done" | "late" | "relearn" | "progress" | "none";

export const STATE_LABEL: Record<AssignmentState, string> = {
  done: "Done",
  late: "Overdue",
  relearn: "Needs relearn",
  progress: "In progress",
  none: "Not started",
};

/** Lower comes first when sorting: what needs attention at the top. */
export const STATE_RANK: Record<AssignmentState, number> = { late: 0, relearn: 1, progress: 2, none: 3, done: 4 };

type Progress = Pick<AssignmentView, "learned" | "relearn" | "stepCount" | "due">;

export const isDone = (a: Pick<AssignmentView, "learned" | "stepCount">) => a.stepCount > 0 && a.learned >= a.stepCount;

/** `today` is "YYYY-MM-DD". */
export function stateOf(a: Progress, today: string): AssignmentState {
  if (isDone(a)) return "done";
  if (a.due && a.due < today) return "late";
  if (a.relearn) return "relearn";
  return a.learned ? "progress" : "none";
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** "Due in 6 days", "2 days overdue", "No date". */
export function dueText(due: string | undefined, today: string): string {
  if (!due) return "No date";
  const d = Math.round((Date.parse(due) - Date.parse(today)) / 864e5);
  return d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due in ${d} days`;
}
