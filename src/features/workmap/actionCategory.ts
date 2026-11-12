// What kind of action a step is, so the process map can group steps by action as well as by tool.
// The process map build asks Gemini for it (step.process.action); steps without one (not built yet,
// added by hand, or built before this existed) are sorted by keywords in their title and notes.
import type { WorkMapStep } from "@/lib/types";

export const ACTIONS = [
  { name: "Find and open", color: "#2f5d8a", words: /\b(open|go to|navigate|search|find|look ?up|log ?in|sign ?in|launch|browse|select|choose|pick|click|start|create|new)\b/ },
  { name: "Enter data", color: "#b8650a", words: /\b(enter|fill|type|input|write|add|edit|update|change|set|record|copy|paste|name|amount|date|field|header|details?)\b/ },
  { name: "Check and decide", color: "#0f766e", words: /\b(check|verify|review|confirm|compare|make sure|ensure|validate|decide|approve|reject|inspect|read)\b/ },
  { name: "Attach files", color: "#6b4e3d", words: /\b(attach|upload|scan|receipt|document|file|screenshot|photo|pdf)\b/ },
  { name: "Submit and send", color: "#a4161a", words: /\b(submit|send|save|finish|complete|file the|forward|share|email|notify|request|post)\b/ },
] as const;

// First words of a step title that say plainly what kind of action it is.
const VERBS: Record<string, string[]> = {
  "Find and open": ["open", "go", "navigate", "search", "find", "look", "log", "sign", "launch", "browse", "start", "create", "access", "visit"],
  "Enter data": ["enter", "fill", "type", "input", "write", "add", "edit", "update", "change", "set", "record", "copy", "paste", "name", "select", "choose", "pick"],
  "Check and decide": ["check", "verify", "review", "confirm", "compare", "ensure", "validate", "decide", "approve", "reject", "inspect"],
  "Attach files": ["attach", "upload", "scan"],
  "Submit and send": ["submit", "send", "save", "finish", "complete", "forward", "share", "email", "notify", "request", "post"],
};

export const OTHER_ACTION = { name: "Other", color: "#5a1220" };
export const ACTION_NAMES: string[] = ACTIONS.map((a) => a.name);

/** The action category of a step: the model's label when it gave a known one, otherwise a keyword guess. */
export function actionOf(s: WorkMapStep): string {
  const title = s.title.toLowerCase();
  // Step titles start with what was done ("Attach the receipt"): a clear first verb wins.
  const verb = title.match(/^[a-z]+/)?.[0] ?? "";
  const byVerb = Object.entries(VERBS).find(([, words]) => words.includes(verb))?.[0];
  if (byVerb) return byVerb;
  const given = s.process?.action;
  if (given && ACTION_NAMES.includes(given)) return given;
  // The title says what was done; check it first, from the most specific category to the most general.
  const order = ["Submit and send", "Attach files", "Check and decide", "Enter data", "Find and open"];
  for (const name of order) if (ACTIONS.find((a) => a.name === name)!.words.test(title)) return name;
  const rest = `${s.correction ?? ""} ${s.decision} ${s.reason}`.toLowerCase();
  for (const name of order) if (ACTIONS.find((a) => a.name === name)!.words.test(rest)) return name;
  return OTHER_ACTION.name;
}

export function actionColor(name: string): string {
  return ACTIONS.find((a) => a.name === name)?.color ?? OTHER_ACTION.color;
}
