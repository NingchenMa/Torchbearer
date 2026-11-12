"use client";
// Workflows: the workflows the signed-in person may see, newest first.
//   Managers and admins: every workflow at the company, searchable by workflow or expert, with every action
//     (train a new hire, Work Map, Process map, review and approve, delete) and who is learning each one.
//   Employees: only the workflows they recorded, with Train a new hire, Work Map and Process map.
// The server decides what each person gets (/api/workflows); this page only decides how it looks.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { stateOf, todayIso } from "@/lib/assignmentStatus";
import type { AssignmentView, WorkflowSummary } from "@/lib/types";
import { useMe } from "@/lib/useMe";

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

const btn = "inline-flex h-9 items-center rounded-sm border border-line px-3 text-[14px] text-[#344054] hover:bg-panel";
const btnPri = "inline-flex h-9 items-center rounded-sm bg-indigo px-3 text-[14px] text-white hover:bg-indigo-dark";

export default function VaultPage() {
  const { manager, loading: meLoading } = useMe();
  const [list, setList] = useState<WorkflowSummary[] | null>(null);
  const [assignments, setAssignments] = useState<AssignmentView[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "approved" | "draft">("all");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null); // an employee pressed "Train a new hire"

  useEffect(() => {
    fetch("/api/workflows", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((l: WorkflowSummary[]) => setList(l))
      .catch(() => setList([]));
  }, []);
  // Managers also see who is learning each workflow.
  useEffect(() => {
    if (!manager) return;
    fetch("/api/assignments", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((a: AssignmentView[]) => setAssignments(a))
      .catch(() => {});
  }, [manager]);

  const remove = async (id: string) => {
    setDeleting(id);
    setDeleteError(null);
    try {
      const r = await fetch(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      setList((l) => (l ?? []).filter((w) => w.id !== id));
      setAssignments((a) => a.filter((x) => x.workflowId !== id));
      setConfirming(null);
    } catch {
      setDeleteError("Couldn't delete it. Please try again.");
    } finally {
      setDeleting(null);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? [])
      .filter((w) => (filter === "all" ? true : filter === "approved" ? w.published : !w.published))
      // Searching by expert is for people who can see everyone's workflows.
      .filter((w) => !q || w.name.toLowerCase().includes(q) || (manager && (w.trainedBy ?? "").toLowerCase().includes(q)))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [list, query, filter, manager]);
  const approved = (list ?? []).filter((w) => w.published).length;
  const today = todayIso();

  if (list === null || meLoading) {
    return <div className="grid min-h-full place-items-center bg-[#f6f8fc] text-[15px] text-[#667085]">Loading your workflows…</div>;
  }

  return (
    <div className="min-h-full bg-[#f6f8fc]">
      <main className="mx-auto max-w-[1240px] px-4 pb-10 sm:px-7">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-5 pt-6">
          <h1 className="mr-auto text-[26px] font-medium leading-tight text-[#1f2d3d]">Workflows</h1>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={manager ? "Search by workflow or expert" : "Search your workflows"}
            aria-label="Search workflows"
            className="h-10 w-full min-w-0 rounded-sm border border-line bg-white px-3 text-[15px] outline-none focus:border-indigo sm:w-auto sm:min-w-52"
          />
          <div className="flex rounded-sm border border-line bg-white text-[14px]" role="group" aria-label="Filter">
            {(["all", "approved", "draft"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`h-10 px-3 ${filter === f ? "bg-indigo-soft font-medium text-indigo" : "text-[#475467] hover:bg-panel"}`}>
                {f === "all" ? "All" : f === "approved" ? "Ready to teach" : "Needs approval"}
              </button>
            ))}
          </div>
          <Link prefetch={false} href="/capture" className="inline-flex h-10 items-center rounded-sm bg-indigo px-4 text-[15px] text-white hover:bg-indigo-dark">
            ● Record a new workflow
          </Link>
        </div>

        <section className="mb-5 grid gap-4 sm:grid-cols-3" aria-label="Summary">
          {([["Workflows", (list ?? []).length, "text-[#1f2d3d]"], ["Ready to teach", approved, "text-ok"], ["Needs approval", (list ?? []).length - approved, "text-[#7a5a00]"]] as const).map(([label, n, color]) => (
            <div key={label} className="rounded-md border border-line bg-white px-4 py-3">
              <span className="block text-[12px] font-bold uppercase tracking-[.06em] text-[#667085]">{label}</span>
              <b className={`text-[26px] font-medium leading-[1.3] ${color}`}>{n}</b>
            </div>
          ))}
        </section>

        {list.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#c9c6f5] bg-white p-8 text-center">
            <h2 className="text-[18px] font-medium text-[#1f2d3d]">No workflows yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] text-[#475467]">
              {manager
                ? "Ask an experienced colleague to record a task they know well. Torchbearer watches, asks whenever something isn't clear, and turns it into a Work Map you can teach from."
                : "Workflows you record appear here. Record a task you know well and Torchbearer turns it into a Work Map."}
            </p>
            <Link prefetch={false} href="/capture" className="mt-5 inline-flex h-10 items-center rounded-sm bg-indigo px-4 text-[15px] text-white hover:bg-indigo-dark">
              Record {manager ? "the first" : "a"} workflow
            </Link>
          </div>
        ) : shown.length === 0 ? (
          <p className="mt-10 text-[15px] text-[#667085]">No workflows match.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {shown.map((w) => {
              const learning = assignments.filter((a) => a.workflowId === w.id && stateOf(a, today) !== "done");
              const late = learning.filter((a) => stateOf(a, today) === "late").length;
              return (
                <li key={w.id} className="flex flex-col rounded-md border border-line bg-white p-4 shadow-[0_4px_14px_rgba(16,24,40,.04)]">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 text-[16.5px] font-medium leading-snug text-[#1f2d3d]">{w.name || "Untitled workflow"}</h2>
                    {w.published ? (
                      <span className="pill shrink-0 rounded-full bg-ok-soft text-ok">Ready to teach</span>
                    ) : (
                      <span className="pill shrink-0 rounded-full bg-warn-soft text-[#7a5a00]">Needs approval</span>
                    )}
                  </div>
                  <p className="mt-1 text-[13.5px] text-[#667085]">
                    {w.stepCount} step{w.stepCount === 1 ? "" : "s"}
                    {manager ? (w.trainedBy ? ` · taught by ${w.trainedBy}` : "") : " · recorded by you"}
                    {day(w.createdAt) ? ` · ${day(w.createdAt)}` : ""}
                  </p>
                  {manager && learning.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Link href={`/assign?workflow=${encodeURIComponent(w.id)}`} className="rounded-sm bg-indigo-soft px-2 py-px text-[12.5px] text-indigo">{learning.length} learning it</Link>
                      {late > 0 && <Link href={`/assign?workflow=${encodeURIComponent(w.id)}`} className="rounded-sm bg-err-soft px-2 py-px text-[12.5px] text-err">{late} overdue</Link>}
                    </div>
                  )}
                  {manager && confirming === w.id ? (
                    <div className="mt-4 rounded-sm border border-[#f3c2c2] bg-err-soft px-3 py-2.5" role="alert">
                      <p className="text-[14px] text-[#8E1B1B]">
                        Delete &ldquo;{w.name || "Untitled workflow"}&rdquo;? This can&apos;t be undone.
                        {learning.length > 0 && ` It also removes ${learning.length} assignment${learning.length === 1 ? "" : "s"}.`}
                      </p>
                      {deleteError && <p className="mt-1 text-[13px] text-[#8E1B1B]">{deleteError}</p>}
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => remove(w.id)} disabled={deleting === w.id} className="inline-flex h-9 items-center rounded-sm bg-err px-3 text-[14px] text-white hover:opacity-90 disabled:opacity-60">
                          {deleting === w.id ? "Deleting…" : "Delete"}
                        </button>
                        <button onClick={() => { setConfirming(null); setDeleteError(null); }} className={`${btn} bg-white`}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {w.published ? (
                          <>
                            {manager ? (
                              <Link prefetch={false} href={`/assign?workflow=${encodeURIComponent(w.id)}`} className={btnPri}>Train a new hire</Link>
                            ) : (
                              <button onClick={() => setAsked(asked === w.id ? null : w.id)} className={btnPri}>Train a new hire</button>
                            )}
                            <Link prefetch={false} href={`/map?id=${encodeURIComponent(w.id)}`} className={btn}>View Work Map</Link>
                          </>
                        ) : (
                          <Link prefetch={false} href={`/map?id=${encodeURIComponent(w.id)}`} className="inline-flex h-9 items-center rounded-sm border border-indigo px-3 text-[14px] text-indigo hover:bg-indigo-soft">
                            Review and approve
                          </Link>
                        )}
                        <Link prefetch={false} href={`/process?id=${encodeURIComponent(w.id)}`} className={btn}>Process map</Link>
                        {manager && (
                          <button onClick={() => { setConfirming(w.id); setDeleteError(null); }} className="ml-auto inline-flex h-9 items-center rounded-sm px-2 text-[14px] text-[#667085] hover:bg-err-soft hover:text-err" aria-label={`Delete ${w.name || "workflow"}`}>
                            Delete
                          </button>
                        )}
                      </div>
                      {asked === w.id && (
                        <p className="mt-3 rounded-sm bg-indigo-soft px-3 py-2 text-[14px] text-[#3b3399]" role="status">
                          Only managers can assign workflows. Ask a manager to give this one to a new hire.
                        </p>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
