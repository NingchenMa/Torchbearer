# Skill folder export: requirements and plan

Status: **proposal for review**. No code yet.
Branch: `feat/skill-export` → `aws`.

## 1. Why

Torchbearer is first an onboarding and offboarding guide: it records how an experienced employee does a task so a new hire can learn it. The same recording should also be the handover if the company later decides to **automate** the task instead of hiring for it.

Today's "Export for AI agents" (`src/features/workmap/exportAgent.ts`) produces one flat Markdown or JSON file: numbered steps, quotes and a guardrail list. That is too thin for a developer, or an internal AI, building an automation. It has no picture of the flow, no data moving between systems, no list of systems, and no clear "stop here and ask a person".

The new export is a **zip of a folder** (Markdown files plus Mermaid diagrams) that an internal AI can load as a skill and a developer can read as a specification.

## 2. Goals, non-goals, anti-goals

**Goals**
- One click on the Mapping page downloads `<workflow-name>.zip`.
- The folder explains what the expert did, in what order, in which systems, with what data, which choices they made and why, and where a person must take over.
- Diagrams render on GitHub and in any Mermaid viewer without changes.
- `SKILL.md` is the entry point and has a **Context** section that says what this is, where it came from and how to use it.

**Non-goals for now**
- No new AI (Gemini) call. The export only rearranges data the app already saved.
- No new server route. The zip is built in the browser from the workflow the page already has loaded.
- No storing of past export versions, no hosting the skill, no MCP server.
- No state diagrams (the app doesn't record a record's status changes).
- No guessing which systems have an API.

**Anti-goals (would make it a failure even if it works)**
- Inventing facts. Anything not captured is written as "not recorded" or listed in `open-questions.md`, never filled in.
- Leaking personal data. Every text goes through the existing `redact()`.
- A complicated feature. Target: one new file of plain functions, one small change to the export dialog, one small dependency.

## 3. What goes in the zip, and where each part comes from

Data sources (all on the `WorkflowRecord` the Mapping page already loads, see `src/lib/types.ts`):
- `record.name`, `record.createdAt`, `record.id`
- `map.task`, `map.confirmed`, `map.published`, `map.processBuiltAt`, `map.gaps`, `map.offRecord`
- per step (`WorkMapStep`): `order`, `title`, `short`, `time`, `screenshot`, `review`, `correction`, `decision`, `reason`, `expertQuote`, `guardrails`
- per step, from the process map (`step.process`, only if `/process` was built): `tool`, `inputs[{name, source}]`, `outputs`, `feedsInto`, `decision`, `unknown`
- `trainedBy` is on the workflow summary (vault list), not on the record. Passed in when the page has it, otherwise "not recorded".
- Rule types (LIMIT, RULE, EXCEPTION, STOP) from the existing `guardrailType()` in `WorkMapView.tsx`.
- Corrected steps: the Mapping page already builds `finalSteps` (a step marked wrong uses its correction as its title). The export uses those.

```
<workflow-slug>/
├─ SKILL.md
├─ flow.md
├─ steps/01-<short>.md … NN-<short>.md
├─ rules.md
├─ data.md
├─ systems.md
├─ handoffs.md
├─ open-questions.md
├─ examples/recorded-run.md
├─ screenshots/01.jpg … NN.jpg
└─ workflow.json
```

| # | File | Requirement | Comes from |
|---|---|---|---|
| R1 | `SKILL.md` | Front matter: `name` (slug), `description` ("Use when …" built from the task name). Sections: **Context**, **Outcome**, **Steps at a glance** (one line each), **How to use this folder** (what each file is for), **Version**. | `record.name`, `map.task`, step titles |
| R1a | `SKILL.md` › Context | What this is ("a recording of how an experienced employee does this task, checked by them"), who recorded it and when, whether the expert confirmed and published it, whether the process map was built, number of steps, systems used, off-the-record gaps, and the rule: *follow the steps; when a STOP rule applies or something isn't covered, hand over to a person; never guess what open-questions.md lists.* | `trainedBy`, `createdAt`, `confirmed`, `published`, `processBuiltAt`, `offRecord`, distinct `process.tool` |
| R1b | `SKILL.md` › Version | Workflow id, recorded date, process map date, export date, Torchbearer export format version (`1`). | `record.id`, `createdAt`, `processBuiltAt`, now |
| R2 | `flow.md` | Mermaid `flowchart TD`: one node per step in order. A step with a judgment call gets a decision diamond with its decision text. Steps with a STOP rule get an edge to a "Hand to a person" node. Below the diagram, the same flow as a numbered list. | step order, `title`/`short`, `decision`, `guardrails` + `guardrailType` |
| R3 | `steps/NN-<short>.md` | One file per step: Goal (title), Where (tool), Needs (inputs and their source), What the expert did (seen on screen), Produces (outputs), Used by (later steps), Decision and why, Expert's words, Rules (with type), Corrected by expert (if any), Screenshot (relative link), Not clear yet (unknowns). Missing parts say "not recorded". | `WorkMapStep` + `step.process` |
| R4 | `rules.md` | Table: Rule, Type, Step, Why (reason), Expert's words. STOP rules listed first. | `guardrails`, `guardrailType`, `reason`, `expertQuote` |
| R5 | `data.md` | Mermaid `flowchart LR` of data: an edge from step A to step B for every `feedsInto`, labelled with A's outputs. External sources ("from the supervisor", "from the receipt") shown as their own nodes feeding the step. Then a table: Data, Comes from, Used in step. If no process map: one line saying "Build the process map on /process to fill this in". | `process.inputs`, `outputs`, `feedsInto` |
| R6 | `systems.md` | One row per distinct tool: Tool, Steps done there, What is done there (step titles). Plus a Mermaid `sequenceDiagram` with the expert and each tool as participants, one message per step. | `process.tool`, step titles |
| R7 | `handoffs.md` | Every STOP rule (when to stop, which step), every off-the-record gap, and the general rule "if anything in open-questions.md comes up, ask a person". "To whom" is written as "not recorded" unless a rule names someone. | STOP guardrails, `offRecord` |
| R8 | `open-questions.md` | `map.gaps`, each step's `process.unknown` (with its step), and steps marked wrong without a correction. Heading tells the AI not to guess these. | `gaps`, `process.unknown`, `review`/`correction` |
| R9 | `examples/recorded-run.md` | The one case the expert actually did: each step's time, what was seen and the screenshot. Labelled as the reference run an automation should reproduce. | `time`, `decision` (seen), `screenshot` |
| R10 | `screenshots/NN.jpg` | Each step's screenshot decoded from its data URL. Skipped when a step has none. | `screenshot` |
| R11 | `workflow.json` | The same content for code: task, version block, steps with process fields and typed rules, open questions. | everything above |
| R12 | Download | In the existing **Export for AI agents** dialog, a third format: "Skill folder (.zip) · for automation". Downloads `<workflow-slug>.zip`. The current Markdown and JSON options stay. | `ExportDialog.tsx` |
| R13 | Safety | All text through `redact()`. Mermaid labels escaped (quotes, brackets, line breaks) so a step title can't break a diagram. No names of people other than `trainedBy`. | `src/lib/redact.ts` |

## 4. Plan (keep it simple)

1. **One new file** `src/features/workmap/skillFolder.ts` with plain functions: `buildSkillFolder(record, steps, trainedBy?) → { [path]: string | Uint8Array }`, plus one small function per file (`skillMd`, `flowMd`, `stepMd`, …) and a `mermaidLabel()` escaper. No React, no network.
2. **Zip** with [`fflate`](https://www.npmjs.com/package/fflate) (`zipSync`): one small dependency, no streaming code. The browser downloads the result with the existing `downloadText`-style object URL.
3. **Dialog**: add the third format to `ExportDialog.tsx`. Its preview shows `SKILL.md`. The page passes the record's `id`, `name`, `createdAt` and `trainedBy` (it already has the map and `finalSteps`).
4. **Remove "Paul"**: the current Markdown and JSON exports hard-code "Paul Adler". Replace with role words while touching this code.
5. **Check by hand** (no test setup on `aws` yet): export the demo workflow with and without a process map; unzip; open on GitHub (or a Mermaid viewer) and check every diagram renders; check a step title with quotes and brackets; check no email or card number appears.

Rough size: about 200 lines in `skillFolder.ts`, about 20 lines in the dialog, one dependency.

## 5. Order of work

| PR | Contents |
|---|---|
| this one | this document only |
| next | R1, R2, R3, R4, R10, R12, R13: the folder with SKILL.md, flow, steps, rules, screenshots, and the zip download |
| after | R5, R6, R7, R8, R9, R11: data, systems, handoffs, open questions, example run, JSON |

## 6. Calls made in this plan (check these)

- Built in the browser, not on the server: the page already has the whole workflow, so no new route or permissions.
- `fflate` for the zip, chosen for size and a one-function API.
- The zip lives inside the existing export dialog, not as a new button elsewhere.
- Screenshots are included by default. A workflow with screenshots is about 0.5 MB zipped.
- `WorkMapStep.decision` holds what was seen on screen in the new capture flow (the process map route labels it "seen"); `process.decision` holds the judgment call. To confirm while building.
- A Mermaid state diagram is left out, because the app doesn't record status changes.
