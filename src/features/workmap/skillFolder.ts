// "Skill folder" export: a recorded workflow as a zip of Markdown files and Mermaid diagrams that an
// internal AI can load as a skill, and a developer can read when automating the task.
// Plain functions, no network, no AI call: it only rearranges what the workflow already holds.
// Anything that wasn't recorded says "not recorded"; nothing is invented. All text goes through redact().

import { strToU8, zipSync } from "fflate";
import { redact } from "@/lib/redact";
import type { WorkMap, WorkMapStep } from "@/lib/types";
import { guardrailType } from "./WorkMapView";

export const SKILL_FORMAT_VERSION = 1;
const NR = "not recorded";

export interface SkillInput {
  id: string;
  name: string;
  createdAt: string;
  map: WorkMap;
  /** The steps to export (the Mapping page's corrected steps). */
  steps: WorkMapStep[];
  trainedBy?: string;
  includeScreenshots?: boolean;
}

type Files = Record<string, string | Uint8Array>;

// ---------- small helpers ----------

const clean = (s?: string | null) => redact((s ?? "").replace(/\s+/g, " ").trim());
/** Markdown text: angle brackets escaped so a title like "<new>" is not read as an HTML tag. */
const text = (s?: string | null) => (clean(s) || NR).replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Table cell: one line, no pipes. */
const cell = (s?: string | null) => text(s).replace(/\|/g, "\\|");
/** Mermaid label inside double quotes: no quotes, angle brackets or line breaks, and not too long. */
const label = (s: string, max = 70) => {
  const t = clean(s).replace(/"/g, "'").replace(/</g, "#lt;").replace(/>/g, "#gt;");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};
/** Mermaid sequence-diagram text: also drop ; and #, which end a line. */
const seq = (s: string) => clean(s).replace(/[;#]/g, "").slice(0, 80);
const pad = (n: number) => String(n).padStart(2, "0");

export function slugify(s: string, max = 40): string {
  const t = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  return t || "workflow";
}

function dataUrlBytes(url?: string): { ext: string; bytes: Uint8Array } | null {
  const m = /^data:image\/(\w+);base64,(.+)$/.exec(url ?? "");
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { ext: m[1] === "jpeg" ? "jpg" : m[1], bytes };
}

const stepFile = (s: WorkMapStep, n: number) => `steps/${pad(n)}-${slugify(s.short || s.title, 30)}.md`;
const typedRules = (s: WorkMapStep) => s.guardrails.map((g) => ({ type: guardrailType(g), text: clean(g) }));
const tools = (steps: WorkMapStep[]) => [...new Set(steps.map((s) => clean(s.process?.tool)).filter(Boolean))];
const hasProcess = (steps: WorkMapStep[]) => steps.some((s) => s.process);

// ---------- the files ----------

function skillMd(i: SkillInput, slug: string, shots: Map<string, string>): string {
  const { map, steps } = i;
  const used = tools(steps);
  const date = (iso?: string) => (iso ? iso.slice(0, 10) : NR);
  const name = clean(i.name) || clean(map.task) || "this workflow";
  const lines = [
    "---",
    `name: ${slug}`,
    `description: ${JSON.stringify(`Use when carrying out, checking or automating "${name}". A recorded, expert-checked description of how an experienced employee does it, with the steps, the rules and where to hand over to a person.`)}`,
    "---",
    "",
    `# ${name}`,
    "",
    "## Context",
    "",
    `This folder is a recording of how an experienced employee does **${name}**. Torchbearer watched them work, asked why at the moments the screen could not explain, and the expert then checked and corrected the result. It exists so a new hire can learn the task and so a developer or an internal AI can automate it without asking the expert again.`,
    "",
    `- **Recorded by:** ${clean(i.trainedBy) || NR}, on ${date(i.createdAt)}`,
    `- **Checked and approved by the expert:** ${map.published ? "yes" : "not yet"}${map.confirmed ? " (confirmed in the teach-back)" : ""}`,
    `- **Steps:** ${steps.length}`,
    `- **Systems used:** ${used.length ? used.join(", ") : `${NR} (the process map has not been built)`}`,
    `- **Process map built:** ${map.processBuiltAt ? date(map.processBuiltAt) : "no"}`,
    ...(map.offRecord?.length ? [`- **Off the record:** the expert paused the recording ${map.offRecord.length} time(s); nothing from those moments is saved (see handoffs.md)`] : []),
    "",
    "**How to behave with this folder**",
    "- Follow the steps in order. Each step file says where it happens, what it needs, what it produces and why.",
    "- When a STOP rule applies, stop and hand the case to a person (handoffs.md). Do not carry on.",
    "- Anything marked *not recorded*, and everything in open-questions.md, was not captured. Do not guess it: ask a person.",
    "- The expert's own words are quoted in the step files and rules.md. Prefer them over your own interpretation.",
    "",
    "## Outcome",
    "",
    steps.length ? `The task is done after step ${steps.length}: ${text(steps[steps.length - 1].title)}.` : NR,
    "",
    "## Steps at a glance",
    "",
    ...steps.map((s, k) => `${k + 1}. [${text(s.title)}](${stepFile(s, k + 1)})${s.guardrails.length ? ` (${s.guardrails.length} rule${s.guardrails.length > 1 ? "s" : ""})` : ""}`),
    "",
    "## What is in this folder",
    "",
    "| File | What it answers |",
    "|---|---|",
    "| [flow.md](flow.md) | The whole process as a diagram, with the choices and stop points |",
    "| [steps/](steps/) | One file per step: where, needs, did, produces, why, rules |",
    "| [rules.md](rules.md) | Every rule, with its type, the reason and the expert's words |",
    "| [data.md](data.md) | What information moves between steps and where it comes from |",
    "| [systems.md](systems.md) | Every app or site used, and what is done in each |",
    "| [handoffs.md](handoffs.md) | When to stop and pass the case to a person |",
    "| [open-questions.md](open-questions.md) | What the recording could not tell: do not guess |",
    "| [examples/recorded-run.md](examples/recorded-run.md) | The one real run, to check an automation against |",
    `| screenshots/ | ${shots.size ? `${shots.size} screenshot(s), one per step` : "not included"} |`,
    "| [workflow.json](workflow.json) | The same content for code |",
    "",
    "## Version",
    "",
    `- Workflow id: ${i.id}`,
    `- Recorded: ${date(i.createdAt)}`,
    `- Process map built: ${map.processBuiltAt ? date(map.processBuiltAt) : "no"}`,
    `- Exported: ${new Date().toISOString().slice(0, 10)}`,
    `- Export format: ${SKILL_FORMAT_VERSION}`,
    "",
  ];
  return lines.join("\n");
}

function flowMd(i: SkillInput): string {
  const { steps } = i;
  const stop = steps.some((s) => typedRules(s).some((r) => r.type === "STOP"));
  const g = ["flowchart TD", '  start(["Start"])'];
  let prev = "start";
  steps.forEach((s, k) => {
    const n = k + 1;
    g.push(`  ${prev} --> s${n}["${n}. ${label(s.short || s.title)}"]`);
    const decision = clean(s.process?.decision);
    if (decision) {
      g.push(`  s${n} --> d${n}{"${label(decision, 60)}"}`);
      prev = `d${n}`;
    } else prev = `s${n}`;
    for (const r of typedRules(s).filter((r) => r.type === "STOP")) g.push(`  s${n} -.->|"STOP: ${label(r.text, 45)}"| hand`);
  });
  g.push(`  ${prev} --> done(["Done"])`);
  if (stop) g.push('  hand(["Hand to a person"])');
  return [
    "# Flow",
    "",
    "The whole process in order. A diamond is a judgment call the expert made; a dotted line is a stop point where a person takes over.",
    "",
    "```mermaid",
    ...g,
    "```",
    "",
    "## The same flow as a list",
    "",
    ...steps.map((s, k) => `${k + 1}. ${text(s.title)}${s.process?.decision ? ` — judgment call: ${text(s.process.decision)}` : ""}`),
    "",
  ].join("\n");
}

function stepMd(s: WorkMapStep, k: number, steps: WorkMapStep[], shot?: string): string {
  const p = s.process;
  const numOf = (id: string) => steps.findIndex((x) => x.id === id) + 1;
  const list = (items: string[]) => (items.length ? items.map((x) => `- ${x}`) : [`- ${NR}`]);
  const used = (p?.feedsInto ?? []).map(numOf).filter((n) => n > 0);
  return [
    `# Step ${k + 1}: ${text(s.title)}`,
    "",
    `Recorded at ${s.time || NR}.`,
    "",
    "## Where",
    p ? text(p.tool) : `${NR} (process map not built)`,
    "",
    "## Needs",
    ...list((p?.inputs ?? []).map((x) => `${text(x.name)} — ${text(x.source)}`)),
    "",
    "## Seen on screen",
    text(s.decision),
    "",
    ...(s.review === "wrong" && s.correction?.trim() ? ["## Corrected by the expert", clean(s.correction), ""] : []),
    "## Produces",
    ...list((p?.outputs ?? []).map(text)),
    "",
    "## Used by",
    used.length ? used.map((n) => `step ${n}`).join(", ") : p ? "no later step" : NR,
    "",
    "## Judgment call and why",
    p?.decision ? `${text(p.decision)}\n\n**Why:** ${text(s.reason)}` : `${s.reason ? `**Why:** ${text(s.reason)}` : "No judgment call recorded (routine step)."}`,
    "",
    "## The expert's words",
    s.expertQuote ? `> ${clean(s.expertQuote)}` : NR,
    "",
    "## Rules",
    ...(s.guardrails.length ? typedRules(s).map((r) => `- **${r.type}:** ${r.text}`) : ["- none recorded"]),
    "",
    "## Not clear yet",
    ...(p?.unknown.length ? p.unknown.map((u) => `- ${text(u)}`) : ["- nothing flagged"]),
    "",
    "## Screenshot",
    shot ? `![Step ${k + 1}](../${shot})` : "not included",
    "",
  ].join("\n");
}

function rulesMd(steps: WorkMapStep[]): string {
  const order = { STOP: 0, LIMIT: 1, EXCEPTION: 2, RULE: 3 } as const;
  const rows = steps
    .flatMap((s, k) => typedRules(s).map((r) => ({ ...r, n: k + 1, why: s.reason, quote: s.expertQuote })))
    .sort((a, b) => order[a.type] - order[b.type] || a.n - b.n);
  return [
    "# Rules",
    "",
    "STOP: do not continue, hand to a person. LIMIT: a number or threshold. EXCEPTION: when the usual step does not apply. RULE: always.",
    "",
    ...(rows.length
      ? ["| Rule | Type | Step | Why | The expert's words |", "|---|---|---|---|---|", ...rows.map((r) => `| ${cell(r.text)} | ${r.type} | ${r.n} | ${cell(r.why)} | ${cell(r.quote)} |`)]
      : ["No rules were recorded."]),
    "",
  ].join("\n");
}

function dataMd(steps: WorkMapStep[]): string {
  if (!hasProcess(steps)) {
    return "# Data\n\nNot recorded: the process map has not been built for this workflow. Build it on the Process page, then export again.\n";
  }
  const g = ["flowchart LR"];
  steps.forEach((s, k) => g.push(`  s${k + 1}["${k + 1}. ${label(s.short || s.title, 40)}"]`));
  const idx = new Map(steps.map((s, k) => [s.id, k + 1]));
  steps.forEach((s, k) => {
    for (const to of s.process?.feedsInto ?? []) {
      const m = idx.get(to);
      if (m) g.push(`  s${k + 1} -->|"${label((s.process?.outputs ?? []).join(", ") || "output", 40)}"| s${m}`);
    }
  });
  const externals = new Map<string, number>();
  const rows: string[] = [];
  steps.forEach((s, k) => {
    for (const inp of s.process?.inputs ?? []) {
      const src = clean(inp.source);
      rows.push(`| ${cell(inp.name)} | ${cell(src)} | ${k + 1} |`);
      if (src && !/\bstep\s*\d+/i.test(src)) {
        if (!externals.has(src)) {
          externals.set(src, externals.size + 1);
          g.push(`  e${externals.size}(["${label(src, 40)}"])`);
        }
        g.push(`  e${externals.get(src)} -->|"${label(inp.name, 40)}"| s${k + 1}`);
      }
    }
  });
  return [
    "# Data",
    "",
    "Where information comes from and where it goes. Boxes are steps; rounded boxes are people, documents or systems outside the process.",
    "",
    "```mermaid",
    ...g,
    "```",
    "",
    "## Data in each step",
    "",
    ...(rows.length ? ["| Data | Comes from | Used in step |", "|---|---|---|", ...rows] : ["No inputs were recorded."]),
    "",
  ].join("\n");
}

function systemsMd(steps: WorkMapStep[]): string {
  const used = tools(steps);
  if (!used.length) {
    return "# Systems\n\nNot recorded: the process map has not been built for this workflow. Build it on the Process page, then export again.\n";
  }
  const seqLines = ["sequenceDiagram", "  actor E as The expert"];
  used.forEach((t, k) => seqLines.push(`  participant T${k + 1} as ${seq(t)}`));
  steps.forEach((s, k) => {
    const t = used.indexOf(clean(s.process?.tool));
    if (t >= 0) seqLines.push(`  E->>T${t + 1}: ${k + 1}. ${seq(s.short || s.title)}`);
  });
  return [
    "# Systems",
    "",
    "Every app, site or document the expert worked in. Whether a system has an API or needs screen automation is not recorded.",
    "",
    "| System | Steps done there | What is done there |",
    "|---|---|---|",
    ...used.map((t) => {
      const mine = steps.map((s, k) => ({ s, n: k + 1 })).filter(({ s }) => clean(s.process?.tool) === t);
      return `| ${cell(t)} | ${mine.map((m) => m.n).join(", ")} | ${cell(mine.map((m) => m.s.title).join("; "))} |`;
    }),
    "",
    "```mermaid",
    ...seqLines,
    "```",
    "",
  ].join("\n");
}

function handoffsMd(i: SkillInput): string {
  const { steps, map } = i;
  const stops = steps.flatMap((s, k) => typedRules(s).filter((r) => r.type === "STOP").map((r) => `- **Step ${k + 1}:** ${r.text}`));
  return [
    "# Hand over to a person",
    "",
    "An automation or AI must stop and pass the case to a person in these situations. Who that person is was not recorded unless a rule names them.",
    "",
    "## STOP rules",
    ...(stops.length ? stops : ["- none recorded"]),
    "",
    "## Always",
    "- Something in open-questions.md comes up.",
    "- The screen or the data does not match what a step expects.",
    "- A rule applies that you are not sure about.",
    "",
    "## Off the record",
    ...(map.offRecord?.length ? map.offRecord.map((r) => `- ${r.from}–${r.to}: the expert paused the recording. Nothing from this time is saved.`) : ["- none"]),
    "",
  ].join("\n");
}

function openQuestionsMd(i: SkillInput): string {
  const { steps, map } = i;
  const q: string[] = [
    ...map.gaps.map((g) => `- ${text(g)}`),
    ...steps.flatMap((s, k) => (s.process?.unknown ?? []).map((u) => `- Step ${k + 1}: ${text(u)}`)),
    ...steps.flatMap((s, k) => (s.review === "wrong" && !s.correction?.trim() ? [`- Step ${k + 1}: the expert marked this step wrong but did not say what really happened.`] : [])),
  ];
  return [
    "# Open questions",
    "",
    "The recording could not answer these. Do not guess: ask a person.",
    "",
    ...(q.length ? q : ["Nothing was flagged."]),
    "",
  ].join("\n");
}

function exampleMd(steps: WorkMapStep[], shots: Map<string, string>): string {
  return [
    "# The recorded run",
    "",
    "The one real run the expert did, step by step. An automation is correct when it produces the same result on the same case.",
    "",
    ...steps.flatMap((s, k) => [
      `## ${k + 1}. ${text(s.title)} (${s.time || NR})`,
      "",
      `Seen: ${text(s.decision)}`,
      "",
      ...(shots.get(s.id) ? [`![Step ${k + 1}](../${shots.get(s.id)})`, ""] : []),
    ]),
  ].join("\n");
}

function workflowJson(i: SkillInput): string {
  const { map, steps } = i;
  return JSON.stringify(
    {
      formatVersion: SKILL_FORMAT_VERSION,
      id: i.id,
      name: clean(i.name),
      task: clean(map.task),
      recordedBy: clean(i.trainedBy) || null,
      recordedAt: i.createdAt,
      processMapBuiltAt: map.processBuiltAt ?? null,
      approvedByExpert: !!map.published,
      confirmedInTeachBack: !!map.confirmed,
      steps: steps.map((s, k) => ({
        number: k + 1,
        title: clean(s.title),
        time: s.time,
        seenOnScreen: clean(s.decision),
        why: clean(s.reason),
        expertQuote: clean(s.expertQuote),
        rules: typedRules(s),
        tool: s.process ? clean(s.process.tool) : null,
        inputs: (s.process?.inputs ?? []).map((x) => ({ name: clean(x.name), source: clean(x.source) })),
        outputs: (s.process?.outputs ?? []).map(clean),
        usedBySteps: (s.process?.feedsInto ?? []).map((id) => steps.findIndex((x) => x.id === id) + 1).filter((n) => n > 0),
        judgmentCall: clean(s.process?.decision) || null,
        unknown: (s.process?.unknown ?? []).map(clean),
      })),
      openQuestions: map.gaps.map(clean),
      offRecord: map.offRecord ?? [],
    },
    null,
    2,
  );
}

// ---------- public ----------

/** Every file of the folder, keyed by path inside it (no top-level folder name). */
export function buildSkillFiles(i: SkillInput): Files {
  const slug = slugify(i.name || i.map.task);
  const files: Files = {};
  const shots = new Map<string, string>(); // step id → path
  if (i.includeScreenshots !== false) {
    i.steps.forEach((s, k) => {
      const img = dataUrlBytes(s.screenshot);
      if (!img) return;
      const path = `screenshots/${pad(k + 1)}.${img.ext}`;
      files[path] = img.bytes;
      shots.set(s.id, path);
    });
  }
  files["SKILL.md"] = skillMd(i, slug, shots);
  files["flow.md"] = flowMd(i);
  i.steps.forEach((s, k) => (files[stepFile(s, k + 1)] = stepMd(s, k, i.steps, shots.get(s.id))));
  files["rules.md"] = rulesMd(i.steps);
  files["data.md"] = dataMd(i.steps);
  files["systems.md"] = systemsMd(i.steps);
  files["handoffs.md"] = handoffsMd(i);
  files["open-questions.md"] = openQuestionsMd(i);
  files["examples/recorded-run.md"] = exampleMd(i.steps, shots);
  files["workflow.json"] = workflowJson(i);
  return files;
}

/** The zip: everything under one folder named after the workflow. */
export function buildSkillZip(i: SkillInput): { filename: string; bytes: Uint8Array } {
  const slug = slugify(i.name || i.map.task);
  const entries = Object.fromEntries(
    Object.entries(buildSkillFiles(i)).map(([path, data]) => [`${slug}/${path}`, typeof data === "string" ? strToU8(data) : data]),
  );
  return { filename: `${slug}.zip`, bytes: zipSync(entries) };
}

export function downloadBytes(filename: string, bytes: Uint8Array, type = "application/zip") {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
