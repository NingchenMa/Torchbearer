// localStorage persistence for the captured session and the generated Work Map.
import { sampleWorkMap, capturedSessionEnabled } from "@/data/sampleWorkMap";
import type { ReviewBatch, ReviewItem, ScreenEvent, StepMastery, TranscriptLine, WorkMap, WorkflowRecord, WorkflowSummary } from "./types";
export type { ReviewBatch } from "./types";

const SESSION_KEY = "apprentice.session";
const WORKMAP_KEY = "apprentice.workmap";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // e.g. storage full
  }
}

export interface CapturedSession {
  events: ScreenEvent[];
  transcript: TranscriptLine[];
}

const seconds = (t: string) => {
  const [m, s] = t.split(":").map(Number);
  return m * 60 + s;
};

/** Give each step the screenshot taken closest to its screen moment. */
export function attachScreenshots(map: WorkMap, shots: Record<string, string>): WorkMap {
  const times = Object.keys(shots);
  if (!times.length) return map;
  return {
    ...map,
    steps: map.steps.map((step) => {
      const t = seconds(step.time);
      const best = times.reduce((a, b) => (Math.abs(seconds(b) - t) < Math.abs(seconds(a) - t) ? b : a));
      return { ...step, screenshot: shots[best] };
    }),
  };
}

/** Link each step to the Ledgerline document touched closest to its screen moment (within 90 s). */
export function attachDocs(map: WorkMap, events: ScreenEvent[]): WorkMap {
  const withDocs = events.filter((e) => e.docId);
  if (!withDocs.length) return map;
  return {
    ...map,
    steps: map.steps.map((step) => {
      if (step.docId) return step;
      const t = seconds(step.time);
      const best = withDocs.reduce((a, b) => (Math.abs(seconds(b.time) - t) < Math.abs(seconds(a.time) - t) ? b : a));
      return Math.abs(seconds(best.time) - t) <= 90 ? { ...step, docId: best.docId } : step;
    }),
  };
}

export const loadSession = () => read<CapturedSession>(SESSION_KEY);
export const saveSession = (s: CapturedSession) => write(SESSION_KEY, s);
export const loadWorkMap = () => read<WorkMap>(WORKMAP_KEY);
export const saveWorkMap = (m: WorkMap) => write(WORKMAP_KEY, m);

/** The map Teaching mode uses: the expert's own once he published it, else the prepared one. */
export function loadTeachingMap(): WorkMap {
  const map = loadWorkMap();
  return capturedSessionEnabled && map?.published ? map : sampleWorkMap;
}

// ---------- Database (server: private Vercel Blob store, see src/lib/db.ts) ----------
// Trained workflows, learner progress and supervisor reviews live in the database, so every
// device sees the same trained Torchbearer. These helpers call the app's own /api routes.

const json = { "Content-Type": "application/json" };

/** The prepared example: always available, already approved (not stored in the database). */
export const EXAMPLE_ID = "example";
export const exampleWorkflow = (): WorkflowRecord => ({
  id: EXAMPLE_ID,
  name: "Meal expense report (prepared example)",
  createdAt: "2026-10-03T09:00:00Z",
  map: { ...sampleWorkMap, published: true },
});
export const exampleSummary = (): WorkflowSummary => {
  const w = exampleWorkflow();
  return { id: w.id, name: w.name, createdAt: w.createdAt, published: true, stepCount: w.map.steps.length };
};

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  try {
    const r = await fetch("/api/workflows", { cache: "no-store" });
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

export async function getWorkflow(id: string | null | undefined): Promise<WorkflowRecord | null> {
  if (!id) return null;
  if (id === EXAMPLE_ID) return exampleWorkflow();
  try {
    const r = await fetch(`/api/workflows/${encodeURIComponent(id)}`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function saveWorkflow(record: WorkflowRecord): Promise<boolean> {
  if (record.id === EXAMPLE_ID) return true;
  try {
    const r = await fetch(`/api/workflows/${encodeURIComponent(record.id)}`, { method: "PUT", headers: json, body: JSON.stringify(record) });
    return r.ok;
  } catch {
    return false;
  }
}

// Progress belongs to the signed-in person; the server knows who that is.
const progressUrl = (workflowId: string) => `/api/progress?workflow=${encodeURIComponent(workflowId)}`;

export async function loadMastery(workflowId: string): Promise<Record<string, StepMastery>> {
  try {
    const r = await fetch(progressUrl(workflowId), { cache: "no-store" });
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}

export async function saveMastery(workflowId: string, patch: Record<string, StepMastery>) {
  try {
    await fetch(progressUrl(workflowId), { method: "PUT", headers: json, body: JSON.stringify(patch) });
  } catch {
    /* best effort */
  }
}

/** A workflow the signed-in person was assigned, to practise on (managers and recorders use getWorkflow). */
export async function getTrainingWorkflow(id: string | null | undefined): Promise<WorkflowRecord | null> {
  if (!id) return null;
  try {
    const r = await fetch(`/api/workflows/${encodeURIComponent(id)}/train`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Training: this person's own review items for a workflow, so earlier sessions' unreviewed ones are kept. */
export async function loadMyReviews(workflowId: string): Promise<ReviewBatch | null> {
  try {
    const r = await fetch(`/api/reviews?mine=1&workflow=${encodeURIComponent(workflowId)}`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function saveMyReviews(workflowId: string, items: ReviewItem[]) {
  try {
    await fetch("/api/reviews", { method: "POST", headers: json, body: JSON.stringify({ workflowId, items }) });
  } catch {
    /* best effort */
  }
}

/** Reviews: the batches the signed-in person may review. */
export async function loadReviewBatches(): Promise<ReviewBatch[]> {
  try {
    const r = await fetch("/api/reviews", { cache: "no-store" });
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

export async function saveReviewDecisions(batch: ReviewBatch, submitted = false): Promise<boolean> {
  try {
    const r = await fetch("/api/reviews", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({
        workflowId: batch.workflowId,
        learnerId: batch.learnerId,
        decisions: batch.items.map((i) => ({ id: i.id, decision: i.decision, comment: i.comment })),
        submitted,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
