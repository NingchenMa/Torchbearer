// Roles and the access rules built on them. Pure functions with no server code, so the server routes
// (which enforce the rules) and the pages (which only decide what to show) use the same ones.
//
//   admin     everything a manager can do
//   manager   sees every workflow in the company; reviews, assigns and deletes
//   employee  everyone else: sees only workflows they recorded, and the work assigned to them
//
// A person's role comes from their Cognito group (see userFromToken in auth.ts); no group means employee.

export type Role = "admin" | "manager" | "employee";

/** The part of a user these rules need. */
export interface Actor {
  id: string;
  role: Role;
}

/** Managers and admins see and do everything in their company. */
export const isManager = (role: Role) => role === "admin" || role === "manager";

/** A workflow belongs to whoever recorded it. Workflows saved before owners existed have none. */
export interface Owned {
  ownerId?: string;
}

export const ownsWorkflow = (who: Actor, w: Owned) => !!w.ownerId && w.ownerId === who.id;

/** Open, edit and approve a workflow, its Work Map and its Process map. */
export const canManageWorkflow = (who: Actor, w: Owned) => isManager(who.role) || ownsWorkflow(who, w);

/** Which workflows appear in someone's list. */
export const canSeeAllWorkflows = (who: Actor) => isManager(who.role);

export const canDeleteWorkflow = (who: Actor) => isManager(who.role);

/** Give workflows to other employees to train on. */
export const canAssign = (who: Actor) => isManager(who.role);

/** Review the practice sessions on a workflow: managers on any, a recorder on their own. */
export const canReviewWorkflow = canManageWorkflow;

export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", manager: "Manager", employee: "Employee" };
