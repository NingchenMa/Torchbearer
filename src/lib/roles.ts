// Who may open which page and call which API. Pure functions, no imports, so the proxy,
// the API routes, the nav and the tests all use the same rules.
// A person has exactly one role, set as a Cognito group (see scripts/invite-user.sh).
// If someone is in several groups, the first match in ROLES wins.

export const ROLES = ["supervisor", "expert", "learner"] as const;
export type Role = (typeof ROLES)[number];

/** The role from the ID token's `cognito:groups` claim, or null (no role = no access). */
export function roleFromGroups(groups: unknown): Role | null {
  if (!Array.isArray(groups)) return null;
  return ROLES.find((r) => groups.includes(r)) ?? null;
}

/** Where each role lands after sign-in, and where a blocked page sends them. */
export const HOME: Record<Role, string> = {
  expert: "/capture",
  learner: "/teach",
  supervisor: "/vault",
};

// Page prefixes each role may open. Learners only train; experts record, check and approve;
// supervisors can open everything.
const PAGES: Record<Role, string[]> = {
  learner: ["/teach"],
  expert: ["/capture", "/vault", "/map", "/process", "/review"],
  supervisor: ["/capture", "/vault", "/map", "/process", "/review", "/teach"],
};

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");

export function canViewPage(role: Role | null, pathname: string): boolean {
  return !!role && PAGES[role].some((p) => under(pathname, p));
}

const EXPERT_SIDE: Role[] = ["expert", "supervisor"]; // recording, mapping, approving
const LEARNER_SIDE: Role[] = ["learner", "supervisor"]; // training
const EVERYONE: Role[] = ["expert", "learner", "supervisor"];

/** Roles allowed to call an API route. `search` is the query string (the voice token depends on it). */
export function apiRoles(pathname: string, method: string, search = ""): Role[] {
  const m = method.toUpperCase();
  const read = m === "GET" || m === "HEAD";
  if (under(pathname, "/api/auth")) return EVERYONE;
  if (["/api/observe", "/api/vision", "/api/workmap", "/api/processmap"].some((p) => under(pathname, p))) return EXPERT_SIDE;
  if (["/api/coach", "/api/progress"].some((p) => under(pathname, p))) return LEARNER_SIDE;
  if (under(pathname, "/api/elevenlabs/token")) {
    return new URLSearchParams(search).get("role") === "tutor" ? LEARNER_SIDE : EXPERT_SIDE;
  }
  // Learners read workflows (the route returns only approved ones); only experts and supervisors change them.
  if (under(pathname, "/api/workflows")) return read ? EVERYONE : EXPERT_SIDE;
  // Learners file differences found while training; experts and supervisors read and decide.
  if (under(pathname, "/api/reviews")) return read ? EXPERT_SIDE : EVERYONE;
  return []; // unknown routes: nobody, until added here
}

export const canCallApi = (role: Role | null, pathname: string, method: string, search = "") =>
  !!role && apiRoles(pathname, method, search).includes(role);
