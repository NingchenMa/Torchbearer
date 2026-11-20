"use client";
// Module 2 · Mapping, for one saved workflow (?id=…):
//   1. Check   every observation Torchbearer made (with its screenshot): ✓ correct / ✗ wrong + what really happened,
//              rename a step, add notes, reorder, delete
//   2. Save    applies the corrections and approves it (Teaching can use it; until then it is on hold),
//              then opens the process map, which builds itself for the saved steps.
//   A saved workflow opens on its saved steps; every step can still be edited there.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ExportDialog from "@/features/workmap/ExportDialog";
import { TypeChip, guardrailType } from "@/features/workmap/WorkMapView";
import NoAccess from "@/features/nav/NoAccess";
import { EXAMPLE_ID, exampleWorkflow, getWorkflowAccess, listWorkflows, saveWorkflow } from "@/lib/session";
import type { WorkflowSummary } from "@/lib/types";
import type { WorkflowRecord, WorkMapStep } from "@/lib/types";

const readId = () => {
  try {
    return new URLSearchParams(window.location.search).get("id");
  } catch {
    return null;
  }
};

/** The corrected version of a step: the expert's correction replaces what Torchbearer thought it saw. */
const corrected = (s: WorkMapStep): WorkMapStep =>
  s.review === "wrong" && s.correction?.trim() ? { ...s, title: s.correction.trim(), decision: `Corrected by the expert (Torchbearer saw: ${s.title})` } : s;

/**
 * The process map details (tool, data, decision) were built from a step's old wording: when the title,
 * reason or rules change, drop them so the process map rebuilds that step.
 */
function invalidate(next: WorkMapStep[], before: WorkMapStep[]): WorkMapStep[] {
  const old = new Map(before.map((s) => [s.id, s]));
  return next.map((s) => {
    const o = old.get(s.id);
    const same = o && o.title === s.title && o.reason === s.reason && o.guardrails.join(";") === s.guardrails.join(";");
    if (same || !s.process) return s;
    const { process: _drop, ...rest } = s;
    void _drop;
    return rest;
  });
}

export default function MappingPage() {
  const router = useRouter();
  const idParam = useSyncExternalStore(() => () => {}, readId, () => null);
  // Loaded from the database: the list of workflows, and the one being mapped.
  const [library, setLibrary] = useState<WorkflowSummary[]>([]);
  const [record, setRecord] = useState<WorkflowRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [denied, setDenied] = useState(false); // the server refused: not the recorder, not a manager
  const [attempt, setAttempt] = useState(0); // bumped by Retry to load again
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let live = true;
    listWorkflows().then(async (list) => {
      if (!live) return;
      setLibrary(list);
      const wanted = idParam ?? list[0]?.id;
      const { record: loaded, denied: refused } = await getWorkflowAccess(wanted);
      if (!live) return;
      setDenied(refused);
      // A real workflow that didn't load is an error, never a silent switch to the prepared example
      // (that looks like the recording vanished). The example only shows when nothing is recorded yet.
      if (loaded || !wanted) setRecord(loaded ?? exampleWorkflow());
      setLoadFailed(!loaded && !!wanted && !refused);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [idParam, attempt]);

  function retryLoad() {
    setLoading(true);
    setAttempt((n) => n + 1);
  }

  const wf = record ?? exampleWorkflow();
  const map = wf.map;
  const isExample = wf.id === EXAMPLE_ID;

  // Not chosen yet (null): an approved workflow opens on the saved steps, one that needs approval on the checks.
  const [view, setView] = useState<"check" | "final" | null>(null);
  const [draft, setDraft] = useState<WorkMapStep[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [zoom, setZoom] = useState<WorkMapStep | null>(null);
  const [noteOpen, setNoteOpen] = useState<string | null>(null); // the step whose note box is open (check view)
  const [titleOpen, setTitleOpen] = useState<string | null>(null); // the step whose title is being edited (check view)
  const [confirmDel, setConfirmDel] = useState<string | null>(null); // the step waiting for a second click on Delete
  const [me, setMe] = useState("");
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m?.email && setMe(m.email))
      .catch(() => {});
  }, []);

  const approved = !!map.published;
  const checked = map.steps.filter((s) => s.review).length;
  const wrong = map.steps.filter((s) => s.review === "wrong").length;
  const allChecked = checked === map.steps.length && map.steps.length > 0;
  const showFinal = view === "final" || (approved && view !== "check") || isExample;
  const finalSteps = draft ?? map.steps.map(corrected);

  /** Show the change now; write it to the database a moment later (typing doesn't flood it). */
  function persist(next: WorkflowRecord, immediate = false) {
    setRecord(next);
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    const write = () =>
      saveWorkflow(next).then((ok) => {
        setSaveState(ok ? "saved" : "error");
        if (ok) setLibrary((l) => l.map((w) => (w.id === next.id ? { ...w, name: next.name, published: !!next.map.published, stepCount: next.map.steps.length } : w)));
      });
    if (immediate) write();
    else saveTimer.current = setTimeout(write, 600);
  }
  function review(id: string, value: "ok" | "wrong") {
    persist({ ...wf, map: { ...map, published: false, steps: map.steps.map((s) => (s.id === id ? { ...s, review: value } : s)) } });
  }
  function setCorrection(id: string, text: string) {
    persist({ ...wf, map: { ...map, steps: map.steps.map((s) => (s.id === id ? { ...s, correction: text } : s)) } });
  }
  function revise() {
    setEditing(null);
    setDraft(null);
    setView("check");
  }
  function editStep(id: string, patch: Partial<WorkMapStep>) {
    setDraft(finalSteps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  /** Change the list of steps (add, delete, reorder, note): on the draft in the corrected view, straight to the database while checking. */
  function mutate(change: (steps: WorkMapStep[]) => WorkMapStep[]) {
    if (showFinal) setDraft(change(finalSteps));
    else persist({ ...wf, map: { ...map, published: false, steps: change(map.steps).map((s, i) => ({ ...s, order: i + 1 })) } });
  }
  function addStep() {
    const taken = new Set([...map.steps, ...finalSteps].map((s) => s.id));
    let n = taken.size + 1;
    while (taken.has(`m${n}`)) n++;
    const id = `m${n}`;
    // A step added by hand has no recording, so there is no observation to check.
    const step: WorkMapStep = { id, order: 0, title: "", time: "", decision: "", reason: "", expertQuote: "", guardrails: [], review: "ok", addedBy: me };
    mutate((steps) => [...steps, step]);
    if (showFinal) setEditing(id);
  }
  function removeStep(id: string) {
    if (confirmDel !== id) return setConfirmDel(id);
    setConfirmDel(null);
    mutate((steps) => steps.filter((s) => s.id !== id));
  }
  function moveStep(id: string, by: -1 | 1) {
    mutate((steps) => {
      const i = steps.findIndex((s) => s.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= steps.length) return steps;
      const next = [...steps];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  const patchStep = (id: string, patch: Partial<WorkMapStep>) => mutate((steps) => steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  /** Move up, move down and delete, shown on every step in both views. */
  const stepTools = (s: WorkMapStep, i: number, count: number) => (
    <span className="ml-auto flex items-center gap-1">
      <button onClick={() => moveStep(s.id, -1)} disabled={i === 0} className="h-8 w-8 rounded-sm border border-line bg-white text-[14px] text-[#475467] hover:border-indigo hover:text-indigo disabled:opacity-30" aria-label={`Move step ${i + 1} up`} title="Move up">↑</button>
      <button onClick={() => moveStep(s.id, 1)} disabled={i === count - 1} className="h-8 w-8 rounded-sm border border-line bg-white text-[14px] text-[#475467] hover:border-indigo hover:text-indigo disabled:opacity-30" aria-label={`Move step ${i + 1} down`} title="Move down">↓</button>
      <button onClick={() => removeStep(s.id)} onBlur={() => setConfirmDel(null)} className={`h-8 rounded-sm border px-2.5 text-[13px] ${confirmDel === s.id ? "border-err bg-err text-white" : "border-line bg-white text-err hover:border-err"}`}>
        {confirmDel === s.id ? "Click again to delete" : "Delete"}
      </button>
    </span>
  );
  /** Approve the steps (the corrected ones from the checks, or the edited saved ones), then show the process map. */
  async function save() {
    const from = showFinal ? finalSteps : map.steps.map(corrected);
    const steps = invalidate(
      from.filter((s) => s.title.trim()).map((s, i) => ({ ...s, order: i + 1, review: "ok" as const, correction: undefined })),
      map.steps,
    );
    const next = { ...wf, map: { ...map, steps, published: true, confirmed: true } };
    clearTimeout(saveTimer.current);
    setRecord(next);
    setSaveState("saving");
    setDraft(null);
    setEditing(null);
    const ok = await saveWorkflow(next);
    setSaveState(ok ? "saved" : "error");
    if (ok) router.push(`/process?id=${encodeURIComponent(wf.id)}`);
  }
  function switchTo(id: string) {
    window.location.search = `?id=${id}`;
  }

  const tiles: [number, string, string][] = [
    [map.steps.length, "Steps observed", "text-[#1f2d3d]"],
    [checked, "Checked by the expert", "text-ok"],
    [wrong, "Corrected", "text-err"],
    [map.steps.length - checked, "Still to check", "text-[#7a5a00]"],
  ];

  if (loading) {
    return <div className="grid min-h-full place-items-center bg-[#f6f8fc] text-[15px] text-[#667085]">Loading the workflow from the database…</div>;
  }
  if (denied) return <NoAccess message="You lack permission to edit or review this workflow." />;
  if (loadFailed) {
    return (
      <div className="grid min-h-full place-items-center bg-[#f6f8fc] p-6 text-center">
        <div className="max-w-md">
          <div className="text-[22px] font-light text-[#1f2d3d]">Couldn&apos;t load this workflow</div>
          <p className="mt-2 text-[15px] text-[#667085]">
            The connection may have dropped or your sign-in may have ended. Nothing was deleted. Try again, or open the workflow from Workflows.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button onClick={retryLoad} className="h-11 rounded-sm bg-indigo px-5 text-[15px] text-white hover:bg-indigo-dark">Try again</button>
            <Link href="/vault" className="inline-flex h-11 items-center rounded-sm border border-indigo bg-white px-5 text-[15px] text-indigo hover:bg-indigo-soft">← Workflows</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f6f8fc]">
      <section className="relative overflow-hidden border-b border-line bg-[linear-gradient(180deg,#f3f2ff_0%,#ffffff_100%)]">
        <div className="pointer-events-none absolute -right-32 -top-40 h-[440px] w-[440px] rounded-full bg-indigo/10 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-6 pb-8 pt-6">
          <div className="mb-4 flex flex-wrap items-center gap-3 text-[13.5px]">
            <Link href="/vault" className="text-[#667085] hover:text-indigo">← Workflows</Link>
            <span className="ml-auto text-[#667085]">Workflow</span>
            <select value={wf.id} onChange={(e) => switchTo(e.target.value)} className="h-9 max-w-xs rounded-sm border border-[#9aa0a6] bg-white px-2 text-[14px] focus:border-indigo focus:outline-none">
              {library.map((w) => (
                <option key={w.id} value={w.id}>{w.name}{w.published ? "" : " · on hold"}</option>
              ))}
              <option value={EXAMPLE_ID}>{exampleWorkflow().name}</option>
            </select>
          </div>
          <div className="rise flex flex-wrap items-start gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-sm border border-indigo/30 bg-indigo-soft px-2.5 py-1 text-[12px] font-bold uppercase tracking-wide text-indigo">Module 2 · Mapping</span>
                <span className={`rounded-full px-2.5 py-1 text-[12.5px] font-medium ${approved ? "bg-ok-soft text-ok" : "bg-warn-soft text-[#7a5a00]"}`}>
                  {approved ? "● Workflow saved" : "● Needs approval"}
                </span>
                {!isExample && (
                  <span className={`text-[12.5px] ${saveState === "error" ? "text-err" : "text-[#667085]"}`}>
                    {saveState === "saving" ? "Saving to the database…" : saveState === "error" ? "Couldn't save to the database, retrying on your next change" : "✓ Workflow saved"}
                  </span>
                )}
              </div>
              <h1 className="mt-4 text-[36px] font-light leading-[1.1] tracking-tight text-[#1f2d3d] md:text-[42px]">{wf.name}</h1>
              {wf.role && <div className="mt-1 text-[15px] text-[#667085]">Role: <b className="font-medium text-[#344054]">{wf.role}</b></div>}
              <p className="mt-2 max-w-2xl text-[16px] leading-relaxed text-[#475467]">
                {showFinal
                  ? approved && !draft
                    ? "The saved workflow Torchbearer teaches. Revise it any time."
                    : "This is the corrected workflow Torchbearer will learn. Edit any step, then save. Or go back and revise your checks."
                  : "Step by step, everything Torchbearer saw while the expert worked. Mark each step correct, or tell it what really happened, rename or delete steps, then save."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {!isExample && (
                <Link href={`/process?id=${wf.id}`} className="inline-flex h-11 items-center rounded-sm border border-indigo bg-white px-4 text-[15px] text-indigo hover:bg-indigo-soft">
                  Process map
                </Link>
              )}
              <button className="inline-flex h-11 items-center rounded-sm border border-indigo bg-white px-4 text-[15px] text-indigo hover:bg-indigo-soft" onClick={() => setExporting(true)}>
                Export for AI agents ↓
              </button>
              {approved && (
                <Link href={`/teach?id=${wf.id}`} className="inline-flex h-11 items-center rounded-sm bg-indigo px-5 text-[15px] text-white shadow-sm hover:bg-indigo-dark">
                  Go to Training →
                </Link>
              )}
            </div>
          </div>
          {!showFinal && (
            <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
              {tiles.map(([n, label, tone]) => (
                <div key={label} className="rounded-md border border-line bg-white/80 px-5 py-4">
                  <div className={`text-[34px] font-light leading-none ${tone}`}>{n}</div>
                  <div className="mt-1.5 text-[13.5px] text-[#475467]">{label}</div>
                </div>
              ))}
            </div>
          )}
          {isExample && <p className="mt-4 text-[13px] text-[#667085]">The prepared example is read-only. Record your own workflow in Capture.</p>}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6 py-6">
        {!showFinal ? (
          <>
            <ol className="flex flex-col gap-4">
              {map.steps.map((s, i) => (
                <li key={s.id} className="rise overflow-hidden rounded-md border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_rgba(16,24,40,.05)]">
                  <div className="grid md:grid-cols-[260px_minmax(0,1fr)]">
                    <button className="relative block bg-[#eef2f6] md:border-r md:border-line" onClick={() => s.screenshot && setZoom(s)} disabled={!s.screenshot}>
                      {s.screenshot ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.screenshot} alt={`Screen at ${s.time}`} className="h-full max-h-56 w-full object-cover object-top" />
                      ) : (
                        <div className="grid h-full min-h-32 place-items-center bg-[linear-gradient(135deg,#2F74D0,#5146d9)] p-4 text-center text-[13px] text-white">{s.addedBy !== undefined ? "Added by hand · no recording" : `Screen at ${s.time}`}</div>
                      )}
                      {s.time && <span className="absolute left-2 top-2 rounded-sm bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white">{s.time}</span>}
                    </button>
                    <div className="p-5">
                      <div className="flex items-start gap-3">
                        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-brand text-[13px] font-bold text-white">{s.order}</span>
                        <div className="min-w-0 flex-1">
                          {s.addedBy !== undefined || titleOpen === s.id ? (
                            <input
                              autoFocus={titleOpen === s.id}
                              onBlur={() => titleOpen === s.id && setTitleOpen(null)}
                              onKeyDown={(e) => e.key === "Enter" && titleOpen === s.id && setTitleOpen(null)}
                              value={s.title}
                              onChange={(e) => patchStep(s.id, { title: e.target.value })}
                              placeholder="What happens in this step?"
                              aria-label={`Step ${s.order}`}
                              className="h-10 w-full rounded-sm border border-[#9aa0a6] px-3 text-[16px] focus:border-indigo focus:outline-none"
                            />
                          ) : (
                            <div className="flex items-start gap-2">
                              <div className="text-[18px] leading-snug text-[#1f2d3d]">{s.title}</div>
                              {!isExample && (
                                <button onClick={() => setTitleOpen(s.id)} className="mt-0.5 shrink-0 rounded-sm px-1.5 text-[13px] text-[#667085] hover:bg-indigo-soft hover:text-indigo" aria-label={`Rename step ${s.order}`} title="Rename this step">
                                  ✎ Edit
                                </button>
                              )}
                            </div>
                          )}
                          {s.decision && <div className="mt-0.5 text-[14px] text-[#667085]">Torchbearer saw: {s.decision}</div>}
                        </div>
                      </div>
                      {s.expertQuote && (
                        <div className="mt-3 rounded-md bg-indigo-soft/60 px-3 py-2 text-[14.5px]"><b className="text-indigo">Why, in the expert&apos;s words:</b> “{s.expertQuote}”</div>
                      )}
                      {s.guardrails.map((g) => (
                        <div key={g} className="mt-2 flex items-start gap-2 text-[14px]"><TypeChip type={guardrailType(g)} /> {g}</div>
                      ))}
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                        {s.addedBy === undefined && (
                          <>
                        <span className="mr-1 text-[13px] text-[#667085]">Is this observation right?</span>
                        <button onClick={() => review(s.id, "ok")} className={`h-9 rounded-sm border px-3 text-[14px] ${s.review === "ok" ? "border-ok bg-ok text-white" : "border-ok bg-white text-ok hover:bg-ok-soft"}`}>✓ Correct</button>
                        <button onClick={() => review(s.id, "wrong")} className={`h-9 rounded-sm border px-3 text-[14px] ${s.review === "wrong" ? "border-err bg-err text-white" : "border-err bg-white text-err hover:bg-err-soft"}`}>✗ Wrong</button>
                          </>
                        )}
                        <button onClick={() => setNoteOpen(noteOpen === s.id ? null : s.id)} className="h-9 rounded-sm border border-line bg-white px-3 text-[14px] text-[#475467] hover:border-indigo hover:text-indigo">
                          {s.note?.trim() ? "Edit note" : "+ Add note"}
                        </button>
                        {!isExample && stepTools(s, i, map.steps.length)}
                      </div>
                      {noteOpen === s.id ? (
                        <textarea
                          value={s.note ?? ""}
                          onChange={(e) => patchStep(s.id, { note: e.target.value })}
                          placeholder="A note for whoever reads or learns this step."
                          aria-label={`Note on step ${s.order}`}
                          className="mt-2 h-20 w-full rounded-sm border border-[#9aa0a6] bg-[#fffbea] p-2 text-[14.5px] focus:border-indigo focus:outline-none"
                        />
                      ) : (
                        s.note?.trim() && <p className="mt-2 rounded-md bg-[#fff1c2] px-3 py-2 text-[14px] text-[#3d2f00]"><b className="text-[#6b5000]">Note:</b> {s.note}</p>
                      )}
                      {s.review === "wrong" && (
                        <textarea
                          value={s.correction ?? ""}
                          onChange={(e) => setCorrection(s.id, e.target.value)}
                          placeholder="What really happened here? Torchbearer will learn your version."
                          className="mt-2 h-20 w-full rounded-sm border border-[#9aa0a6] p-2 text-[14.5px] focus:border-indigo focus:outline-none"
                        />
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {(map.offRecord ?? []).map((r) => (
              <p key={r.from} className="mt-4 rounded-md border border-dashed border-[#b9bdc4] bg-white px-4 py-2.5 text-[14px] text-[#555]">
                <b>Paused</b> {r.from}–{r.to}: The expert paused the recording here. Nothing was saved.
              </p>
            ))}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              {!isExample && (
                <button className="mr-auto h-11 rounded-sm border border-dashed border-indigo bg-white px-5 text-[15px] text-indigo hover:bg-indigo-soft" onClick={addStep}>
                  + Add step
                </button>
              )}
              <span className="text-[14px] text-[#667085]">{allChecked ? "All steps checked." : `${map.steps.length - checked} step(s) left to check.`}</span>
              <button className="h-11 rounded-sm bg-indigo px-5 text-[15px] text-white hover:bg-indigo-dark disabled:opacity-40" onClick={save} disabled={!allChecked || isExample || saveState === "saving"}>
                ✓ Save workflow → process map
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 text-[13px] font-bold uppercase tracking-[.12em] text-[#667085]">
              {approved && !draft ? "Saved workflow" : "Corrected workflow · review before saving"}
            </div>
            <ol className="flex flex-col gap-3">
              {finalSteps.map((s, i) => {
                const isEditing = editing === s.id;
                return (
                  <li key={s.id} className="rise rounded-md border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_rgba(16,24,40,.05)]">
                    <div className="flex items-start gap-3">
                      <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-indigo text-[13px] font-bold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Field label="Step" value={s.title} onChange={(v) => editStep(s.id, { title: v })} />
                            <Field label="Why (in the expert's words)" value={s.expertQuote} onChange={(v) => editStep(s.id, { expertQuote: v, reason: v })} />
                            <Field label="Rule (limit, exception or when to stop)" value={s.guardrails[0] ?? ""} onChange={(v) => editStep(s.id, { guardrails: v.trim() ? [v] : [] })} />
                            <Field label="Note" value={s.note ?? ""} onChange={(v) => editStep(s.id, { note: v })} />
                          </div>
                        ) : (
                          <>
                            <div className="text-[17.5px] leading-snug text-[#1f2d3d]">{s.title}</div>
                            {s.decision?.startsWith("Corrected by") && <div className="mt-0.5 text-[13px] text-err">{s.decision}</div>}
                            {s.expertQuote && <div className="mt-2 text-[14.5px] text-[#475467]"><b className="text-indigo">Why:</b> “{s.expertQuote}”</div>}
                            {s.guardrails.map((g) => (
                              <div key={g} className="mt-1.5 flex items-start gap-2 text-[14px]"><TypeChip type={guardrailType(g)} /> {g}</div>
                            ))}
                            {s.note?.trim() && <div className="mt-2 rounded-md bg-[#fff1c2] px-3 py-2 text-[14px] text-[#3d2f00]"><b className="text-[#6b5000]">Note:</b> {s.note}</div>}
                          </>
                        )}
                      </div>
                      {!isExample && (
                        <button
                          className="h-8 rounded-sm border border-indigo bg-white px-3 text-[13px] text-indigo hover:bg-indigo-soft"
                          onClick={() => {
                            if (!draft) setDraft(finalSteps);
                            setEditing(isEditing ? null : s.id);
                          }}
                        >
                          {isEditing ? "Done" : "Edit"}
                        </button>
                      )}
                    </div>
                    {!isExample && <div className="mt-3 flex border-t border-line pt-3">{stepTools(s, i, finalSteps.length)}</div>}
                  </li>
                );
              })}
            </ol>
            {!isExample && (
              <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                <button className="mr-auto h-11 rounded-sm border border-dashed border-indigo bg-white px-5 text-[15px] text-indigo hover:bg-indigo-soft" onClick={addStep}>
                  + Add step
                </button>
                <button className="h-11 rounded-sm border border-indigo bg-white px-5 text-[15px] text-indigo hover:bg-indigo-soft" onClick={revise}>
                  ← Revise
                </button>
                {(draft || !approved) && (
                  <button className="h-11 rounded-sm bg-indigo px-5 text-[15px] text-white hover:bg-indigo-dark" onClick={save}>
                    ✓ Save workflow → process map
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {exporting && (
        <ExportDialog
          map={{ ...map, steps: finalSteps.map((s) => ({ ...s, process: map.steps.find((x) => x.id === s.id)?.process ?? s.process })) }}
          meta={{ id: wf.id, name: wf.name, createdAt: wf.createdAt, trainedBy: library.find((w) => w.id === wf.id)?.trainedBy }}
          onClose={() => setExporting(false)}
          workflowId={isExample ? undefined : wf.id}
          onBuilt={(next) => setRecord(next)}
        />
      )}
      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,28,38,.6)] p-6" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.screenshot} alt={`Screen at ${zoom.time}`} className="rise max-h-full max-w-full rounded-sm shadow-2xl" />
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[12px] font-bold uppercase tracking-wide text-[#667085]">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 h-10 w-full rounded-sm border border-[#9aa0a6] px-3 text-[15px] focus:border-indigo focus:outline-none" />
    </label>
  );
}
