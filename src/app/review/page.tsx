"use client";
// Supervisor review: everything Torchbearer flagged during Training as "might be different
// from the expert's way". The supervisor first sees the list of items waiting for review; opening one
// shows its screenshot, what the new hire did, the expert's step and Torchbearer's note, to mark it
// fine or needs correction. When every item is decided, the supervisor submits from the list.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { listWorkflows, loadReviews, saveMastery, saveReviews, type ReviewBatch } from "@/lib/session";
import type { ReviewItem } from "@/lib/types";

function Status({ item }: { item: ReviewItem }) {
  if (item.decision === "fine") return <span className="rounded-full bg-ok-soft px-2.5 py-1 text-[12.5px] font-medium text-ok">✓ Fine as it is</span>;
  if (item.decision === "needs_correction") return <span className="rounded-full bg-err-soft px-2.5 py-1 text-[12.5px] font-medium text-err">Needs correction</span>;
  return <span className="rounded-full bg-warn-soft px-2.5 py-1 text-[12.5px] font-medium text-[#7a5a00]">To review</span>;
}

export default function ReviewPage() {
  // The review batch lives in the database.
  const [batch, setBatch] = useState<ReviewBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    loadReviews().then((b) => {
      setBatch(b);
      setLoading(false);
    });
    listWorkflows()
      .then((list) => setNames(Object.fromEntries(list.map((w) => [w.id, w.name]))))
      .catch(() => {});
  }, []);
  const current = batch;
  const items = current?.items ?? [];
  const decided = items.filter((i) => i.decision).length;
  const openIndex = items.findIndex((i) => i.id === openId);
  const open = openIndex >= 0 ? items[openIndex] : null;

  function save(next: ReviewBatch, immediate = false) {
    setBatch(next);
    clearTimeout(timer.current);
    if (immediate) saveReviews(next);
    else timer.current = setTimeout(() => saveReviews(next), 500);
  }
  function set(id: string, patch: Partial<ReviewItem>) {
    if (!current) return;
    save({ ...current, items: current.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }
  function show(id: string | null) {
    setOpenId(id);
    window.scrollTo({ top: 0 });
  }

  if (loading) {
    return <div className="grid min-h-full place-items-center bg-[#f6f8fc] text-[15px] text-[#667085]">Loading reviews from the database…</div>;
  }

  const workflowName = (i: ReviewItem) => (i.workflowId && names[i.workflowId]) || "Workflow";

  return (
    <div className="min-h-full bg-[#f6f8fc]">
      <section className="relative overflow-hidden border-b border-line bg-[linear-gradient(180deg,#f3f2ff_0%,#ffffff_100%)]">
        <div className="relative mx-auto max-w-6xl px-6 pb-8 pt-6">
          {open ? (
            <button onClick={() => show(null)} className="mb-4 inline-block text-[13.5px] text-[#667085] hover:text-indigo">← All items to review</button>
          ) : (
            <Link href="/vault" className="mb-4 inline-block text-[13.5px] text-[#667085] hover:text-indigo">← Vault</Link>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-indigo/30 bg-indigo-soft px-2.5 py-1 text-[12px] font-bold uppercase tracking-wide text-indigo">Supervisor review</span>
            <span className={`rounded-full px-2.5 py-1 text-[12.5px] font-medium ${current?.submitted ? "bg-ok-soft text-ok" : "bg-warn-soft text-[#7a5a00]"}`}>
              {current?.submitted ? "● Submitted" : items.length ? `● ${items.length - decided} of ${items.length} still to review` : "● Nothing to review"}
            </span>
          </div>
          {open ? (
            <h1 className="mt-4 text-[34px] font-light leading-[1.15] tracking-tight text-[#1f2d3d] md:text-[40px]">
              Item {openIndex + 1} of {items.length}: <span className="font-medium text-indigo">{workflowName(open)}</span>
            </h1>
          ) : (
            <>
              <h1 className="mt-4 text-[38px] font-light leading-[1.1] tracking-tight text-[#1f2d3d] md:text-[44px]">
                {current?.learner ?? "New hire"}&apos;s practice: <span className="font-medium text-indigo">items to review</span>
              </h1>
              <p className="mt-2 max-w-2xl text-[16.5px] text-[#475467]">
                When a new hire goes against one of the expert&apos;s own reasons or rules, Torchbearer tells them kindly and sends it here,
                for you to decide. Open an item to look at it.
              </p>
            </>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6 py-6">
        {items.length === 0 && (
          <div className="rounded-md border border-line bg-white p-8 text-center text-[15px] text-[#475467]">
            Nothing under review yet. Items appear here when the new hire practises in <Link href="/teach" className="text-brand hover:underline">Training</Link>.
          </div>
        )}

        {!open && items.length > 0 && (
          <ol className="overflow-hidden rounded-md border border-line bg-white shadow-[0_8px_24px_rgba(16,24,40,.05)]">
            {items.map((i, n) => (
              <li key={i.id} className="border-b border-line last:border-b-0">
                <button onClick={() => show(i.id)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-[#f8f8ff]">
                  <span className="w-7 shrink-0 text-center font-mono text-[13px] text-[#667085]">{n + 1}</span>
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-sm border border-line bg-[#eef2f6]">
                    {i.screenshot && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.screenshot} alt="" className="h-full w-full object-cover object-top" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] text-[#667085]">{workflowName(i)} · at {i.time}</div>
                    <div className="truncate text-[15px] text-[#1f2d3d]">{i.observed}</div>
                  </div>
                  <Status item={i} />
                  <span className="text-[18px] text-[#98a2b3]">›</span>
                </button>
              </li>
            ))}
          </ol>
        )}

        {open && (
          <div className="overflow-hidden rounded-md border border-line bg-white shadow-[0_8px_24px_rgba(16,24,40,.05)]">
            <div className="grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <div className="relative bg-[#eef2f6] md:border-r md:border-line">
                {open.screenshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={open.screenshot} alt={`New hire's screen at ${open.time}`} className="w-full object-contain" />
                ) : (
                  <div className="grid h-full min-h-48 place-items-center p-4 text-[13px] text-[#667085]">No screenshot</div>
                )}
                <span className="absolute left-2 top-2 rounded-sm bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white">#{openIndex + 1} · {open.time}</span>
              </div>
              <div className="space-y-3 p-5 text-[15px]">
                <div><span className="text-[12px] font-bold uppercase tracking-wide text-[#667085]">New hire did</span><div>{open.observed}</div></div>
                <div><span className="text-[12px] font-bold uppercase tracking-wide text-[#667085]">Approved way</span><div>{open.expected}</div></div>
                {open.note && <div className="rounded-md bg-warn-soft px-3 py-2 text-[14px] text-[#7a5a00]">Torchbearer: “{open.note}”</div>}
                {!current?.submitted ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <button onClick={() => set(open.id, { decision: "fine" })} className={`h-9 rounded-sm border px-3 text-[14px] ${open.decision === "fine" ? "border-ok bg-ok text-white" : "border-ok bg-white text-ok hover:bg-ok-soft"}`}>
                      ✓ Fine as it is
                    </button>
                    <button onClick={() => set(open.id, { decision: "needs_correction" })} className={`h-9 rounded-sm border px-3 text-[14px] ${open.decision === "needs_correction" ? "border-err bg-err text-white" : "border-err bg-white text-err hover:bg-err-soft"}`}>
                      Needs correction
                    </button>
                    {open.decision === "needs_correction" && (
                      <input
                        value={open.comment ?? ""}
                        onChange={(e) => set(open.id, { comment: e.target.value })}
                        placeholder="Tell the new hire what to change"
                        className="h-9 min-w-56 flex-1 rounded-sm border border-[#9aa0a6] px-2 text-[14px] focus:border-indigo focus:outline-none"
                      />
                    )}
                  </div>
                ) : (
                  <div className="border-t border-line pt-3 text-[14px]">
                    {open.decision === "fine" ? <span className="text-ok">✓ Fine as it is</span> : <span className="text-err">Needs correction{open.comment ? `: ${open.comment}` : ""}</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[14px]">
              <button onClick={() => show(items[openIndex - 1]?.id ?? null)} disabled={openIndex === 0} className="text-[#475467] hover:text-indigo disabled:opacity-30">← Previous</button>
              <button onClick={() => show(null)} className="text-[#475467] hover:text-indigo">Back to the list</button>
              <button onClick={() => show(items[openIndex + 1]?.id ?? null)} disabled={openIndex === items.length - 1} className="text-[#475467] hover:text-indigo disabled:opacity-30">Next →</button>
            </div>
          </div>
        )}

        {!open && items.length > 0 && current && !current.submitted && (
          <div className="mt-6 flex items-center justify-end gap-3">
            <span className="text-[14px] text-[#667085]">{decided}/{items.length} decided</span>
            <button
              onClick={() => {
                // The supervisor's decision settles the step: fine → learned, needs correction → relearn.
                for (const it of current.items) {
                  if (it.workflowId && it.stepId && it.decision) {
                    saveMastery(it.workflowId, current.learner, { [it.stepId]: it.decision === "fine" ? "learned" : "relearn" });
                  }
                }
                save({ ...current, submitted: true }, true);
              }}
              disabled={decided < items.length}
              className="h-11 rounded-sm bg-indigo px-5 text-[15px] text-white hover:bg-indigo-dark disabled:opacity-40"
            >
              Submit review
            </button>
          </div>
        )}
        {!open && current?.submitted && (
          <p className="mt-6 rounded-md border border-[#bfe3cc] bg-ok-soft px-4 py-3 text-[15px] text-ok">Review submitted. Steps marked fine count as learned; the rest stay on the new hire&apos;s relearn list for their next practice.</p>
        )}
      </div>
    </div>
  );
}
