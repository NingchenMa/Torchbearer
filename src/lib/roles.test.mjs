// Tests for who may do what. Run with: npm test   (Node's built-in test runner; Node 22.18+ reads .ts files directly)
//   1. the rule table in roles.ts (admin, manager, employee; owners; old workflows with no owner)
//   2. where an assignment stands (assignmentStatus.ts)
//   3. a guard that every API route still checks who is calling, and the permission it is meant to
// What this does NOT prove: that a route calls the right rule on the right data. That is checked by running the
// app (docs/formats.md lists the rules). Guard 3 only catches a check being deleted by accident.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROLE_LABEL,
  canAssign,
  canDeleteWorkflow,
  canManageAccess,
  canManageWorkflow,
  canReviewWorkflow,
  canSeeAllWorkflows,
  isManager,
  ownsWorkflow,
} from "./roles.ts";
import { STATE_RANK, dueText, isDone, stateOf } from "./assignmentStatus.ts";

const admin = { id: "u-admin", role: "admin" };
const manager = { id: "u-manager", role: "manager" };
const sarah = { id: "u-sarah", role: "employee" };
const alex = { id: "u-alex", role: "employee" };
const mine = { ownerId: "u-sarah" }; // recorded by Sarah
const ownerless = {}; // saved before owners existed

// ---------- 1. rules ----------

test("admins and managers are managers; employees are not", () => {
  assert.equal(isManager("admin"), true);
  assert.equal(isManager("manager"), true);
  assert.equal(isManager("employee"), false);
});

test("a workflow belongs to whoever recorded it, and an empty owner belongs to nobody", () => {
  assert.equal(ownsWorkflow(sarah, mine), true);
  assert.equal(ownsWorkflow(alex, mine), false);
  assert.equal(ownsWorkflow(sarah, ownerless), false);
  assert.equal(ownsWorkflow({ id: "", role: "employee" }, { ownerId: "" }), false); // "" must never match ""
});

test("managers and admins open, edit and review any workflow, even one with no owner", () => {
  for (const who of [admin, manager]) {
    assert.equal(canManageWorkflow(who, mine), true);
    assert.equal(canManageWorkflow(who, ownerless), true);
  }
});

test("an employee opens only their own workflow", () => {
  assert.equal(canManageWorkflow(sarah, mine), true);
  assert.equal(canManageWorkflow(alex, mine), false);
  assert.equal(canManageWorkflow(sarah, ownerless), false);
});

test("reviewing a workflow follows the same rule as opening it", () => {
  assert.equal(canReviewWorkflow, canManageWorkflow);
});

test("only managers and admins see everyone's workflows, assign and delete", () => {
  for (const who of [admin, manager]) {
    assert.equal(canSeeAllWorkflows(who), true);
    assert.equal(canAssign(who), true);
    assert.equal(canDeleteWorkflow(who), true);
  }
  for (const who of [sarah, alex]) {
    assert.equal(canSeeAllWorkflows(who), false);
    assert.equal(canAssign(who), false);
    assert.equal(canDeleteWorkflow(who), false);
  }
});

test("only an admin manages access", () => {
  assert.equal(canManageAccess(admin), true);
  assert.equal(canManageAccess(manager), false);
  assert.equal(canManageAccess(sarah), false);
});

test("an unknown role gets nothing", () => {
  const odd = { id: "u-odd", role: "owner" };
  assert.equal(isManager(odd.role), false);
  assert.equal(canAssign(odd), false);
  assert.equal(canManageAccess(odd), false);
  assert.equal(canManageWorkflow(odd, mine), false);
});

test("every role has a label", () => {
  assert.deepEqual(Object.keys(ROLE_LABEL).sort(), ["admin", "employee", "manager"]);
});

// ---------- 2. assignment status ----------

const TODAY = "2026-11-12";
const a = (over) => ({ learned: 0, relearn: 0, stepCount: 8, due: undefined, ...over });

test("done needs every step learned, and a workflow with no steps is never done", () => {
  assert.equal(isDone({ learned: 8, stepCount: 8 }), true);
  assert.equal(isDone({ learned: 7, stepCount: 8 }), false);
  assert.equal(isDone({ learned: 0, stepCount: 0 }), false);
});

test("status: done beats overdue, overdue beats relearn, then in progress, then not started", () => {
  assert.equal(stateOf(a({ learned: 8, due: "2026-11-01" }), TODAY), "done");
  assert.equal(stateOf(a({ learned: 3, relearn: 1, due: "2026-11-01" }), TODAY), "late");
  assert.equal(stateOf(a({ learned: 3, relearn: 1, due: "2026-12-01" }), TODAY), "relearn");
  assert.equal(stateOf(a({ learned: 3, due: "2026-12-01" }), TODAY), "progress");
  assert.equal(stateOf(a({ due: "2026-12-01" }), TODAY), "none");
});

test("due today is not overdue, and no date is never overdue", () => {
  assert.equal(stateOf(a({ due: TODAY }), TODAY), "none");
  assert.equal(stateOf(a({ due: "2026-11-11" }), TODAY), "late");
  assert.equal(stateOf(a({}), TODAY), "none");
});

test("what needs attention sorts first", () => {
  const order = Object.entries(STATE_RANK).sort((x, y) => x[1] - y[1]).map(([k]) => k);
  assert.deepEqual(order, ["late", "relearn", "progress", "none", "done"]);
});

test("due text", () => {
  assert.equal(dueText(undefined, TODAY), "No date");
  assert.equal(dueText("2026-11-12", TODAY), "Due today");
  assert.equal(dueText("2026-11-13", TODAY), "Due tomorrow");
  assert.equal(dueText("2026-11-18", TODAY), "Due in 6 days");
  assert.equal(dueText("2026-11-11", TODAY), "1 day overdue");
  assert.equal(dueText("2026-11-10", TODAY), "2 days overdue");
});

// ---------- 3. every API route still checks who is calling ----------

const API = join(fileURLToPath(new URL(".", import.meta.url)), "..", "app", "api");
const routes = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routes(p) : name === "route.ts" ? [p] : [];
  });
const files = routes(API).map((p) => ({ path: p, rel: p.slice(API.length + 1).replaceAll("\\", "/"), src: readFileSync(p, "utf8") }));

test("every API route outside the sign-in flow requires a signed-in user", () => {
  const open = files.filter((f) => !f.rel.startsWith("auth/") || f.rel === "auth/me/route.ts");
  assert.ok(open.length > 10, "found the routes");
  for (const f of open) assert.match(f.src, /requireUser\(/, `${f.rel} must call requireUser()`);
});

// The permission each route is meant to use. If you change a route's rule on purpose, change this table too.
const GUARDS = {
  "members/route.ts": ["canAssign", "canManageAccess"],
  "members/[id]/route.ts": ["canManageAccess"],
  "assignments/route.ts": ["canAssign"],
  "assignments/[id]/route.ts": ["canAssign"],
  "workflows/route.ts": ["canSeeAllWorkflows", "ownsWorkflow"],
  "workflows/[id]/route.ts": ["canManageWorkflow", "canDeleteWorkflow", "openWorkflow"],
  "workflows/[id]/train/route.ts": ["isAssignedTo"],
  "processmap/route.ts": ["openWorkflow"],
  "progress/route.ts": ["isAssignedTo", "canAssign"],
  "reviews/route.ts": ["reviewableBatches", "canReviewWorkflow", "isAssignedTo"],
};

test("routes that need a permission still call it", () => {
  for (const [rel, names] of Object.entries(GUARDS)) {
    const f = files.find((x) => x.rel === rel);
    assert.ok(f, `${rel} exists`);
    for (const n of names) assert.match(f.src, new RegExp(`\\b${n}\\b`), `${rel} must use ${n}`);
  }
});

test("admin-only and manager-only routes check before they do any work", () => {
  // The check must come before anything is read or written: before the first await on storage or Cognito.
  for (const rel of ["members/route.ts", "members/[id]/route.ts", "assignments/route.ts", "assignments/[id]/route.ts"]) {
    const src = files.find((x) => x.rel === rel).src;
    for (const m of src.matchAll(/export async function (POST|PUT|PATCH|DELETE)[\s\S]*?\n\}\n/g)) {
      const body = m[0];
      const gate = body.search(/can(Assign|ManageAccess)\(/);
      const work = body.search(/await (db\.|orgDb|listMembers|readAssignments|createUser|setRole|req\.json)/);
      assert.ok(gate >= 0, `${rel} ${m[1]} checks a permission`);
      assert.ok(work < 0 || gate < work, `${rel} ${m[1]} checks the permission before doing any work`);
    }
  }
});
