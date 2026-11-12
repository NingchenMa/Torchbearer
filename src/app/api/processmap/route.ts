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
import { openWorkflow, workflowPath } from "@/lib/workflows";

export const dynamic = "force-dynamic";

// Full models first: the light ones tend to link every step to the one before. A light one is
// still the last resort, since Gemini is often overloaded and a rough map beats none.
// Measured 2026-11-10 on a recorded 11-step workflow: both Flash Lite models finish in about 3-4 s and name more
// input sources; gemini-3.8-flash, gemini-flash-latest and gemini-3.7-flash ran past 60 s, gemini-3.5/3.6-flash were out of quota.
const MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"];
const MAX_SHOTS = 6; // more images made Gemini too slow for the hosting time limit (~30 s)

const PROCESS = `You turn a recorded work process into a process map that a new hire and a manager can read.
You get the expert's STEPS in order (title, what was seen on screen, the expert's reason, their rules) and, for some steps, the screenshot taken at that step.

For EVERY step return:
- tool: the app, system, site or document the step happens in, as specific as the screen shows (e.g. "Ledgerline · expense form", "Outlook", "Supplier portal"). Use the same name for the same tool across steps.
- inputs: the data or documents the step needs, each with where it comes from: an earlier step by its number ("step 2"), never its [id], a person or team ("from the supervisor"), a system ("from the travel booking"), or "unknown". Only real information or documents (e.g. "receipt", "project number", "supervisor approval"), not every field on screen, and NEVER the fact that an earlier step was done ("form opened", "details filled" are not inputs). Name documents by their kind only ("receipt", "approval email"), never with a shop, restaurant, platform, person or file name ("receipt", not "Bitebox receipt").
- outputs: what the step produces or changes (a saved form, an attached document, an approval, a status).
- feedsInto: ids of LATER steps that use this step's outputs. [] if none.
- decision: the judgment call made in this step and the reason, from the expert's reason/rules. "" for routine steps. Never invent a reason.
- unknown: short questions to the expert, one per unclear point (always one for an input whose source is unknown), about what the recording can't tell (where an input comes from, who receives the output, a missing reason). [] if nothing important is unclear.

Rules: a step only "feedsInto" a later step when that later step actually uses something it produced. Stay generic about the case (no people's names, no amounts or ids unless they are a rule). Never invent tools, people or systems you can't see or read. Keep every string short.
Return JSON only: {"steps":[{"id": string, "tool": string, "inputs":[{"name": string, "source": string}], "outputs":[string], "feedsInto":[string], "decision": string, "unknown":[string]}]}`;

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
          }`,
      )
      .join("\n"),
  );
  // Spread the screenshots we send over the whole process.
  const withShots = steps.filter((s) => s.screenshot?.startsWith("data:image"));
  const every = Math.max(1, Math.ceil(withShots.length / MAX_SHOTS));
  const shots = withShots.filter((_, i) => i % every === 0).slice(0, MAX_SHOTS);
  const parts = [
    { text: `TASK: ${record.name}\n\nSTEPS:\n${list}` },
    ...shots.flatMap((s) => [{ text: `Screenshot of step [${s.id}]:` }, toPart(s.screenshot!)]),
  ];

  const r = await geminiJson<{ steps?: (StepProcess & { id: string })[] }>(PROCESS, parts, MODELS, undefined, 0.92);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  const byId = new Map((redactDeep(r.data).steps ?? []).map((p) => [p.id, p]));
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
        const unknown = strs(p.unknown).map(stepRefs);
        // An input nobody knows the source of is a question for the expert (unless the model already asked one).
        if (!unknown.length)
          for (const x of inputs) if (/^unknown$/i.test(x.source)) unknown.push(`Where do you get the ${x.name.toLowerCase()} from?`);
        return {
          ...s,
          process: {
            tool: str(p.tool) || "unknown",
            inputs,
            outputs: strs(p.outputs),
            feedsInto: strs(p.feedsInto).filter((x) => ids.has(x) && later.has(x)),
            decision: stepRefs(str(p.decision)),
            unknown,
          },
        };
      }),
    },
  };
  await db.writeJson(key, updated);
  return NextResponse.json(updated);
}
