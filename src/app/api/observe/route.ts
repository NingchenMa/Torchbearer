// POST /api/observe — the screenshot-only Torchbearer's brain. Three modes:
//  "observe"   (screenshots) what the user just did, the updated workflow, and an optional
//              question about something the screenshots alone cannot explain.
//  "integrate" (text only, fast) write the expert's spoken answers into the workflow.
//  "tidy"      (text only, once at Stop) drop steps about Torchbearer itself, steps that were never
//              actually done, and exact duplicates; the level of detail stays as recorded.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { geminiJson } from "@/lib/gemini";
import { redact, redactDeep } from "@/lib/redact";
import type { ObservedStep, ObserveQA } from "@/lib/types";

// Marks what the expert said on their own, without a question (kept in step with useObserver.ts).
const NARRATION = "(The expert explained this while working, without being asked.)";

// Fast models first: one call per changed screen must take a couple of seconds, not tens.
// Measured 2026-11-10 on real screenshots: 3.1 Flash Lite with minimal thinking answers in about 1.5-4 s and
// describes the action well; gemini-3.5-flash was out of quota (429) on every call.
const MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash"];

const STEP_SHAPE = `{ "id": "w1", "title": string, "detail": string, "why": string | null, "rule": string | null, "time": "mm:ss" }`;

const OBSERVE = `You are an apprentice watching an expert do a task on their screen, one screenshot every few seconds.
Your job: write down the expert's workflow as it happens, and notice what the screenshots alone cannot explain.
Ignore the browser's own bars and any small floating "Torchbearer" window; look only at the app the expert works in.
Torchbearer itself is never part of the workflow: its pages (Teaching, Workflows, Training), launching it, and starting or stopping a recording are not steps, and switching to or from it is not an action (action null).

You get the PREVIOUS screenshot (if any), the CURRENT screenshot, the ACTION LOG (what the expert did so far), the WORKFLOW so far, the questions ALREADY ASKED, and the ANSWERS SO FAR.

Return JSON only:
{
  "action": string | null,
  "workflow": [ ${STEP_SHAPE} ],
  "question": string | null
}

action: one sentence on what the expert did between PREVIOUS and CURRENT, with the specifics a colleague would need: which record or item, key values, and the NAMES of any documents attached or removed (e.g. "Saved record 4471 with two attachments: the receipt and an approval screenshot"). null if nothing meaningful changed (scrolling, mouse moves, typing in progress).

workflow: the FULL workflow so far, in order. Keep every existing step, its id, why and rule. Add a step only for a new meaningful kind of action; when the expert repeats an earlier kind of action differently, add a step for the difference (e.g. "Attach the extra approval for this one"). Use NOW as time for new steps. Only write what you can see on the screen: never a step for something you didn't see (saving a file somewhere, an upload, a reply). why and rule come only from the expert's own words: always leave them as they are (null for a new step), never write them yourself.

question: this is what makes you an apprentice, not a recorder. Ask when a new hire watching could NOT work out something important from the screen alone. Pointed, specific to what just happened, one thing at a time. Ask whenever something important is unclear or you lack context to explain this step to a new hire; there is no fixed number, and a typical task needs a question every step or two.
Worth asking (best first):
- The decision: why they chose this option, value or document, and what would make them choose differently. If they handled a similar thing differently than before in the ACTION LOG (an extra or missing attachment, a different choice), ask what the difference is for.
- The input: what information or document this step needs and where it comes from, e.g. "Where does that project number come from?" or "What do you check before entering that?"
- What it feeds: how this step affects later steps or other people, e.g. "What happens with this approval later?" or "Who uses this field after you submit?"
- A hidden rule or stop condition: a limit, threshold, exception or approval that decides it, or when they would stop and ask someone.
- Missing context: what the task is for, what starts it, or a term, code or system name nobody has explained.
- A gap in an earlier answer: an answer in ANSWERS SO FAR was vague ("it depends", "usually"). Ask what it depends on.
Not worth asking: how the software works or how they moved around it (which menu, button, gallery or screen they used, whether a field fills itself in, whether they always use a feature: that's the tool, not their judgment), routine form-filling (amounts, names, dates), anything the screen already shows, anything already answered, anything you could guess from common sense. Never repeat an asked question or ask two things at once.
At most 15 words, friendly, about what just happened, e.g. "You added a screenshot to this one but not the first. What's it for?"
If you can't tell what the expert just did, don't guess: action null, question null.
Stay on the TASK BEING TAUGHT. Screens that are not part of it are not steps: chat or social apps, personal browsing, email or documents unrelated to the task, the desktop, system settings, and Torchbearer's own pages (its vault, recorder, Teaching or Training tabs). For those: action null, no new step, no question. If the expert comes back to the task, carry on.
Secrets: never write a password, login, access code or other credential into an action or a step. If the expert looks one up, write the step as "Look up the login for <system>" with no value, and never ask about its value.
Screenshots can be several seconds apart, so steps may have happened in between that you did not see (for example a gallery or dialog that opened and closed). Never assume a step was skipped or done another way just because you didn't see it, and never ask about it.

Never include personal data (emails, phone, card or bank numbers).`;

const INTEGRATE = `You keep an expert's workflow. The expert just spoke: answers to questions, or (marked "${NARRATION}") their own explanation while working.
Write what they said into the workflow step it is about (usually the latest step, or the one whose subject they name):
- "why": the reason, close to the expert's own words (one or two sentences).
- "rule": any limit, exception or stop condition they state, as a short rule (e.g. "Over 5,000 USD: get an asset number from the finance manager"). null if none.
Only use what the expert actually said. If they gave no reason for a step, leave its why as it is (null stays null); never write a reason yourself.
What they WOULD do in another case ("if the account didn't match I'd email the supplier") is a rule on the step it belongs to, never a new step. Add a step only when they say they did something the workflow is missing.
Keep all steps, ids, titles and times. Return JSON only: { "workflow": [ ${STEP_SHAPE} ] }`;

const TIDY = `You clean up a workflow that was written live while an expert worked, before the expert checks it. Keep its level of detail: do not merge or reword steps except as below.
1. Drop steps that are about Torchbearer itself (opening, launching or signing in to it, starting or stopping a recording, switching to or from it) and steps that only navigate (switching tabs, scrolling) with no work done.
2. Drop a step that describes something the expert only said they would do in another case (e.g. "Handle mismatch: if the details don't match, email the supplier"); its rule is kept on the step before it for you.
3. Merge only true duplicates: two steps that are the same check or action on the same thing (e.g. "Check purchase orders" right after "Verify the purchase order").
Each output step lists in "from" the ids of the input steps it replaces, in order (a kept step lists only its own id). A dropped step appears in no "from". Never invent a step, a reason or a rule: why and rule are handled for you, so write only title and detail. Keep a kept step's title and detail as they are.
Return JSON only: { "steps": [ { "from": [string], "title": string, "detail": string } ] }`;

const toPart = (dataUrl: string) => ({
  inlineData: { mimeType: "image/jpeg", data: dataUrl.replace(/^data:image\/\w+;base64,/, "") },
});

interface Body {
  mode?: "observe" | "integrate" | "tidy";
  task?: string; // the workflow name the expert gave
  role?: string; // the expert's role, e.g. "Accounts payable"
  frame?: string;
  previous?: string | null;
  workflow: ObservedStep[];
  actions?: { time: string; text: string }[];
  qa: ObserveQA[];
  asked: string[];
  now: string;
}

// The model rewrites the whole workflow on every frame and sometimes leaves steps (or their
// why/rule) out. Never lose what was already recorded: keep every earlier step in place, take the
// model's update of it, keep an earlier why/rule it dropped, and add only genuinely new steps.
// why and rule are the expert's words: only the "integrate" call (which hears them) may write them.
// The screen-reading call keeps what was there and leaves new steps without them, whatever the model returned.
function clean(steps: ObservedStep[] | undefined, prev: ObservedStep[], fromSpeech = false): ObservedStep[] {
  const next = Array.isArray(steps) ? steps.filter((s) => s && typeof s.title === "string") : [];
  const byId = new Map(next.filter((s) => s.id).map((s) => [s.id, s]));
  const kept = prev.map((p) => {
    const n = byId.get(p.id);
    if (!n) return p;
    return fromSpeech ? { ...p, ...n, id: p.id, why: n.why ?? p.why ?? null, rule: n.rule ?? p.rule ?? null } : { ...p, ...n, id: p.id, why: p.why ?? null, rule: p.rule ?? null };
  });
  const ids = new Set(kept.map((s) => s.id));
  let k = kept.length;
  for (const s of next) {
    if (s.id && ids.has(s.id)) continue;
    let id = s.id || `w${++k}`;
    while (ids.has(id)) id = `w${++k}`;
    ids.add(id);
    kept.push({ ...s, id, why: fromSpeech ? (s.why ?? null) : null, rule: fromSpeech ? (s.rule ?? null) : null });
  }
  return kept;
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const body = (await req.json()) as Body;
  const { workflow, qa, asked, now } = body;

  const about = `TASK BEING TAUGHT: ${body.task || "(not named)"}${body.role ? `\nTHE EXPERT'S ROLE: ${body.role}` : ""}`;

  if (body.mode === "tidy") {
    if (workflow.length < 2) return NextResponse.json({ steps: workflow.map((s) => ({ from: [s.id], title: s.title, detail: s.detail })) });
    const text = redact(`${about}\n\nWORKFLOW:\n${workflow.map((s) => `[${s.id}] ${s.time} ${s.title}: ${s.detail}${s.why ? ` | expert said why: ${s.why}` : ""}${s.rule ? ` | rule: ${s.rule}` : ""}`).join("\n")}`);
    const r = await geminiJson<{ steps?: { from?: string[]; title?: string; detail?: string }[] }>(TIDY, [{ text }], MODELS);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    // Every id at most once, only ids that exist, order kept as the model gave it.
    const ids = new Set(workflow.map((s) => s.id));
    const byId = new Map(workflow.map((s) => [s.id, s]));
    const used = new Set<string>();
    const steps = (redactDeep(r.data).steps ?? [])
      .map((x) => ({ from: (Array.isArray(x.from) ? x.from : []).filter((id) => ids.has(id) && !used.has(id) && used.add(id)), title: String(x.title ?? "").trim(), detail: String(x.detail ?? "").replace(/\s*\|[\s\S]*$/, "").trim() }))
      .filter((x) => x.from.length && x.title)
      // A step that was only kept keeps its own wording: the model is not to reword the expert's steps.
      .map((x) => (x.from.length === 1 ? { ...x, title: byId.get(x.from[0])!.title, detail: byId.get(x.from[0])!.detail } : x));
    if (!steps.length) return NextResponse.json({ error: "Empty tidy result" }, { status: 502 });
    return NextResponse.json({ steps });
  }

  if (body.mode === "integrate") {
    const text = redact(`${about}\nNOW: ${now}\n\nWORKFLOW:\n${JSON.stringify(workflow)}\n\nQUESTIONS AND THE EXPERT'S ANSWERS:\n${qa.map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n\n")}`);
    const r = await geminiJson<{ workflow?: ObservedStep[] }>(INTEGRATE, [{ text }], MODELS);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ workflow: clean(redactDeep(r.data).workflow, workflow, true) });
  }

  const context = redact(
    `${about}\nNOW: ${now}\n\nACTION LOG:\n${(body.actions ?? []).map((a) => `${a.time} ${a.text}`).join("\n") || "(nothing yet)"}\n\nWORKFLOW SO FAR:\n${JSON.stringify(workflow)}\n\nALREADY ASKED (do not repeat):\n${asked.join("\n") || "(none)"}\n\nANSWERS SO FAR:\n${qa.map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n") || "(none)"}`,
  );
  const parts = [
    { text: context },
    ...(body.previous ? [{ text: "PREVIOUS screenshot:" }, toPart(body.previous)] : []),
    { text: "CURRENT screenshot:" },
    toPart(body.frame ?? ""),
  ];
  // A stalled model gets about 8 s before the next one is tried (the default share waited up to 15 s).
  const r = await geminiJson<{ action?: string | null; workflow?: ObservedStep[]; question?: string | null }>(OBSERVE, parts, MODELS, undefined, 0.3);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

  const out = redactDeep(r.data);
  return NextResponse.json({
    action: out.action ?? null,
    workflow: clean(out.workflow, workflow),
    question: out.question && !asked.includes(out.question) ? out.question : null,
  });
}
