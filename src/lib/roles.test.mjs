// Run with: npm test   (Node's built-in test runner; needs Node 22.18+ to read the .ts file)
import test from "node:test";
import assert from "node:assert/strict";
import { roleFromGroups, canViewPage, canCallApi, HOME } from "./roles.ts";

test("role comes from groups; none or unknown means no role", () => {
  assert.equal(roleFromGroups(["learner"]), "learner");
  assert.equal(roleFromGroups(["expert", "learner"]), "expert"); // one role: first by priority
  assert.equal(roleFromGroups(["supervisor", "expert"]), "supervisor");
  assert.equal(roleFromGroups(["admins"]), null);
  assert.equal(roleFromGroups(undefined), null);
  assert.equal(roleFromGroups("expert"), null);
});

test("a new hire only sees Teach", () => {
  assert.ok(canViewPage("learner", "/teach"));
  for (const p of ["/capture", "/vault", "/map", "/process", "/review"]) assert.equal(canViewPage("learner", p), false, p);
});

test("an expert never needs Teach", () => {
  assert.equal(canViewPage("expert", "/teach"), false);
  for (const p of ["/capture", "/vault", "/map", "/process", "/review", "/map/anything"]) assert.ok(canViewPage("expert", p), p);
});

test("supervisor can open every page; no role opens nothing", () => {
  for (const p of ["/capture", "/vault", "/map", "/process", "/review", "/teach"]) assert.ok(canViewPage("supervisor", p), p);
  assert.equal(canViewPage(null, "/vault"), false);
  assert.equal(canViewPage("expert", "/teachers"), false); // prefix must match whole segment
});

test("every role's home page is one it may open", () => {
  for (const [role, home] of Object.entries(HOME)) assert.ok(canViewPage(role, home), role);
});

test("recording and mapping APIs: expert side only", () => {
  for (const p of ["/api/observe", "/api/vision", "/api/workmap", "/api/processmap"]) {
    assert.ok(canCallApi("expert", p, "POST"), p);
    assert.equal(canCallApi("learner", p, "POST"), false, p);
  }
});

test("coach and progress APIs: learner side only", () => {
  for (const p of ["/api/coach", "/api/progress"]) {
    assert.ok(canCallApi("learner", p, "POST"), p);
    assert.equal(canCallApi("expert", p, "POST"), false, p);
  }
});

test("voice token depends on which agent is asked for", () => {
  assert.equal(canCallApi("learner", "/api/elevenlabs/token", "GET", "role=interviewer"), false);
  assert.equal(canCallApi("learner", "/api/elevenlabs/token", "GET", "?role=tutor"), true);
  assert.equal(canCallApi("expert", "/api/elevenlabs/token", "GET", "role=tutor"), false);
  assert.equal(canCallApi("expert", "/api/elevenlabs/token", "GET", ""), true);
});

test("workflows: all read, only expert side writes; reviews: learners write, expert side reads", () => {
  assert.ok(canCallApi("learner", "/api/workflows", "GET"));
  assert.ok(canCallApi("learner", "/api/workflows/abc", "GET"));
  assert.equal(canCallApi("learner", "/api/workflows/abc", "DELETE"), false);
  assert.equal(canCallApi("learner", "/api/workflows/abc", "PUT"), false);
  assert.ok(canCallApi("expert", "/api/workflows/abc", "PUT"));
  assert.ok(canCallApi("learner", "/api/reviews", "POST"));
  assert.equal(canCallApi("learner", "/api/reviews", "GET"), false);
  assert.ok(canCallApi("expert", "/api/reviews", "GET"));
});

test("unknown API routes and missing role are denied", () => {
  assert.equal(canCallApi("supervisor", "/api/new-thing", "GET"), false);
  assert.equal(canCallApi(null, "/api/workflows", "GET"), false);
});
