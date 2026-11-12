// Coach verdict checks: a verdict is kept only when it points to a real step of the expert, and a
// "different" only when it is grounded in the expert's own words (a why or rule on that step).
// A different value or choice with no stated reason behind it is just a different case, not a mistake.

export type Step = { id: string; title: string; detail: string; why: string; rule: string };
export type RuleCheck = { stepId?: string; rule?: string; applies?: boolean; met?: boolean; why?: string };
export type Out = { action?: string | null; stepId?: string | null; verdict?: string; basis?: string | null; message?: string | null; nextHint?: string | null; saved?: boolean; rules?: RuleCheck[] };

const norm = (s: string) => s.toLowerCase().replace(/[“”"'‘’`]/g, "").replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/, "");

/** True when `quote` really is (word for word) part of the step's why or rule. */
export function groundedIn(quote: string | null | undefined, step: Step | undefined): boolean {
  if (!quote || !step) return false;
  const q = norm(quote);
  const source = norm(`${step.why} \n ${step.rule}`);
  return q.length >= 6 && source.length > 0 && source.includes(q);
}

/** The model's verdict, kept only when it points to a real step and, for "different", to the expert's own words. */
export function checkVerdict(out: Out, steps: Step[]): { verdict: "match" | "different" | "none"; stepId: string | null; message: string | null } {
  const step = steps.find((s) => s.id === out.stepId);
  let verdict: "match" | "different" | "none" = out.verdict === "match" || out.verdict === "different" ? out.verdict : "none";
  let stepId = step?.id ?? null;
  let message = out.message?.trim() || null;
  if (!step) verdict = "none"; // an action we can't tie to one of the expert's steps gets no verdict
  if (verdict === "different" && !groundedIn(out.basis, step)) verdict = "none"; // a different value, not a broken reason or rule

  // A save that breaks one of the expert's rules is never "looks right", whatever the verdict said,
  // but only for a rule the expert really has (the model must copy it, not invent one).
  const broken = out.saved && Array.isArray(out.rules) ? out.rules.find((x) => x?.applies === true && x?.met === false && x.rule) : undefined;
  if (broken && verdict !== "different") {
    const ruleStep = steps.find((s) => s.id === broken.stepId && groundedIn(broken.rule, s)) ?? steps.find((s) => groundedIn(broken.rule, s));
    if (ruleStep) {
      verdict = "different";
      stepId = ruleStep.id;
      message = `That one isn't quite right yet: your expert's rule is "${broken.rule}".${broken.why ? ` ${broken.why}` : ""} Fix it before you move on.`;
    }
  }
  return { verdict, stepId: verdict === "none" ? (step?.id ?? null) : stepId, message: verdict === "none" ? null : message };
}
