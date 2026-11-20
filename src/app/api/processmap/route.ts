// POST /api/processmap { id } → builds the process map of one saved workflow and stores it on the
// workflow: per step the tool or site used, the data it needs (and where that comes from), what it
// produces, which later steps use it, the decision made, and what is still unknown.
// Step times come from the recording itself (computed on the page), not from the model.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { orgDb } from "@/lib/db";
import { geminiJson } from "@/lib/gemini";
import { redact, redactDeep } from "@/lib/redact";
import type { StepProcess, WorkflowRecord } from "@/lib/types";
import { ACTION_NAMES } from "@/features/workmap/actionCategory";
import { openWorkflow, workflowPath } from "@/lib/workflows";

export const dynamic = "force-dynamic";

// Full models first: the light ones tend to link every step to the one before. A light one is
// still the last resort, since Gemini is often overloaded and a rough map beats none.
// Measured 2026-11-10 on a recorded 11-step workflow: both Flash Lite models finish in about 3-4 s and name more
// input sources; gemini-3.8-flash, gemini-flash-latest and gemini-3.7-flash ran past 60 s, gemini-3.5/3.6-flash were out of quota.
const MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"];
const MAX_SHOTS = 6; // more images made Gemini too slow for the hosting time limit (~30 s)
const CHUNK = 10; // steps per call when a workflow is long
const CHUNK_SHOTS = 3; // screenshots per chunk

const PROCESS = `You turn a recorded work process into a process map that a new hire and a manager can read.
You get the expert's STEPS in order (title, what was seen on screen, the expert's reason, their rules) and, for some steps, the screenshot taken at that step.

For EVERY step return:
- tool: the app, system, site or document the step happens in, as specific as the screen shows (e.g. "Ledgerline · expense form", "Outlook", "Supplier portal"). Use the same name for the same tool across steps.
- action: what kind of action the step is, exactly one of: "Find and open" (navigate, search, open or start something), "Enter data" (type or fill in information), "Check and decide" (review, verify, compare, approve or choose), "Attach files" (upload or attach a document), "Submit and send" (submit, save, send or share the result). Use "Other" only if none fits.
- inputs: the data or documents the step needs, each with where it comes from: an earlier step by its number ("step 2"), never its [id], a person or team ("from the supervisor"), a system ("from the travel booking"), or "unknown". Only real information or documents (e.g. "receipt", "project number", "supervisor approval"), not every field on screen, and NEVER the fact that an earlier step was done ("form opened", "details filled" are not inputs). Name documents by their kind only ("receipt", "approval email"), never with a shop, restaurant, platform, person or file name ("receipt", not "Bitebox receipt").
- outputs: what the step produces or changes, as the information or result a later step can use (e.g. "invoice details: number, PO, amount, bank account", "supplier bank account confirmed", "meeting with the finance manager booked", "bill saved on hold"), not just that something was opened.
- feedsInto: ids of LATER steps that use this step's outputs. [] if none.
- decision: the judgment call made in this step and the reason, ONLY from the expert's why/rules/answers. "" for routine steps and for any step where the expert gave no why, rule or answer. Never invent a reason.
- summary: one or two plain sentences that sum up what the expert explained about this step: what they do and why, in the third person ("The expert checks the total against the receipt because…"). Build it from the expert's reason, rules and answers. Never a question and answer list, never invented. "" if the expert explained nothing about this step (no why, rule or answer): never describe the screen here.
- unknown: short questions to the expert, one per unclear point (always one for an input whose source is unknown), about what the recording can't tell (where an input comes from, who receives the output, a missing reason). [] if nothing important is unclear.

Expert answers: when a step lists "expert answered", use those answers (for example as an input's source or the decision's reason) and never ask that question again.
Rules: a step only "feedsInto" a later step when that later step actually uses something it produced. Stay generic about the case (no people's names, no amounts or ids unless they are a rule). Never invent tools, people or systems you can't see or read. Keep every string short.
Return JSON only: {"steps":[{"id": string, "tool": string, "action": string, "inputs":[{"name": string, "source": string}], "outputs":[string], "feedsInto":[string], "decision": string, "summary": string, "unknown":[string]}]}`;

const toPart = (dataUrl: string) => ({ inlineData: { mimeType: "image/jpeg", data: dataUrl.replace(/^data:image\/\w+;base64,/, "") } });

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  const { id } = (await req.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "Missing workflow id" }, { status: 400 });
  const db = orgDb(u.org);
  const key = workflowPath(id);
  const record = await openWorkflow(u, id); // 403 unless a manager, an admin, or the recorder
  if (record instanceof NextResponse) return record;
  const steps = record.map.steps;
  if (!steps.length) return NextResponse.json({ error: "This workflow has no steps yet" }, { status: 400 });

  const list = redact(
    steps
      .map(
        (s, i) =>
          `Step ${i + 1} [${s.id}] ${s.time} ${s.title}${s.decision ? ` | seen: ${s.decision}` : ""}${s.reason ? ` | why: ${s.reason}` : ""}${
            s.guardrails.length ? ` | rules: ${s.guardrails.join("; ")}` : ""
          }${s.answers?.length ? ` | expert answered: ${s.answers.map((x) => `${x.q} → ${x.a}`).join("; ")}` : ""}`,
      )
      .join("\n"),
  );
  // Long workflows are built in parallel chunks: one call for 28 steps took 25-33 s, past the hosting
  // time limit (~30 s on Amplify), so big maps came back partly built or not at all. Each chunk sees the
  // whole step list (for data links and tool names) but answers only for its own steps, with a few of
  // its own screenshots.
  const started = Date.now();
  const head = `TASK: ${record.name}${record.role ? `\nROLE OF THE PERSON WHO DOES IT: ${record.role}` : ""}\n\nSTEPS:\n${list}`;
  const shotsOf = (group: typeof steps, max: number) => {
    const withShots = group.filter((s) => s.screenshot?.startsWith("data:image"));
    const every = Math.max(1, Math.ceil(withShots.length / max));
    return withShots.filter((_, i) => i % every === 0).slice(0, max);
  };
  type Built = StepProcess & { id: string };
  const ask = async (group: typeof steps, whole: boolean, budget: number) => {
    const only = whole ? "" : `\n\nReturn entries ONLY for these step ids: ${group.map((s) => s.id).join(", ")}. Use the same tool name for the same tool as the other steps would get.`;
    const shots = shotsOf(group, whole ? MAX_SHOTS : CHUNK_SHOTS);
    const parts = [{ text: head + only }, ...shots.flatMap((s) => [{ text: `Screenshot of step [${s.id}]:` }, toPart(s.screenshot!)])];
    // A chunk normally answers in 4-6 s, but Gemini sometimes hangs: give each try about 9 s, then the next model.
    return geminiJson<{ steps?: Built[] } | Built[]>(PROCESS, parts, MODELS, budget, whole ? 0.92 : 0.45);
  };
  // The model sometimes answers with the bare list instead of { steps: [...] }: accept both.
  const stepsOf = (data: { steps?: Built[] } | Built[]): Built[] => {
    const d = redactDeep(data);
    return Array.isArray(d) ? d : Array.isArray(d?.steps) ? d.steps : [];
  };
  const chunks = steps.length <= CHUNK ? [steps] : Array.from({ length: Math.ceil(steps.length / CHUNK) }, (_, k) => steps.slice(k * CHUNK, (k + 1) * CHUNK));
  const results = await Promise.all(chunks.map((c) => ask(c, chunks.length === 1, 20_000)));
  const byId = new Map<string, Built>();
  for (const r of results) if (r.ok) for (const p of stepsOf(r.data)) if (p?.id) byId.set(p.id, p);
  if (!byId.size) {
    const failed = results.find((r) => !r.ok);
    return NextResponse.json({ error: failed && !failed.ok ? failed.error : "The model returned no steps" }, { status: 502 });
  }
  // A step the model left out (or a chunk that failed) gets one more try, if there is time left.
  const missing = steps.filter((s) => !byId.has(s.id));
  const left = 26_000 - (Date.now() - started);
  if (missing.length && left > 6_000) {
    const again = await ask(missing, false, left - 1_000);
      if (again.ok) for (const p of stepsOf(again.data)) if (p?.id && missing.some((m) => m.id === p.id)) byId.set(p.id, p);
  }
  // The same tool named slightly differently by two chunks ("Gmail" / "gmail") is one lane.
  const toolName = new Map<string, string>();
  for (const p of byId.values()) {
    const t = typeof p.tool === "string" ? p.tool.trim() : "";
    const k = t.toLowerCase();
    if (t && !toolName.has(k)) toolName.set(k, t);
    if (t) p.tool = toolName.get(k)!;
  }
  const ids = new Set(steps.map((s) => s.id));
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  // "step w5" → "step 5", in case the model used an id instead of the step number.
  const num = new Map(steps.map((s, i) => [s.id.toLowerCase(), String(i + 1)]));
  const stepRefs = (t: string) => t.replace(/\bstep\s+\[?([\w-]+)\]?/gi, (m, ref: string) => (num.has(ref.toLowerCase()) ? `step ${num.get(ref.toLowerCase())}` : m));

  const updated: WorkflowRecord = {
    ...record,
    map: {
      ...record.map,
      processBuiltAt: new Date().toISOString(),
      steps: steps.map((s, i) => {
        const p = byId.get(s.id);
        if (!p) return s;
        const later = new Set(steps.slice(i + 1).map((x) => x.id));
        const inputs = (Array.isArray(p.inputs) ? p.inputs : [])
          .map((x) => ({ name: str(x?.name), source: stepRefs(str(x?.source)) || "unknown" }))
          .filter((x) => x.name);
        const answered = new Set((s.answers ?? []).map((x) => x.q.trim().toLowerCase()));
        const spoke = !!(s.reason?.trim() || s.guardrails.length || s.answers?.length || s.correction?.trim() || s.note?.trim());
        const unknown = strs(p.unknown).map(stepRefs).filter((q) => !answered.has(q.trim().toLowerCase()));
        // An input nobody knows the source of is a question for the expert (unless the model already asked one).
        if (!unknown.length)
          for (const x of inputs) if (/^unknown$/i.test(x.source)) unknown.push(`Where do you get the ${x.name.toLowerCase()} from?`);
        return {
          ...s,
          process: {
            tool: str(p.tool) || "unknown",
            ...(ACTION_NAMES.includes(str(p.action)) ? { action: str(p.action) } : {}),
            inputs,
            outputs: strs(p.outputs),
            feedsInto: strs(p.feedsInto).filter((x) => ids.has(x) && later.has(x)),
            // Decision and summary are the expert's explanation: none without anything the expert said.
            decision: spoke ? stepRefs(str(p.decision)) : "",
            unknown,
            ...(spoke && str(p.summary) ? { summary: str(p.summary) } : {}),
          },
        };
      }),
    },
  };
  await db.writeJson(key, updated);
  return NextResponse.json(updated);
}
