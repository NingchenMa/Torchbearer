# Shared data formats

TypeScript source: `src/lib/types.ts`. If you change a format, change both files in the same commit and tell the team.

Times are `"mm:ss"` since the session started. Money is a plain number plus an ISO currency code.

## The work app: Ledgerline

`public/ledgerline/index.html` is the team's fake expense tool (read its header comment for the full API). Only its story data (CONFIG users, DOCS, seed) was changed to follow the demo script: Paul Adler (expert) and Maya Chen (new hire); its storage key is `expense-demo-v2`.
Our app embeds it in an iframe (`src/features/erp/LedgerlineFrame.tsx`, scaled to fit its 1180px minimum) and talks to it only through
`src/lib/ledgerline.ts`:

| Function | What it does |
|---|---|
| `attachLedgerline(iframe)` | Listens for `{source: 'expense-demo', event}` postMessages from that iframe |
| `onLedgerlineEvent(fn)` | Raw Ledgerline events (Teach uses it to answer `save_requested`) |
| `sendCommand({cmd, ...})` | Posts `{target: 'expense-demo', cmd, ...}`: `save_decision`, `open_document`, `highlight`, `switch_user`, `reset`, `new_session`, ... |
| `toScreenEvent(e)` | Ledgerline event → ScreenEvent; every event is published on the shared bus, `user_activity` goes to `markActivity()` for pause detection |

URLs: `/ledgerline/index.html?user=paul` (Capture, /map) and `?user=maya&guard=1` (Teach: every Save waits for our `save_decision`).
Hidden demo controls inside Ledgerline: Alt+Shift+D (reset data, switch user, test a blocked save).
The Apprentice is injected into Ledgerline's top bar (indigo button) and opens as floating popups (`src/features/apprentice/`).

### ExpenseSnapshot

What Ledgerline sends with form and save events (see `src/lib/types.ts`): amounts (`spent`, `meal_amount`, `drink_amount`, `tip_amount`),
`type_of_meal` ("Eat In" | "Take Away"), `guests[]`, `guest_count`, `amount_per_person`, `projects[]`, and `attachments[]` whose `facts`
say what each document is (`invoice` with `consumption` "im Haus"/"außer Haus", `order_confirmation` = not a tax invoice, `approval_email`, ...).

## ScreenEvent

```ts
{ time, invoiceId, type, field?, from?, to?, description, source: "dom" | "vision" }
```

- `type`: the Ledgerline event type, e.g. `report_created`, `expense_form_opened`, `field_changed`, `guest_added`, `attachment_added`, `document_opened`, `expense_saved`, `save_blocked` (guardrail), `validation_failed`.
- `invoiceId`: id of the record on screen (expense id or report number).
- `docId`: Ledgerline document involved (receipt, invoice, approval email), used to link Work Map steps.
- `data`: raw ExpenseSnapshot when the event carries one.
- `field`, `from`, `to`: set for `field_changed`.
- `description`: one human-readable sentence; this is what the voice agent reads.
- `source`: `"dom"` from Ledgerline, `"vision"` from the screen-capture model.

Example:

```json
{ "time": "02:40", "invoiceId": "exp_k2j9x1", "type": "field_changed", "field": "type_of_meal",
  "from": "Take Away", "to": "Eat In",
  "description": "Type of Meal changed from \"Take Away\" to \"Eat In\"", "source": "dom" }
```

All events go through the bus in `src/lib/events.ts`:
`emit(event)`, `subscribe(fn) → unsubscribe`, `getHistory()`, `resetSession()`, React hook `useScreenEvents()`.

## TranscriptLine

```ts
{ time, speaker: "expert" | "agent", text }
```

## WorkMapStep

```ts
{ id, order, title, time, screenshot?, docId?, decision, reason, expertQuote, guardrails: string[] }
```

- `time`: the screen moment this step links to.
- `decision`: empty string for routine steps; non-empty = judgment call.
- `expertQuote`: the expert's own words (required by the brief).
- `docId`: Ledgerline document for the step; clicking the step on /map opens it with `open_document`.

## WorkMap

```ts
{ task, steps: WorkMapStep[], gaps: string[], confirmed: boolean, offRecord?, published? }
```

- `gaps`: open questions the debrief still needs to ask.
- `confirmed`: true once the expert accepted the teach-back.
- `offRecord`: `{from, to}` windows the expert took off the record; /map shows them as gaps.
- `published`: the expert approved the map on /map ("Approve & publish"). Teaching mode uses only a published map, otherwise the prepared sample.

## Who owns what: roles, owners, assignments, reviews

Everything is stored per company under `orgs/<company>/` in S3. Rules live in `src/lib/roles.ts`; every API route enforces them. See `docs/aws-deployment.md` (D3b) for how roles are set.

- **Role** (`admin` | `manager` | `employee`): the person's Cognito group. No group = employee.
- `members/index.json`: `Member[]` = `{ id, name, email, role }`, written when someone signs in. Managers pick from it on /assign.
- `workflows/<id>.json` (`WorkflowRecord`) and `workflows/index.json` (`WorkflowSummary[]`) carry `ownerId`, the recorder's Cognito user ID, set by the server on first save. A workflow without `ownerId` was saved before owners existed: only a manager or admin can open it.
- `assignments/index.json`: `Assignment[]` = `{ id, workflowId, learnerId, learnerName, assignedById, assignedByName, due?, note?, createdAt }`. `GET /api/assignments` adds the workflow name, step count and progress (`AssignmentView`).
- `progress/<workflow>/<user id>.json`: `{ [stepId]: "learned" | "relearn" }` for that person. Written by the person as they practise, and by the server when a review is submitted.
- `reviews/<workflow>/<learner id>.json` (`ReviewBatch`): the items from one person's practice on one workflow. `reviews/index.json` lists the `{ workflowId, learnerId }` pairs that exist. A manager or admin reviews any batch; an employee reviews batches on workflows they recorded.

| Who | Workflows | Reviews | Assign | Training |
|---|---|---|---|---|
| Admin, Manager | all; open, edit, approve, delete | all | yes | only what is assigned to them |
| Employee | only their own; open, edit, approve | only practice on their own workflows | no | only what is assigned to them |

## GuardrailResult (Teach)

```ts
{ ok: boolean, applicable: RuleKey[], violations: { key, stepId, rule, explanation, fields }[] }
```

Returned by `checkGuardrails(expense, workMap)`. Teach sends it back as `save_decision`: `allow: false` blocks the Save, shows the message in Paul's words and highlights `fields`.
`RuleKey`: `approval` (over 30 per person needs the supervisor's approval) | `delivery_docs` (delivery orders need receipt + invoice).

## Voice agent surface (`src/features/capture/agent.ts`)

`onLedgerlineEvent(fn)`, `sendToAgent(text, { respond? })` (silent context, or make the agent speak), and `AgentUiState`
(`not_started` | `connecting` | `listening` | `quiet` | `asking` | `off_record` | `debrief` | `building`).

## Fake data (`src/data/`)

- `fakeSession.ts`: `fakeEvents` + `fakeTranscript` of Paul's session from the demo script.
- `sampleWorkMap.ts`: Paul's map, 6 steps, 3 judgment calls, 3 guardrails (approval over 30 per person, what the approval must show, delivery orders need the invoice).
- `invoices.ts`: legacy data for the old invoice mock ERP (`src/features/erp/MockErp.tsx`), no longer used.
