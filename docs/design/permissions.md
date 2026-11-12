# Permissions: who can see and do what

Status: draft for discussion. This describes how access will differ by role. It changes behaviour, not the look of the product. The visual design stays as in `workflow-hub.html`, except for the Training and navigation changes in section 6.

## 1. Roles

There are three kinds of access. Every signed-in person has exactly one role.

| Role | Who it is | In one line |
|---|---|---|
| **Admin** | Runs the company's Torchbearer workspace | Everything a manager can do (see open question 1 for anything extra) |
| **Manager** | Supervises new hires | Sees every workflow in the company, reviews and assigns work |
| **Employee** | Everyone else: new hires in training, and experts who record workflows | Sees only their own workflows and what is assigned to them |

An Employee has no separate "expert" or "learner" role. The same person can be both: they train on workflows assigned to them, and they own the workflows they recorded. What they can touch depends on **ownership** (who recorded the workflow), not on a second role.

Everyone stays inside their own company. Roles apply within a company and never cross companies, exactly as today.

## 2. Summary

| Area | Admin / Manager | Employee |
|---|---|---|
| Workflows: see everyone's workflows | Yes | No, only their own |
| Workflows: search by workflow or expert | Yes | No search by expert |
| Workflows: Train a new hire, Work Map, Process map | On any workflow | Only on workflows they recorded |
| Someone else's workflow | Full access | "You lack permission to edit or review this workflow." |
| Reviews | All reviews, all learners | Only reviews assigned to them, else an empty message |
| Assign | Full page | "You lack access to assign workflows to other employees." |
| Training | Their own assigned work | Their own assigned work |

## 3. Workflows page

### Admin and Manager
Same as the current design:
- All workflows in the company, from every expert, newest first.
- Search by workflow name or expert, and the All / Ready to teach / Needs approval filter.
- Summary cards for the whole company.
- Every card action: Train a new hire, View Work Map, Process map, Review and approve, Delete.
- "Record a new workflow".

### Employee
- The list shows **only workflows they recorded**. Other people's workflows are not listed.
- No "search by expert" (there is no one else to search). A plain search by workflow name over their own list is fine and optional.
- Summary cards count only their own workflows.
- On a workflow they recorded, they get **Train a new hire**, **View Work Map** and **Process map**.
- If an Employee has recorded nothing, the page shows the empty state ("No workflows yet…") with the record button.

### Opening a workflow they do not own
An Employee can still end up on someone else's workflow by following a link or typing an address, for example the Work Map or Process map of a colleague's workflow. In that case the page does not load the workflow. It shows:

> You lack permission to edit or review this workflow.

with a link back to Workflows. The same applies if a workflow is deleted or does not exist, to avoid revealing which workflows exist.

## 4. Reviews page

Reviews are the "might differ from the approved way" items raised when a new hire practises a workflow.

### Admin and Manager
All reviews in the company, with the learner and workflow filters, the Fine / Needs correction decisions, notes and Submit review. Same as the current design.

### Employee
Only reviews that are **assigned to them**. A review is assigned to the person who recorded the workflow that the new hire practised (assumption, see open question 4).

- If they have recorded no workflow, or none of their workflows has been assigned to a new hire, or nothing has been flagged yet, the page shows:

  > No reviews are assigned to you.

- If some exist, they see only those, grouped by new hire, and can decide on them like a manager.
- They never see reviews on other people's workflows.

The sidebar count badge on Reviews counts only what the signed-in person can see. For an Employee with nothing assigned, no badge is shown.

## 5. Assign page

### Admin and Manager
Full page as designed: pick a ready workflow, pick employees, set a finish-by date and a note, and track progress, reminders and removals for all assignments.

### Employee
The page does not show the form or the table. It shows:

> You lack access to assign workflows to other employees.

The sidebar item can stay visible so the message is discoverable. Hiding it entirely is also possible; see open question 6.

## 6. Navigation and Training

These two changes apply to the real product for everyone.

- **No Teaching entry in the Modules group of the sidebar.** The Modules group has a single item, **Training**. (The "Record a new workflow" button on the Workflows page stays; see open question 5.)
- **Training shows only what is assigned to the signed-in person.** The "Also ready to teach" section and everything under it is removed. If nothing is assigned, the page says so ("Nothing assigned yet…").
- **The "Sketch only · preview as" dropdown does not ship.** It exists only in the design file so we can preview Training as different new hires while we finalise the design. The real page always shows the signed-in person's own assignments. It stays in `workflow-hub.html` until the design is final.

## 7. How this is enforced (for whoever builds it)

Hiding buttons is not enough: anyone can call the API directly. Every rule above has to be checked on the server too.

What exists today (from the code on the `aws` branch):
- Sign-in is Amazon Cognito. The server knows each person's **email, name and company** (`custom:org`). It has **no role**.
- Every API route calls `requireUser()` and then reads and writes everything under the company's prefix. So today **every signed-in person in a company can see and change everything in it**.
- A workflow records who made it only as a **display name** (`trainedBy`), not a user ID. A name is not safe to base ownership on, because two people can share it.

What is needed:
1. **A role per user.** Store `admin | manager | employee` on the person, for example as a Cognito group or a custom attribute that people cannot edit themselves, and include it in what `requireUser()` returns. New and self-signed-up users default to Employee. Decide who can promote people (open question 2).
2. **An owner on every workflow.** Add the recorder's stable user ID (the Cognito `sub`) to the workflow record when it is saved. Workflows saved before this change have no owner, so they would be visible only to Admins and Managers until someone claims or assigns them (open question 3).
3. **Server-side checks** on each route, returning 403 (or 404 for "does not exist or not yours") when a rule fails:
   - List workflows: Employees get only their own; Admin/Manager get all.
   - Read, update, delete a workflow, build or read its Work Map or Process map: allowed if Admin/Manager or the owner.
   - Reviews: filtered to the items the person may see.
   - Assignments: create, change and remove only for Admin/Manager; an Employee can read only their own.
   - Training and progress: a person reads and writes only their own progress.
4. **The page asks the server who it is.** The existing "who am I" call (`/api/auth/me`) also returns the role, and the pages choose which view to show from it. The message screens in sections 3 to 5 are the pages' response to a 403, not the only guard.

## 8. Open questions

1. **Admin versus Manager.** You described them as having the same access for these pages. Should Admin also do things Manager cannot, such as promoting people to Manager or removing users?
2. **Who sets roles?** Admins only, through an Admin screen, or by hand in Cognito at first?
3. **Existing workflows.** Workflows already recorded have no owner ID. Should they default to "company-owned" (Admin/Manager only), or be matched to people by the name stored today?
4. **Who gets a review?** The plan assumes the person who recorded the workflow. Is that right, or should reviews go to whoever assigned the workflow, or to the learner's manager?
5. **Recording.** Employees record workflows, so "Record a new workflow" should stay on the Workflows page for everyone. With Teaching gone from the sidebar, is that the only way in?
6. **Sidebar for Employees.** Keep Assign visible (showing the "lack access" message) or hide it for Employees?
7. **"Train a new hire" for Employees.** They get this button on their own workflows, but assigning people is Manager-only. What should it do for an Employee: assign only their own workflow, ask a Manager to assign it, or something else?
8. **Approve and delete on their own workflows.** Can an Employee use "Review and approve" and "Delete" on a workflow they recorded, or is approval a Manager decision? The list above only gives them Train a new hire, Work Map and Process map.
9. **What does a learner see about their own reviews?** Nothing in this plan. Today only supervisors see the Reviews page; confirm that stays so.
