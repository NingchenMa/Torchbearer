"use client";
// Reviews: everything Torchbearer flagged during Training as "might be different from the expert's way".
// Who sees what is decided by the server (/api/reviews): managers and admins see every practice session,
// and an employee sees only practice on the workflows they recorded. Each item shows the new hire's screen,
// what they did next to what the expert did, and Torchbearer's note. The reviewer marks it fine or needs
// correction, can add a note for the new hire, and submits. A submitted review settles the step.

import { useEffect, useMemo, useRef, useState } from "react";
import { loadReviewBatches, saveReviewDecisions } from "@/lib/session";
import type { ReviewBatch, ReviewItem } from "@/lib/types";
import { useMe } from "@/lib/useMe";

const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const key = (b: ReviewBatch) => `${b.workflowId}/${b.learnerId}`;

interface Row {
  batch: ReviewBatch;
  item: ReviewItem;
}

export default function ReviewPage() {
  const { manager } = useMe();
  const [batches, setBatches] = useState<ReviewBatch[] | null>(null);
  const [view, setView] = useState<"all" | "open" | "done">("all");
  const [learner, setLearner] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let live = true;
    loadReviewBatches().then((b) => live && setBatches(b));
    return () => {
      live = false;
    };
  }, []);

  const rows: Row[] = useMemo(() => (batches ?? []).flatMap((batch) => batch.items.map((item) => ({ batch, item }))), [batches]);
  const open = rows.filter((r) => !r.batch.submitted);
  const undecided = rows.filter((r) => !r.item.decision).length;
  const fine = rows.filter((r) => r.item.decision === "fine").length;
  const needs = rows.filter((r) => r.item.decision === "needs_correction").length;
  const decidedOpen = open.filter((r) => r.item.decision).length;

  const shown = rows.filter(
    (r) =>
      (!learner || r.batch.learner === learner) &&
      (!workflow || r.batch.workflowName === workflow) &&
      (view === "all" || (view === "open" ? !r.item.decision : !!r.item.decision)),
  );
  const groups = new Map<string, Row[]>();
  for (const r of shown) groups.set(r.batch.learner, [...(groups.get(r.batch.learner) ?? []), r]);
  const learners = [...new Set(rows.map((r) => r.batch.learner))];
  const workflows = [...new Set(rows.map((r) => r.batch.workflowName))];

  /** Show the change now; send it to the server a moment later (typing a note doesn't flood it). */
  function change(b: ReviewBatch, id: string, patch: Partial<ReviewItem>) {
    if (b.submitted) return;
    const next: ReviewBatch = { ...b, items: b.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
    setBatches((all) => (all ?? []).map((x) => (key(x) === key(b) ? next : x)));
    clearTimeout(timers.current[key(b)]);
    timers.current[key(b)] = setTimeout(() => {
      saveReviewDecisions(next).then((ok) => setError(ok ? null : "Couldn't save your decision. Check the connection and try again."));
    }, 500);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const pending = (batches ?? []).filter((b) => !b.submitted && b.items.length);
    for (const b of pending) clearTimeout(timers.current[key(b)]);
    const results = await Promise.all(pending.map((b) => saveReviewDecisions(b, true)));
    if (results.some((ok) => !ok)) setError("Some reviews couldn't be submitted. Try again.");
    setBatches(await loadReviewBatches());
    setSubmitting(false);
  }

  if (batches === null) {
    return <div className="grid min-h-full place-items-center bg-[#f6f8fc] text-[15px] text-[#667085]">Loading reviews…</div>;
  }

  return (
    <div className="min-h-full bg-[#f6f8fc] pb-24">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-7">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-5 pt-6">
          <h1 className="mr-auto text-[26px] font-medium leading-tight text-[#1f2d3d]">Reviews</h1>
          <select value={learner} onChange={(e) => setLearner(e.target.value)} aria-label="Learner" className="h-10 rounded-sm border border-[#9aa0a6] bg-white px-3">
            <option value="">All learners</option>
            {learners.map((n) => <option key={n}>{n}</option>)}
          </select>
          <select value={workflow} onChange={(e) => setWorkflow(e.target.value)} aria-label="Workflow" className="h-10 rounded-sm border border-[#9aa0a6] bg-white px-3">
            <option value="">All workflows</option>
            {workflows.map((n) => <option key={n}>{n}</option>)}
          </select>
          <div className="flex h-10 overflow-hidden rounded-sm border border-[#9aa0a6] bg-white" role="group" aria-label="Show">
            {([["all", "All"], ["open", "Undecided"], ["done", "Decided"]] as const).map(([v, label], i) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`px-4 ${i ? "border-l border-line" : ""} ${view === v ? "bg-indigo text-white" : "text-[#475467] hover:bg-panel"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="mb-5 grid gap-4 sm:grid-cols-3" aria-label="Summary">
          {([["Under review", undecided, "text-[#7a5a00]"], ["Fine as it is", fine, "text-ok"], ["Needs correction", needs, "text-err"]] as const).map(([label, n, color]) => (
            <div key={label} className="rounded-md border border-line bg-white px-4 py-3">
              <span className="block text-[12px] font-bold uppercase tracking-[.06em] text-[#667085]">{label}</span>
              <b className={`text-[26px] font-medium leading-[1.3] ${color}`}>{n}</b>
            </div>
          ))}
        </section>

        {shown.length === 0 && (
          <div className="rounded-md border border-line bg-white p-8 text-center text-[15px] text-[#475467]">
            {rows.length === 0
              ? manager
                ? "Nothing under review yet. Items appear here when a new hire practises in Training."
                : "No reviews are assigned to you."
              : "Nothing matches this filter."}
          </div>
        )}

        {[...groups.entries()].map(([name, list]) => {
          const left = list.filter((r) => !r.item.decision).length;
          return (
            <div key={name} className="mb-2">
              <div className="mb-3 mt-5 flex items-center gap-3 rounded-md border border-[#bcd8f5] bg-brand-soft px-4 py-2.5 text-[15px] font-medium text-[#1f2d3d] first:mt-0">
                <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-white text-[11.5px] font-bold">{initials(name)}</span>
                {name} · {left} to review
                <button onClick={() => setCollapsed((c) => ({ ...c, [name]: !c[name] }))} className="ml-auto text-[14px] font-normal text-[#475467]">
                  {collapsed[name] ? "Expand ▾" : "Collapse ▴"}
                </button>
              </div>
              {!collapsed[name] && (
                <ol className="flex flex-col gap-4">
                  {list.map(({ batch, item }, n) => (
                    <ReviewCard key={`${key(batch)}/${item.id}`} batch={batch} item={item} n={n + 1} onChange={(patch) => change(batch, item.id, patch)} />
                  ))}
                </ol>
              )}
            </div>
          );
        })}
        {error && <p className="mt-4 rounded-md border border-[#f3c2c2] bg-err-soft px-4 py-3 text-[14.5px] text-[#8e1b1b]">{error}</p>}
      </div>

      {open.length > 0 && (
        <div className="fixed bottom-0 left-16 right-0 z-10 flex h-16 items-center justify-end gap-3 border-t border-line bg-white/95 px-4 sm:px-7 md:left-60">
          <span className="text-[14px] text-[#667085]">{decidedOpen}/{open.length} decided</span>
          <button onClick={submit} disabled={decidedOpen < open.length || submitting} className="h-11 rounded-sm bg-indigo px-5 text-[15px] text-white hover:bg-indigo-dark disabled:opacity-40">
            {submitting ? "Submitting…" : "Submit review"}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ batch, item, n, onChange }: { batch: ReviewBatch; item: ReviewItem; n: number; onChange: (patch: Partial<ReviewItem>) => void }) {
  const state = item.decision === "fine" ? ["bg-ok-soft text-ok", "● Fine as it is"] : item.decision === "needs_correction" ? ["bg-err-soft text-err", "⚑ Needs correction"] : ["bg-warn-soft text-[#7a5a00]", "● Pending"];
  return (
    <li className="grid overflow-hidden rounded-md border border-line bg-white shadow-[0_4px_14px_rgba(16,24,40,.04)] lg:grid-cols-[232px_minmax(0,1fr)_280px]">
      <div className="flex flex-col items-center gap-1.5 p-4 pb-2 lg:pb-4 lg:pr-0">
        <div className="relative min-h-[150px] w-full flex-1 overflow-hidden rounded-md border border-[#cbd5e1] bg-[#eef2f6]">
          {item.screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.screenshot} alt={`New hire's screen at ${item.time}`} className="absolute inset-0 h-full w-full object-cover object-top" />
          ) : (
            <div className="grid h-full min-h-[150px] place-items-center text-[13px] text-[#667085]">No screenshot</div>
          )}
          <span className="absolute bottom-2 left-2 rounded-sm bg-black/60 px-2 py-0.5 font-mono text-[12px] text-white">{item.time}</span>
        </div>
        {item.screenshot && (
          <a href={item.screenshot} target="_blank" rel="noreferrer" className="text-[13px] text-brand hover:underline">View full size</a>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
        <div className="text-[15px] text-[#1f2d3d]">
          <b className="font-medium">{batch.workflowName}</b>
          {item.stepLabel && <span className="text-[#475467]"> › {item.stepLabel}</span>}
          <span className="mt-0.5 block text-[13px] text-[#98a2b3]">Training session · #{n}</span>
        </div>
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-line bg-white px-3.5 py-2.5 text-[15px] leading-[1.45]">
            <span className="mb-1 block text-[12px] font-bold uppercase tracking-[.06em] text-[#667085]">What the new hire did</span>
            {item.observed}
          </div>
          <div className="rounded-md border border-[#dcd9fb] bg-indigo-soft px-3.5 py-2.5 text-[15px] leading-[1.45]">
            <span className="mb-1 block text-[12px] font-bold uppercase tracking-[.06em] text-[#667085]">What the expert did</span>
            {item.expected}
          </div>
        </div>
        {item.note && <p className="text-[13.5px] italic text-[#667085]">✦ Note: {item.note}</p>}
      </div>

      <div className="flex flex-col gap-2.5 border-t border-line p-4 lg:border-l lg:border-t-0">
        <span className={`w-fit rounded-full px-3 py-[3px] text-[13px] font-medium ${state[0]}`}>{state[1]}</span>
        {batch.submitted ? (
          item.comment && <p className="text-[14px] text-[#475467]"><b className="font-medium">Note:</b> {item.comment}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onChange({ decision: "fine" })} aria-pressed={item.decision === "fine"} className={`h-10 whitespace-nowrap rounded-sm border px-2 text-[14px] font-medium ${item.decision === "fine" ? "border-ok bg-ok text-white" : "border-ok bg-white text-ok hover:bg-ok-soft"}`}>
                ✓ Fine
              </button>
              <button onClick={() => onChange({ decision: "needs_correction" })} aria-pressed={item.decision === "needs_correction"} className={`h-10 whitespace-nowrap rounded-sm border px-2 text-[14px] font-medium ${item.decision === "needs_correction" ? "border-err bg-err text-white" : "border-err bg-white text-err hover:bg-err-soft"}`}>
                ⚑ Needs correction
              </button>
            </div>
            <textarea
              value={item.comment ?? ""}
              onChange={(e) => onChange({ comment: e.target.value })}
              placeholder="Add a note for the new hire (optional)"
              aria-label="Note for the new hire"
              className="min-h-16 w-full resize-y rounded-sm border border-[#9aa0a6] px-2.5 py-2 text-[14px] focus:border-indigo focus:outline-none"
            />
          </>
        )}
      </div>
    </li>
  );
}
