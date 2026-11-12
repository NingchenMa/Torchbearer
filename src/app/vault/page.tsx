"use client";
// The company's workflow vault: every workflow its experts have taught TorchBearer.
// Approved workflows can train a new hire right away; drafts go to the Work Map for approval.
// Any workflow can be deleted (asks once, inline).

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, GitBranch, Map as MapIcon, Search, Trash2, UserRound } from "lucide-react";
import { CountUp, Segmented, Spotlight, StepTrail } from "@/features/ui/fx";
import type { WorkflowSummary } from "@/lib/types";

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

export default function VaultPage() {
  const [list, setList] = useState<WorkflowSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "approved" | "draft">("all");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = async (id: string) => {
    setDeleting(id);
    setDeleteError(null);
    try {
      const r = await fetch(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      setList((l) => (l ?? []).filter((w) => w.id !== id));
      setConfirming(null);
    } catch {
      setDeleteError("Couldn't delete it. Please try again.");
    } finally {
      setDeleting(null);
    }
  };

  useEffect(() => {
    fetch("/api/workflows", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((l: WorkflowSummary[]) => setList(l))
      .catch(() => setList([]));
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? [])
      .filter((w) => (filter === "all" ? true : filter === "approved" ? w.published : !w.published))
      .filter((w) => !q || w.name.toLowerCase().includes(q) || (w.trainedBy ?? "").toLowerCase().includes(q))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [list, query, filter]);
  const approved = (list ?? []).filter((w) => w.published).length;

  const drafts = (list?.length ?? 0) - approved;
  // With "All", workflows waiting for approval come first, as their own group.
  const groups: [string, WorkflowSummary[]][] =
    filter === "all"
      ? ([
          ["Waiting for your approval", shown.filter((w) => !w.published)],
          ["Ready to train a new hire", shown.filter((w) => w.published)],
        ] as [string, WorkflowSummary[]][]).filter(([, g]) => g.length)
      : [["", shown]];
  const count = { all: list?.length ?? 0, approved, draft: drafts };

  return (
    <div className="min-h-full bg-cream">
      <section className="tb-hero relative overflow-hidden">
        <div className="relative mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6 px-4 pb-8 pt-8 sm:px-6">
          <div className="tb-rise min-w-0">
            <h1 className="font-display text-[40px] leading-none text-blush sm:text-[48px]">Workflows</h1>
            <p className="mt-3 text-[16px] text-blush-2">Recorded by your experts. Approve one, then train a new hire on it.</p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link prefetch={false} href="/capture" className="tb-btn-amber h-11">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-crimson" aria-hidden="true" /> Record a workflow
              </Link>
              <Link prefetch={false} href="/review" className="tb-btn-ghost h-11">Supervisor review</Link>
            </div>
          </div>
          {list && list.length > 0 && (
            <dl className="tb-rise grid grid-cols-3 gap-2.5" style={{ animationDelay: "120ms" }}>
              {(
                [
                  [list.length, "Recorded", "text-blush"],
                  [drafts, "Need approval", "text-amber"],
                  [approved, "Ready to train", "text-[#7fd6a4]"],
                ] as const
              ).map(([n, label, tone]) => (
                <div key={label} className="min-w-[96px] rounded-md border border-blush-2/15 bg-white/[.04] px-4 py-3 backdrop-blur-sm">
                  <dd className={`font-display text-[34px] leading-none ${tone}`}><CountUp to={n} /></dd>
                  <dt className="mt-1.5 text-[12.5px] text-blush-2">{label}</dt>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative w-full sm:max-w-sm sm:flex-1">
            <span className="sr-only">Search workflows</span>
            <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by workflow or expert"
              className="h-11 w-full rounded-full border border-line bg-white pl-10 pr-4 text-[15px] outline-none transition-[border-color,box-shadow] focus:border-crimson focus:ring-2 focus:ring-crimson/15"
            />
          </label>
          <div className="max-w-full overflow-x-auto">
            <Segmented
              label="Filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All", count: list ? count.all : undefined },
                { value: "draft", label: "Needs approval", count: list ? count.draft : undefined },
                { value: "approved", label: "Ready to train", count: list ? count.approved : undefined },
              ]}
            />
          </div>
        </div>

        {list === null ? (
          <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((k) => (
              <li key={k} className="h-[188px] animate-pulse rounded-lg border border-line bg-white" />
            ))}
          </ul>
        ) : list.length === 0 ? (
          <div className="mt-6 rounded-lg border border-line bg-white px-6 py-12 text-center">
            <h2 className="font-display text-[30px] leading-tight text-ink">
              No workflows <span className="font-serif italic text-crimson">yet.</span>
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[16px] leading-relaxed text-muted">
              Ask an experienced colleague to record a task they know well. TorchBearer watches, asks why, and builds a Work Map you can
              train from.
            </p>
            <Link prefetch={false} href="/capture" className="tb-btn-amber mt-6 h-11">Record the first workflow</Link>
          </div>
        ) : shown.length === 0 ? (
          <p className="mt-10 text-[16px] text-muted">No workflows match &ldquo;{query}&rdquo;.</p>
        ) : (
          groups.map(([title, items]) => (
            <section key={title || "list"} className="mt-8">
              {title && (
                <h2 className="mb-4 flex items-baseline gap-2.5 font-display text-[24px] text-ink">
                  {title}
                  <span className="font-sans text-[14px] tabular-nums text-muted">{items.length}</span>
                </h2>
              )}
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map((w, k) => (
                  <Spotlight
                    as="li"
                    key={w.id}
                    style={{ animationDelay: `${Math.min(k, 9) * 50}ms` }}
                    className="tb-rise flex flex-col rounded-lg border border-line bg-white p-5 shadow-[0_1px_2px_rgba(58,11,20,.04)] transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(58,11,20,.12)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 font-display text-[22px] leading-tight text-ink [text-wrap:balance]">{w.name || "Untitled workflow"}</h3>
                      <span className={`mt-1 shrink-0 text-[12px] font-bold uppercase tracking-[.1em] ${w.published ? "text-ok" : "text-[#a06d00]"}`}>
                        {w.published ? "Ready" : "Draft"}
                      </span>
                    </div>
                    <div className="mt-4">
                      <StepTrail count={w.stepCount} lit={!!w.published} />
                      <p className="mt-2 text-[13.5px] text-muted">
                        {w.stepCount} step{w.stepCount === 1 ? "" : "s"}
                        {day(w.createdAt) ? ` · ${day(w.createdAt)}` : ""}
                      </p>
                    </div>
                    {w.trainedBy && (
                      <p className="mt-3 flex items-center gap-2 text-[14px] text-muted">
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-cream text-crimson">
                          <UserRound size={15} aria-hidden="true" />
                        </span>
                        Taught by <span className="font-serif italic text-crimson">{w.trainedBy}</span>
                      </p>
                    )}

                    <div className="mt-auto pt-5">
                      {confirming === w.id ? (
                        <div className="rounded-md border border-[#f3c2c2] bg-err-soft px-3 py-2.5" role="alert">
                          <p className="text-[14px] text-[#8E1B1B]">{deleteError ?? "Delete this workflow? This can\u2019t be undone."}</p>
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => remove(w.id)}
                              disabled={deleting === w.id}
                              className="inline-flex h-10 items-center rounded-full bg-err px-4 text-[14px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                            >
                              {deleting === w.id ? "Deleting…" : "Delete"}
                            </button>
                            <button onClick={() => { setConfirming(null); setDeleteError(null); }} className="tb-btn-line h-10">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                          <Link
                            prefetch={false}
                            href={w.published ? `/teach?id=${encodeURIComponent(w.id)}` : `/map?id=${encodeURIComponent(w.id)}`}
                            className="tb-btn-dark group/btn h-10"
                          >
                            {w.published ? "Train a new hire" : "Review and approve"}
                            <ArrowRight size={16} className="transition-transform duration-200 group-hover/btn:translate-x-1" aria-hidden="true" />
                          </Link>
                          {w.published && (
                            <Link prefetch={false} href={`/map?id=${encodeURIComponent(w.id)}`} className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-crimson/40 hover:text-crimson" title="Work Map" aria-label="Work Map">
                              <MapIcon size={17} aria-hidden="true" />
                            </Link>
                          )}
                          <Link prefetch={false} href={`/process?id=${encodeURIComponent(w.id)}`} className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-crimson/40 hover:text-crimson" title="Process map" aria-label="Process map">
                            <GitBranch size={17} aria-hidden="true" />
                          </Link>
                          <button
                            onClick={() => { setConfirming(w.id); setDeleteError(null); }}
                            className="ml-auto grid h-10 w-10 place-items-center rounded-full text-muted transition-colors hover:bg-err-soft hover:text-err"
                            aria-label={`Delete ${w.name || "workflow"}`}
                            title="Delete"
                          >
                            <Trash2 size={17} aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  </Spotlight>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
