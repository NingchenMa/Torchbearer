"use client";
// Workflows: the workflows the signed-in person may see, newest first.
//   Managers and admins: every workflow at the company, searchable by workflow or expert, with every action
//     (train a new hire, Work Map, Process map, review and approve, delete) and who is learning each one.
//   Employees: only the workflows they recorded, with Train a new hire, Work Map and Process map.
// The server decides what each person gets (/api/workflows); this page only decides how it looks.
// Looks: the TorchBearer website theme (serif headings, maroon and amber, pill buttons).

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, GitBranch, Map as MapIcon, Search, Trash2, UserRound } from "lucide-react";
import { stateOf, todayIso } from "@/lib/assignmentStatus";
import { CountUp, Segmented, Spotlight, StepTrail } from "@/features/ui/fx";
import type { AssignmentView, WorkflowSummary } from "@/lib/types";
import { useMe } from "@/lib/useMe";

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

type SortKey = "newest" | "oldest" | "nameAZ" | "nameZA" | "mostSteps" | "fewestSteps" | "status";
const byNewest = (a: WorkflowSummary, b: WorkflowSummary) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
const byName = (a: WorkflowSummary, b: WorkflowSummary) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
/** How the Workflows cards can be ordered; ties fall back to newest first. */
const SORTS: Record<SortKey, { label: string; compare: (a: WorkflowSummary, b: WorkflowSummary) => number }> = {
  newest: { label: "Newest first", compare: byNewest },
  oldest: { label: "Oldest first", compare: (a, b) => byNewest(b, a) },
  nameAZ: { label: "Name A to Z", compare: (a, b) => byName(a, b) || byNewest(a, b) },
  nameZA: { label: "Name Z to A", compare: (a, b) => byName(b, a) || byNewest(a, b) },
  mostSteps: { label: "Most steps", compare: (a, b) => b.stepCount - a.stepCount || byNewest(a, b) },
  fewestSteps: { label: "Fewest steps", compare: (a, b) => a.stepCount - b.stepCount || byNewest(a, b) },
  status: { label: "Needs approval first", compare: (a, b) => Number(a.published) - Number(b.published) || byNewest(a, b) },
};

export default function VaultPage() {
  const { manager, loading: meLoading } = useMe();
  const [list, setList] = useState<WorkflowSummary[] | null>(null);
  const [assignments, setAssignments] = useState<AssignmentView[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "approved" | "draft">("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      .sort(SORTS[sort].compare);
  }, [list, query, filter, manager, sort]);
  const total = (list ?? []).length;
  const approved = (list ?? []).filter((w) => w.published).length;
  const drafts = total - approved;
  const today = todayIso();

  if (list === null || meLoading) {
    return (
      <div className="min-h-full bg-cream">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-7" aria-hidden="true">
          <div className="pb-5 pt-7"><div className="h-9 w-48 animate-pulse rounded-md bg-blush" /></div>
          <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {[0, 1, 2].map((k) => <li key={k} className="h-[188px] animate-pulse rounded-lg border border-line bg-white" />)}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-cream">
      <main className="mx-auto max-w-[1240px] px-4 pb-12 sm:px-7">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-5 pt-7">
          <h1 className="mr-auto font-display text-[36px] leading-none text-ink">Workflows</h1>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search workflows</span>
            <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={manager ? "Search by workflow or expert" : "Search your workflows"}
              className="h-11 w-full rounded-full border border-line bg-white pl-10 pr-4 text-[15px] outline-none transition-[border-color,box-shadow] focus:border-crimson focus:ring-2 focus:ring-crimson/15"
            />
          </label>
          <div className="max-w-full overflow-x-auto">
            <Segmented
              label="Filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All", count: total },
                { value: "approved", label: "Ready to teach", count: approved },
                { value: "draft", label: "Needs approval", count: drafts },
              ]}
            />
          </div>
          <label className="relative">
            <span className="sr-only">Sort workflows</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-11 cursor-pointer appearance-none rounded-full border border-line bg-white pl-4 pr-10 text-[15px] text-ink outline-none transition-[border-color,box-shadow] focus:border-crimson focus:ring-2 focus:ring-crimson/15"
            >
              {(Object.keys(SORTS) as SortKey[]).map((k) => (
                <option key={k} value={k}>{SORTS[k].label}</option>
              ))}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          </label>
          <Link prefetch={false} href="/capture" className="tb-btn-amber h-11">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-crimson" aria-hidden="true" /> Record a new workflow
          </Link>
        </div>

        <dl className="mb-6 grid gap-4 sm:grid-cols-3" aria-label="Summary">
          {([["Workflows", total, "text-ink"], ["Ready to teach", approved, "text-ok"], ["Needs approval", drafts, "text-[#a06d00]"]] as const).map(([label, n, tone]) => (
            <div key={label} className="rounded-lg border border-line bg-white px-5 py-4">
              <dt className="text-[12px] font-bold uppercase tracking-[.1em] text-muted">{label}</dt>
              <dd className={`mt-1 font-display text-[36px] leading-none ${tone}`}><CountUp to={n} /></dd>
            </div>
          ))}
        </dl>

        {total === 0 ? (
          <div className="rounded-lg border border-line bg-white px-6 py-12 text-center">
            <h2 className="font-display text-[30px] leading-tight text-ink">
              No workflows <span className="font-serif italic text-crimson">yet.</span>
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[16px] leading-relaxed text-muted">
              {manager
                ? "Ask an experienced colleague to record a task they know well. TorchBearer watches, asks whenever something isn't clear, and builds a Work Map you can train from."
                : "Workflows you record appear here. Record a task you know well and TorchBearer turns it into a Work Map."}
            </p>
            <Link prefetch={false} href="/capture" className="tb-btn-amber mt-6 h-11">Record {manager ? "the first" : "a"} workflow</Link>
          </div>
        ) : shown.length === 0 ? (
          <p className="mt-10 text-[16px] text-muted">No workflows match &ldquo;{query}&rdquo;.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((w, k) => {
              const learning = assignments.filter((a) => a.workflowId === w.id && stateOf(a, today) !== "done");
              const late = learning.filter((a) => stateOf(a, today) === "late").length;
              return (
                <Spotlight
                  as="li"
                  key={w.id}
                  style={{ animationDelay: `${Math.min(k, 9) * 50}ms` }}
                  className="tb-rise flex flex-col rounded-lg border border-line bg-white p-5 shadow-[0_1px_2px_rgba(58,11,20,.04)] transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(58,11,20,.12)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 font-display text-[22px] leading-tight text-ink [text-wrap:balance]">{w.name || "Untitled workflow"}</h2>
                    <span className={`mt-1 shrink-0 text-[12px] font-bold uppercase tracking-[.1em] ${w.published ? "text-ok" : "text-[#a06d00]"}`}>
                      {w.published ? "Ready to teach" : "Needs approval"}
                    </span>
                  </div>
                  <div className="mt-4">
                    <StepTrail count={w.stepCount} lit={!!w.published} />
                    <p className="mt-2 text-[13.5px] text-muted">
                      {w.stepCount} step{w.stepCount === 1 ? "" : "s"}
                      {day(w.createdAt) ? ` · ${day(w.createdAt)}` : ""}
                    </p>
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-[14px] text-muted">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-cream text-crimson"><UserRound size={15} aria-hidden="true" /></span>
                    {manager ? (
                      w.trainedBy ? <>Taught by <span className="font-serif italic text-crimson">{w.trainedBy}</span></> : "Recorder not on file"
                    ) : (
                      <>Recorded <span className="font-serif italic text-crimson">by you</span></>
                    )}
                  </p>
                  {manager && learning.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Link href={`/assign?workflow=${encodeURIComponent(w.id)}`} className="rounded-full bg-cream px-2.5 py-px text-[12.5px] text-crimson transition-colors hover:bg-blush">{learning.length} learning it</Link>
                      {late > 0 && <Link href={`/assign?workflow=${encodeURIComponent(w.id)}`} className="rounded-full bg-err-soft px-2.5 py-px text-[12.5px] text-err">{late} overdue</Link>}
                    </div>
                  )}

                  <div className="mt-auto pt-5">
                    {manager && confirming === w.id ? (
                      <div className="rounded-md border border-[#f3c2c2] bg-err-soft px-3 py-2.5" role="alert">
                        <p className="text-[14px] text-[#8E1B1B]">
                          Delete &ldquo;{w.name || "Untitled workflow"}&rdquo;? This can&apos;t be undone.
                          {learning.length > 0 && ` It also removes ${learning.length} assignment${learning.length === 1 ? "" : "s"}.`}
                        </p>
                        {deleteError && <p className="mt-1 text-[13px] text-[#8E1B1B]">{deleteError}</p>}
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => remove(w.id)} disabled={deleting === w.id} className="inline-flex h-10 items-center rounded-full bg-err px-4 text-[14px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60">
                            {deleting === w.id ? "Deleting…" : "Delete"}
                          </button>
                          <button onClick={() => { setConfirming(null); setDeleteError(null); }} className="tb-btn-line h-10">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                          {!w.published && (
                            <Link prefetch={false} href={`/map?id=${encodeURIComponent(w.id)}`} className="tb-btn-dark h-10">
                              <MapIcon size={16} aria-hidden="true" /> Work Map
                            </Link>
                          )}
                          {/* One map per state: the Work Map (review, edit, approve) until approved, the Process map after. */}
                          {w.published && (
                            <Link prefetch={false} href={`/process?id=${encodeURIComponent(w.id)}`} className="tb-btn-dark h-10"><GitBranch size={16} aria-hidden="true" /> Process map</Link>
                          )}
                          {manager && (
                            <button
                              onClick={() => { setConfirming(w.id); setDeleteError(null); }}
                              className="ml-auto grid h-10 w-10 place-items-center rounded-full text-muted transition-colors hover:bg-err-soft hover:text-err"
                              aria-label={`Delete ${w.name || "workflow"}`}
                              title="Delete"
                            >
                              <Trash2 size={17} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </Spotlight>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
