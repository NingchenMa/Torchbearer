// "Export for AI agents": everything Torchbearer learned about a workflow, written so an AI agent
// (or a developer) can follow it: every step with where it happens, what the expert did and why,
// the rules, the data it needs and produces, how it connects to other steps, timing, and what is
// still unclear. Process details come from the process map (/process) when it has been built.

import { redact } from "@/lib/redact";
import type { WorkMap, WorkMapStep } from "@/lib/types";
import { guardrailType } from "./WorkMapView";

export interface ExportOptions {
  quotes: boolean; // the expert's reasons in their own words
  guardrails: boolean; // rules, limits, exceptions, stop conditions
  process: boolean; // tools, data in and out, links between steps (from the process map)
  screenMoments: boolean; // when each step happened and how long it took
}

export const DEFAULT_EXPORT: ExportOptions = { quotes: true, guardrails: true, process: true, screenMoments: true };

const toSec = (t: string) => {
  const m = /^(\d+):(\d{2})$/.exec(t?.trim() ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const fmt = (sec: number | null) => (sec == null ? "unknown" : sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`);
const clean = (t: string | undefined | null) => (t ?? "").trim();

/** Everything known about each step, in one shape both formats are written from. */
function detail(map: WorkMap) {
  const steps = map.steps;
  const num = new Map(steps.map((s, i) => [s.id, i + 1]));
  const usedBy = new Map<string, number[]>(); // step id -> later steps that use its output
  for (const s of steps) for (const id of s.process?.feedsInto ?? []) if (num.has(id)) usedBy.set(s.id, [...(usedBy.get(s.id) ?? []), num.get(id)!]);
  const feedsFrom = new Map<string, number[]>(); // step id -> earlier steps whose output it uses
  steps.forEach((s, i) => {
    for (const id of s.process?.feedsInto ?? []) if (num.has(id)) feedsFrom.set(id, [...(feedsFrom.get(id) ?? []), i + 1]);
  });
  const secs = steps.map((s) => toSec(s.time));
  return steps.map((s: WorkMapStep, i) => {
    const start = secs[i];
    const next = secs[i + 1];
    const why = clean(s.expertQuote) || clean(s.reason);
    return {
      n: i + 1,
      step: s,
      title: clean(s.correction) && s.review === "wrong" ? clean(s.correction) : clean(s.title),
      did: clean(s.decision),
      why,
      whyIsQuote: !!clean(s.expertQuote),
      at: s.time || null,
      duration: start != null && next != null && next >= start ? next - start : null,
      review: s.review === "ok" ? "confirmed by the expert" : s.review === "wrong" ? "corrected by the expert" : "not checked by the expert yet",
      p: s.process,
      usedIn: usedBy.get(s.id) ?? [],
      uses: feedsFrom.get(s.id) ?? [],
    };
  });
}

/** The process map's questions the expert has not answered yet. */
function openOf(step: WorkMapStep): string[] {
  const answered = new Set((step.answers ?? []).map((x) => x.q.trim().toLowerCase()));
  return (step.process?.unknown ?? []).filter((q) => !answered.has(q.trim().toLowerCase()));
}

export function toAgentMarkdown(map: WorkMap, opts: ExportOptions = DEFAULT_EXPORT): string {
  const d = detail(map);
  const built = !!map.processBuiltAt && d.some((x) => x.p);
  const secs = map.steps.map((s) => toSec(s.time)).filter((x): x is number => x != null);
  const span = secs.length > 1 ? Math.max(...secs) - Math.min(...secs) : null;
  const tools = built ? [...new Set(d.map((x) => x.p?.tool).filter((t): t is string => !!t && t !== "unknown"))] : [];
  const rules = d.flatMap((x) => x.step.guardrails.map((g) => ({ n: x.n, g })));
  const status = map.published ? "approved by the expert" : "draft, not approved by the expert yet";

  const L: string[] = [];
  L.push(`# ${map.task || "Workflow"}: how the expert does it`, "");
  L.push(`- Status: ${status}${map.published && map.confirmed ? " (confirmed in the teach-back)" : ""}`);
  L.push(`- Steps: ${d.length}${span != null ? ` · recorded time ${fmt(span)}` : ""}`);
  if (tools.length) L.push(`- Tools and sites: ${tools.join(", ")}`);
  L.push(`- Exported: ${new Date().toISOString().slice(0, 10)} from TorchBearer`);
  L.push("");
  L.push("## How to use this");
  L.push("You are doing this task the way the expert does it. Follow the steps in order.");
  L.push("- Before each step, check you have what it needs (\"Needs\"). If an input's source is unknown, ask a person instead of guessing.");
  L.push("- Apply every rule exactly. If a STOP rule applies, or a LIMIT is crossed and you can't meet what it requires, do not submit: hand the case to a person and say which rule applies.");
  L.push("- The expert's own case values (names, amounts, numbers, dates) are examples, not instructions. Use the values of the case in front of you.");
  L.push("- Anything under \"Open questions\" is not settled. Don't decide it yourself; ask.");
  if (!map.published) L.push("- This workflow is not approved yet: treat it as a draft and have a person check your work.");
  L.push("");

  L.push("## Steps");
  for (const x of d) {
    L.push("", `### ${x.n}. ${x.title}`);
    if (opts.screenMoments && x.at) L.push(`- When: ${x.at} into the recording · took ${fmt(x.duration)}`);
    if (opts.process && x.p?.tool && x.p.tool !== "unknown") L.push(`- Where: ${x.p.tool}`);
    if (x.did) L.push(`- What the expert did: ${x.did}`);
    if (opts.quotes) L.push(x.why ? `- Why: ${x.whyIsQuote ? `"${x.why}" (the expert's words)` : x.why}` : "- Why: not explained by the expert");
    if (opts.process && x.p?.decision) L.push(`- Judgment call: ${x.p.decision}`);
    if (opts.guardrails) for (const g of x.step.guardrails) L.push(`- ${guardrailType(g)}: ${g}`);
    if (opts.process && x.p) {
      if (x.p.inputs.length) L.push(`- Needs: ${x.p.inputs.map((i) => `${i.name} (from ${i.source})`).join("; ")}`);
      if (x.uses.length) L.push(`- Uses what step${x.uses.length > 1 ? "s" : ""} ${x.uses.join(", ")} produced`);
      if (x.p.outputs.length) L.push(`- Produces: ${x.p.outputs.join("; ")}${x.usedIn.length ? ` → used in step${x.usedIn.length > 1 ? "s" : ""} ${x.usedIn.join(", ")}` : ""}`);
      for (const q of openOf(x.step)) L.push(`- Open question: ${q}`);
    }
    for (const ans of x.step.answers ?? []) L.push(`- Expert answered "${ans.q}": ${ans.a}`);
    L.push(`- Checked: ${x.review}`);
  }

  if (opts.guardrails) {
    L.push("", "## All rules in one place");
    if (rules.length) for (const r of rules) L.push(`- ${guardrailType(r.g)} (step ${r.n}): ${r.g}`);
    else L.push("- The expert stated no rules for this workflow yet.");
  }

  if (opts.process && built) {
    const rows = d.flatMap((x) => (x.p?.inputs ?? []).map((i) => ({ name: i.name, from: i.source, n: x.n })));
    if (rows.length) {
      L.push("", "## Data flow", "", "| Data or document | Comes from | Used in |", "|---|---|---|");
      for (const r of rows) L.push(`| ${r.name} | ${r.from} | step ${r.n} |`);
    }
  }

  const open = [...map.gaps, ...(opts.process ? d.flatMap((x) => openOf(x.step).map((q) => `${q} (step ${x.n})`)) : [])];
  L.push("", "## Open questions (ask a person)");
  if (open.length) for (const q of open) L.push(`- ${q}`);
  else L.push("- None recorded.");

  if (opts.process && !built) L.push("", "_Tools, data and step links are not included yet: build the process map for this workflow first._");

  // Names, emails and card numbers are removed from the export.
  return redact(L.join("\n")) + "\n";
}

export function toAgentJson(map: WorkMap, opts: ExportOptions = DEFAULT_EXPORT): string {
  const d = detail(map);
  const steps = d.map((x) => ({
    order: x.n,
    id: x.step.id,
    title: x.title,
    whatTheExpertDid: x.did || null,
    ...(opts.quotes ? { why: x.why || null, whyIsExpertQuote: x.whyIsQuote } : {}),
    ...(opts.guardrails ? { rules: x.step.guardrails.map((g) => ({ type: guardrailType(g), text: g })) } : {}),
    ...(opts.screenMoments ? { at: x.at, durationSeconds: x.duration } : {}),
    ...(opts.process && x.p
      ? {
          tool: x.p.tool,
          judgmentCall: x.p.decision || null,
          inputs: x.p.inputs,
          outputs: x.p.outputs,
          usesOutputOfSteps: x.uses,
          outputUsedInSteps: x.usedIn,
          openQuestions: openOf(x.step),
        }
      : {}),
    expertAnswers: (x.step.answers ?? []).map(({ q, a }) => ({ question: q, answer: a })),
    checked: x.review,
  }));
  return redact(
    JSON.stringify(
      {
        task: map.task,
        status: map.published ? "approved" : "draft",
        confirmedInTeachBack: map.confirmed,
        processMapBuiltAt: map.processBuiltAt ?? null,
        steps,
        openQuestions: map.gaps,
      },
      null,
      2,
    ),
  );
}

export function downloadText(filename: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
