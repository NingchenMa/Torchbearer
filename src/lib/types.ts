// Shared data formats. Source of truth: docs/formats.md — change both together.
// The work app is the Ledgerline expense tool (public/ledgerline.html).
import type { Role } from "./roles";

/** What the Ledgerline mock sends with save / form events (its `snapshot()`). */
export interface ExpenseSnapshot {
  id: string;
  expense_type: string;
  transaction_date: string;
  spent: number;
  currency: string;
  location: string | null;
  business_purpose: string;
  meal_amount: number;
  drink_amount: number;
  tip_amount: number;
  restaurant_name: string;
  restaurant_address: string;
  type_of_meal: "Take Away" | "Eat In" | null;
  projects: { code: string; name: string; pct: number }[];
  guests: { name: string; title: string; kind: string; org: string; pct: number; amount: number }[];
  guest_count: number;
  amount_per_person: number | null;
  attachments: { id: string; file?: string; kind?: string; facts?: DocFacts | null; missing?: boolean }[];
  comments: { by: string; at: string; text: string }[];
  returned: boolean;
}

/** Facts the mock extracts from an attached document (receipt, invoice, email). */
export interface DocFacts {
  kind: "invoice" | "order_confirmation" | "approval_email" | "correction_email" | "upload";
  supplier?: string;
  consumption?: string | null; // "im Haus" (eat in) | "außer Haus" (take away)
  total_paid?: number;
  tip?: number;
  is_tax_invoice?: boolean;
  addressed_to?: string | null;
  issued_by?: string | null; // set when a platform (e.g. Bitebox) issues the invoice for the restaurant
  platform?: string;
  subject?: string;
}

export interface ScreenEvent {
  time: string; // "mm:ss" since session start
  invoiceId: string; // id of the record on screen (expense id or report number)
  type: string; // Ledgerline event type, e.g. "field_changed", "guest_added", "save_blocked"
  field?: string;
  from?: string;
  to?: string;
  description: string; // human-readable, fed to the agent
  source: "dom" | "vision";
  docId?: string; // Ledgerline document involved (receipt, invoice, approval email)
  data?: unknown; // raw payload from the app (e.g. ExpenseSnapshot)
}

export interface TranscriptLine {
  time: string; // "mm:ss"
  speaker: "expert" | "agent";
  text: string;
}

export interface WorkMapStep {
  id: string;
  order: number;
  title: string;
  short?: string; // 2–4 word label for the Work Map timeline
  time: string; // screen moment, "mm:ss"
  screenshot?: string; // data URL or /public path
  docId?: string; // Ledgerline document for this step; /map opens it via open_document
  review?: "ok" | "wrong"; // the expert's check of this observation in Mapping
  correction?: string; // what really happened, when the expert marked it wrong
  decision: string; // "" for routine steps
  reason: string;
  expertQuote: string;
  guardrails: string[];
  process?: StepProcess; // filled in by the process map (/process)
}

/** Process map: how one step fits the whole process (tools, data in and out, links to other steps). */
export interface StepProcess {
  tool: string; // the app, system or site used, e.g. "Ledgerline · expense form"
  inputs: { name: string; source: string }[]; // data or documents the step needs, and where each comes from
  outputs: string[]; // what the step produces or changes
  feedsInto: string[]; // ids of later steps that use this step's outputs
  decision: string; // the judgment call made here and why; "" for routine steps
  unknown: string[]; // what couldn't be told from the recording: ask the expert
}

/** One step of the workflow the vision LLM writes live from screenshots (+ the user's spoken answers). */
export interface ObservedStep {
  id: string;
  title: string; // short imperative, e.g. "Attach the supervisor's approval screenshot"
  detail: string; // what was seen on screen
  why: string | null; // the user's reason, only from a spoken answer
  rule: string | null; // a limit/exception/stop condition, only from a spoken answer
  time: string; // "mm:ss" when it happened
}

/** Teaching: something the new hire did that might differ from the expert; waits for the supervisor. */
export interface ReviewItem {
  id: string;
  time: string;
  screenshot?: string;
  observed: string; // what the new hire did
  expected: string; // the expert's step it was compared with
  note: string; // the Apprentice's gentle note
  decision?: "fine" | "needs_correction";
  comment?: string;
  workflowId?: string;
  stepId?: string;
}

/** A recorded workflow, saved under the name the expert gave it. */
export interface WorkflowRecord {
  id: string;
  name: string;
  createdAt: string;
  map: WorkMap;
  /** Cognito user ID of whoever recorded it. Set by the server on first save, never by the browser. */
  ownerId?: string;
}

/** What the workflow list shows (the full record is loaded on demand). */
export interface WorkflowSummary {
  id: string;
  name: string;
  createdAt: string;
  published: boolean;
  stepCount: number;
  /** Who recorded it (the signed-in expert's name), for display. */
  trainedBy?: string;
  /** Cognito user ID of the recorder; access is decided by this, not the name. Missing on workflows saved before owners existed. */
  ownerId?: string;
}

/** Someone in the company: kept so managers can pick people to assign work to. */
export interface Member {
  id: string; // Cognito user ID
  name: string;
  email: string;
  role: Role;
}

/** A workflow a manager gave to an employee to train on. Stored in assignments/index.json. */
export interface Assignment {
  id: string;
  workflowId: string;
  learnerId: string; // Cognito user ID
  learnerName: string;
  assignedById: string;
  assignedByName: string;
  due?: string; // "YYYY-MM-DD"
  note?: string; // shown to the employee in Training
  createdAt: string;
}

/** An assignment with the workflow's details and how far the employee has got. */
export interface AssignmentView extends Assignment {
  workflowName: string;
  /** Who recorded the workflow, for display. */
  trainedBy?: string;
  stepCount: number;
  learned: number;
  relearn: number;
}

/** The supervisor's review batch for one learner. */
export interface ReviewBatch {
  learner: string;
  items: ReviewItem[];
  submitted: boolean;
}

/** Teaching: per step, has the new hire learned it or do they need to relearn it. */
export type StepMastery = "learned" | "relearn";

/** A question the Apprentice asked about something the screenshots couldn't explain, and the answer. */
export interface ObserveQA {
  q: string;
  a: string;
}

export interface WorkMap {
  task: string;
  steps: WorkMapStep[];
  gaps: string[]; // open questions for the debrief
  confirmed: boolean; // expert confirmed the teach-back
  offRecord?: { from: string; to: string }[]; // "mm:ss" ranges the expert took off the record (shown as gaps)
  published?: boolean; // expert approved the map; Teaching mode uses only published maps
  processBuiltAt?: string; // ISO time the process map was last built
}

export type RuleKey = "approval" | "delivery_docs";

export interface GuardrailResult {
  ok: boolean;
  applicable: RuleKey[]; // rules that applied to this expense (for Teach progress)
  violations: { key: RuleKey; stepId: string; rule: string; explanation: string; fields: string[]; missing: string }[];
}

// ---------- Legacy: old invoice mock ERP (src/features/erp/MockErp.tsx), no longer used ----------
export type CostCenter = "4711" | "0400";
export type InvoiceStatus = "open" | "approved" | "on_hold" | "pending_2nd_approval";
export interface Invoice {
  id: string;
  supplier: string;
  amount: number;
  currency: string;
  description: string;
  costCenter: CostCenter;
  assetNumber: string;
  status: InvoiceStatus;
}
