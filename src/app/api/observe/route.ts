// POST /api/observe — the screenshot-only Torchbearer's brain. Two modes:
//  "observe"   (screenshots) what the user just did, the updated workflow, and an optional
//              question about something the screenshots alone cannot explain.
//  "integrate" (text only, fast) write the expert's spoken answers into the workflow.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { geminiJson } from "@/lib/gemini";
import { redact, redactDeep } from "@/lib/redact";
import type { ObservedStep, ObserveQA } from "@/lib/types";

// Fast models first: one call per changed screen must take a couple of seconds, not tens.
const MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite"];

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

workflow: the FULL workflow so far, in order. Keep every existing step, its id, why and rule. Add a step only for a new meaningful kind of action; when the expert repeats an earlier kind of action differently, add a step for the difference (e.g. "Attach the extra approval for this one"). Use NOW as time for new steps. Leave why and rule as they are; never invent them.

question: this is what makes you an apprentice, not a recorder. Ask when a new hire watching could NOT work out something important from the screen alone. Pointed, specific to what just happened, one thing at a time. Aim for at least three good questions over a task (count ALREADY ASKED); once you have them, ask only when something is clearly worth it.
Worth asking (best first):
- The decision: why they chose this option, value or document, and what would make them choose differently. If they handled a similar thing differently than before in the ACTION LOG (an extra or missing attachment, a different choice), ask what the difference is for.
- The input: what information or document this step needs and where it comes from, e.g. "Where does that project number come from?" or "What do you check before entering that?"
- What it feeds: how this step affects later steps or other people, e.g. "What happens with this approval later?" or "Who uses this field after you submit?"
- A hidden rule or stop condition: a limit, threshold, exception or approval that decides it, or when they would stop and ask someone.
- A gap in an earlier answer: an answer in ANSWERS SO FAR was vague ("it depends", "usually"). Ask what it depends on.
Not worth asking: how the software works or how they moved around it (which menu, button, gallery or screen they used, whether a field fills itself in, whether they always use a feature: that's the tool, not their judgment), routine form-filling (amounts, names, dates), anything the screen already shows, anything already answered, anything you could guess from common sense. Never repeat an asked question or ask two things at once.
At most 15 words, friendly, about what just happened, e.g. "You added a screenshot to this one but not the first. What's it for?"
If you can't tell what the expert just did, don't guess: action null, question null.
Screenshots can be several seconds apart, so steps may have happened in between that you did not see (for example a gallery or dialog that opened and closed). Never assume a step was skipped or done another way just because you didn't see it, and never ask about it.

Never include personal data (emails, phone, card or bank numbers).`;

const INTEGRATE = `You keep an expert's workflow. The expert just answered questions out loud.
Write each answer into the workflow step it is about:
- "why": the reason, close to the expert's own words (one or two sentences).
- "rule": any limit, exception or stop condition they state, as a short rule (e.g. "Over 30 per person: attach the supervisor's approval (date, amount, who was there)"). null if none.
If an answer describes a rule that applies to a step not in the workflow yet, add that step with the answer's time.
Keep all steps, ids, titles and times. Return JSON only: { "workflow": [ ${STEP_SHAPE} ] }`;

const toPart = (dataUrl: string) => ({
  inlineData: { mimeType: "image/jpeg", data: dataUrl.replace(/^data:image\/\w+;base64,/, "") },
});

interface Body {
  mode?: "observe" | "integrate";
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
function clean(steps: ObservedStep[] | undefined, prev: ObservedStep[]): ObservedStep[] {
  const next = Array.isArray(steps) ? steps.filter((s) => s && typeof s.title === "string") : [];
  const byId = new Map(next.filter((s) => s.id).map((s) => [s.id, s]));
  const kept = prev.map((p) => {
    const n = byId.get(p.id);
    return n ? { ...p, ...n, id: p.id, why: n.why ?? p.why ?? null, rule: n.rule ?? p.rule ?? null } : p;
  });
  const ids = new Set(kept.map((s) => s.id));
  let k = kept.length;
  for (const s of next) {
    if (s.id && ids.has(s.id)) continue;
    let id = s.id || `w${++k}`;
    while (ids.has(id)) id = `w${++k}`;
    ids.add(id);
    kept.push({ ...s, id, why: s.why ?? null, rule: s.rule ?? null });
  }
  return kept;
}

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof Response) return u;
  const body = (await req.json()) as Body;
  const { workflow, qa, asked, now } = body;

  if (body.mode === "integrate") {
    const text = redact(`NOW: ${now}\n\nWORKFLOW:\n${JSON.stringify(workflow)}\n\nQUESTIONS AND THE EXPERT'S ANSWERS:\n${qa.map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n\n")}`);
    const r = await geminiJson<{ workflow?: ObservedStep[] }>(INTEGRATE, [{ text }], MODELS);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ workflow: clean(redactDeep(r.data).workflow, workflow) });
  }

  const context = redact(
    `NOW: ${now}\n\nACTION LOG:\n${(body.actions ?? []).map((a) => `${a.time} ${a.text}`).join("\n") || "(nothing yet)"}\n\nWORKFLOW SO FAR:\n${JSON.stringify(workflow)}\n\nALREADY ASKED (do not repeat):\n${asked.join("\n") || "(none)"}\n\nANSWERS SO FAR:\n${qa.map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n") || "(none)"}`,
  );
  const parts = [
    { text: context },
    ...(body.previous ? [{ text: "PREVIOUS screenshot:" }, toPart(body.previous)] : []),
    { text: "CURRENT screenshot:" },
    toPart(body.frame ?? ""),
  ];
  const r = await geminiJson<{ action?: string | null; workflow?: ObservedStep[]; question?: string | null }>(OBSERVE, parts, MODELS);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

  const out = redactDeep(r.data);
  return NextResponse.json({
    action: out.action ?? null,
    workflow: clean(out.workflow, workflow),
    question: out.question && !asked.includes(out.question) ? out.question : null,
  });
}
