"use client";
// Assign: give an approved workflow to one or more employees, and follow how far each has got.
// Managers and admins only. Anyone else is told they lack access, and nothing is requested for them
// (the server refuses it too: /api/assignments and /api/members answer 403).
//   left   new assignment: workflow, people, finish-by date, note, and a preview of what they will see
//   right  current assignments: filter by status or workflow, change a date, take one back

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import NoAccess from "@/features/nav/NoAccess";
import { STATE_LABEL, STATE_RANK, dueText, stateOf, todayIso, type AssignmentState } from "@/lib/assignmentStatus";
import type { AssignmentView, Member, WorkflowSummary } from "@/lib/types";
import { useMe } from "@/lib/useMe";

const readWorkflow = () => {
  try {
    return new URLSearchParams(window.location.search).get("workflow") ?? "";
  } catch {
    return "";
  }
};

const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const short = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const plus = (days: number) => new Date(Date.parse(todayIso()) + days * 864e5).toISOString().slice(0, 10);
const STATE_STYLE: Record<AssignmentState, string> = {
  none: "bg-[#eef0f3] text-[#475467]",
  progress: "bg-indigo-soft text-indigo",
  relearn: "bg-warn-soft text-[#7a5a00]",
  done: "bg-ok-soft text-ok",
  late: "bg-err-soft text-err",
};

export default function AssignPage() {
  const { canAssign, loading } = useMe();
  if (loading) return <div className="grid min-h-full place-items-center bg-[#f6f8fc] text-[15px] text-[#667085]">Loading…</div>;
  if (!canAssign) {
    return (
      <div className="min-h-full bg-[#f6f8fc]">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-7">
          <h1 className="pb-1 pt-6 text-[26px] font-medium leading-tight text-[#1f2d3d]">Assign</h1>
          <NoAccess message="You lack access to assign workflows to other employees." />
        </div>
      </div>
    );
  }
  return <Assign />;
}

function Assign() {
  const preset = useSyncExternalStore(() => () => {}, readWorkflow, () => "");
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [assignments, setAssignments] = useState<AssignmentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The form
  const [chosen, setChosen] = useState<string | undefined>(undefined); // undefined = use ?workflow
  const workflowId = chosen ?? preset;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // The table
  const [status, setStatus] = useState<"all" | AssignmentState>("all");
  const [wfFilter, setWfFilter] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const today = todayIso();

  const reload = useCallback(async () => {
    const a = await fetch("/api/assignments", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (a) setAssignments(a as AssignmentView[]);
    else setError("Couldn't load the assignments. Check the connection and refresh.");
  }, []);
  useEffect(() => {
    fetch("/api/workflows", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then((l: WorkflowSummary[]) => setWorkflows(l)).catch(() => setWorkflows([]));
    fetch("/api/members", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then((m: Member[]) => setMembers(m)).catch(() => {});
    fetch("/api/assignments", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((a: AssignmentView[]) => setAssignments(a))
      .catch(() => setError("Couldn't load the assignments. Check the connection and refresh."));
  }, []);

  const ready = useMemo(() => (workflows ?? []).filter((w) => w.published).sort((a, b) => a.name.localeCompare(b.name)), [workflows]);
  const drafts = (workflows ?? []).length - ready.length;
  const selected = ready.find((w) => w.id === workflowId);
  const all = assignments ?? [];
  const stateFor = (a: AssignmentView) => stateOf(a, today);
  const active = (id: string, learner: string) => all.some((a) => a.workflowId === id && a.learnerId === learner && stateFor(a) !== "done");

  const people = members.filter((m) => !search.trim() || m.name.toLowerCase().includes(search.trim().toLowerCase()));
  const free = members.filter((m) => !selected || !active(selected.id, m.id));
  const chosenPeople = [...picked].filter((id) => free.some((m) => m.id === id));
  const dueBad = !!due && due < today;
  const names = chosenPeople.map((id) => members.find((m) => m.id === id)?.name ?? "");
  const who = names.length === 1 ? names[0] : names.length === 2 ? names.join(" and ") : `${names[0]} and ${names.length - 1} others`;

  const counts: Record<string, number> = { all: all.length };
  for (const a of all) counts[stateFor(a)] = (counts[stateFor(a)] ?? 0) + 1;
  const rows = all
    .filter((a) => (status === "all" || stateFor(a) === status) && (!wfFilter || a.workflowId === wfFilter))
    .sort((a, b) => STATE_RANK[stateFor(a)] - STATE_RANK[stateFor(b)] || (a.due ?? "9").localeCompare(b.due ?? "9"));

  async function assign() {
    if (!selected || !chosenPeople.length || dueBad) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: selected.id, learnerIds: chosenPeople, due: due || undefined, note }),
      });
      if (!r.ok) throw new Error();
      setFlash(`${selected.name} assigned to ${chosenPeople.length} new hire${chosenPeople.length === 1 ? "" : "s"}`);
      setPicked(new Set());
      setDue("");
      setNote("");
      await reload();
    } catch {
      setError("Couldn't assign it. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function changeDue(a: AssignmentView, value: string) {
    setAssignments((l) => (l ?? []).map((x) => (x.id === a.id ? { ...x, due: value || undefined } : x)));
    const r = await fetch(`/api/assignments/${encodeURIComponent(a.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ due: value || null }) });
    if (!r.ok) {
      setError("Couldn't change the date.");
      reload();
    }
  }

  async function remove(a: AssignmentView) {
    const r = await fetch(`/api/assignments/${encodeURIComponent(a.id)}`, { method: "DELETE" });
    setRemoving(null);
    if (r.ok) {
      setFlash(`Removed ${a.learnerName} from ${a.workflowName}`);
      setAssignments((l) => (l ?? []).filter((x) => x.id !== a.id));
    } else setError("Couldn't remove it. Please try again.");
  }

  const panel = "rounded-md border border-line bg-white shadow-[0_4px_14px_rgba(16,24,40,.04)]";
  const panelHead = "flex items-center gap-2.5 rounded-t-md border-b border-line bg-panel-2 px-4 py-3 text-[13px] font-bold uppercase tracking-[.05em] text-[#444]";
  const label = "mb-1.5 flex items-center text-[12px] font-bold uppercase tracking-[.06em] text-[#667085]";
  const field = "w-full rounded-sm border border-[#9aa0a6] bg-white px-3 focus:border-indigo focus:outline-none";

  return (
    <div className="min-h-full bg-[#f6f8fc]">
      <div className="mx-auto max-w-[1240px] px-4 pb-10 sm:px-7">
        <h1 className="pb-5 pt-6 text-[26px] font-medium leading-tight text-[#1f2d3d]">Assign</h1>

        <section className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Assignment summary">
          {([
            ["Active", all.length - (counts.done ?? 0), "text-[#1f2d3d]"],
            ["Overdue", counts.late ?? 0, "text-err"],
            ["Needs relearn", counts.relearn ?? 0, "text-[#7a5a00]"],
            ["Done", counts.done ?? 0, "text-ok"],
          ] as const).map(([l, n, color]) => (
            <div key={l} className="rounded-md border border-line bg-white px-4 py-3">
              <span className="block text-[12px] font-bold uppercase tracking-[.06em] text-[#667085]">{l}</span>
              <b className={`text-[26px] font-medium leading-[1.3] ${color}`}>{n}</b>
            </div>
          ))}
        </section>

        {(flash || error) && (
          <p role="status" className={`mb-4 rounded-md border px-4 py-3 text-[14.5px] ${error ? "border-[#f3c2c2] bg-err-soft text-[#8e1b1b]" : "border-[#bfe3cc] bg-ok-soft text-ok"}`}>
            {error ?? flash}
          </p>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
          <div>
            <div className={panel}>
              <h2 className={panelHead}>New assignment</h2>
              <div className="flex flex-col gap-4 p-4">
                <label className="block">
                  <span className={label}>1 · Workflow</span>
                  <select value={workflowId} onChange={(e) => setChosen(e.target.value)} className={`${field} h-10`}>
                    <option value="">Choose a workflow…</option>
                    {ready.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.stepCount} steps</option>)}
                  </select>
                  {selected && <p className="mt-1.5 text-[13px] text-[#667085]">{selected.trainedBy ? `Taught by ${selected.trainedBy}. ` : ""}{all.filter((a) => a.workflowId === selected.id && stateFor(a) !== "done").length} learning it now.</p>}
                </label>

                <div>
                  <div className={label}>
                    2 · Who should learn it
                    {selected && free.length > 0 && (
                      <button type="button" onClick={() => setPicked(new Set(free.map((m) => m.id)))} className="ml-auto text-[13px] font-normal normal-case tracking-normal text-indigo">Select everyone free</button>
                    )}
                  </div>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" aria-label="Search people" className="mb-2 h-9 w-full rounded-sm border border-line px-3 focus:border-indigo focus:outline-none" />
                  <div className="max-h-[232px] overflow-auto rounded-sm border border-line">
                    {people.length === 0 && (
                      <div className="bg-panel px-3 py-2.5 text-[14px] text-[#98a2b3]">
                        {members.length === 0 ? "Nobody has signed in yet. People appear here after their first sign-in." : "No one matches."}
                      </div>
                    )}
                    {people.map((m, i) => {
                      const has = !!selected && active(selected.id, m.id);
                      const n = all.filter((a) => a.learnerId === m.id && stateFor(a) !== "done").length;
                      return (
                        <label key={m.id} className={`flex items-center gap-2.5 px-3 py-2 ${i ? "border-t border-line" : ""} ${has ? "cursor-default bg-panel text-[#98a2b3]" : "cursor-pointer hover:bg-panel"}`}>
                          <input
                            type="checkbox"
                            disabled={has}
                            checked={picked.has(m.id) && !has}
                            onChange={(e) => setPicked((p) => { const x = new Set(p); if (e.target.checked) x.add(m.id); else x.delete(m.id); return x; })}
                            className="h-4 w-4 accent-[#5146d9]"
                          />
                          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-medium ${has ? "bg-[#eef0f3] text-[#98a2b3]" : "bg-indigo-soft text-indigo"}`}>{initials(m.name)}</span>
                          <span className="min-w-0">
                            {m.name}
                            <small className="block truncate text-[12.5px] text-[#667085]">{n ? `${n} workflow${n > 1 ? "s" : ""} in progress` : "Nothing in progress"}</small>
                          </span>
                          {has && <span className="ml-auto whitespace-nowrap rounded-full bg-warn-soft px-2 text-[12px] text-[#7a5a00]">Already has it</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="due" className={label}>3 · Finish by (optional)</label>
                  <input id="due" type="date" min={today} value={due} onChange={(e) => setDue(e.target.value)} className={`${field} h-10`} />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {([["In 1 week", 7], ["In 2 weeks", 14], ["In a month", 30], ["No date", 0]] as const).map(([l, d]) => (
                      <button key={l} type="button" onClick={() => setDue(d ? plus(d) : "")} className="h-[30px] rounded-full border border-line bg-white px-2.5 text-[13px] text-[#475467] hover:border-[#c9c6f5] hover:bg-indigo-soft hover:text-indigo">{l}</button>
                    ))}
                  </div>
                  {dueBad && <p className="mt-1.5 text-[13px] text-err">That date has already passed.</p>}
                </div>

                <label className="block">
                  <span className={label}>Note for the new hire (optional)</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Start with the receipt rules" className={`${field} h-16 resize-y py-2`} />
                </label>

                <div className={`rounded-md px-3 py-2.5 text-[14px] ${selected && chosenPeople.length ? "bg-indigo-soft text-[#3b3399]" : "bg-panel-2 text-[#667085]"}`}>
                  {selected && chosenPeople.length ? (
                    <>
                      {who} will find <b>{selected.name}</b> first in Training{due && !dueBad ? <>, to finish by <b>{short(due)}</b></> : ""}.{note.trim() ? " Your note comes with it." : ""}
                    </>
                  ) : "Choose a workflow and at least one new hire."}
                </div>
                <button onClick={assign} disabled={!selected || !chosenPeople.length || dueBad || saving} className="h-10 rounded-sm border border-indigo bg-indigo px-4 text-[15px] text-white hover:bg-indigo-dark disabled:cursor-default disabled:opacity-40">
                  {saving ? "Assigning…" : chosenPeople.length > 1 ? `Assign to ${chosenPeople.length} new hires` : "Assign"}
                </button>
              </div>
            </div>
            {drafts > 0 && (
              <p className="mt-3.5 rounded-md border border-dashed border-[#c9c6f5] bg-white px-3.5 py-2.5 text-[14px] text-[#475467]">
                {drafts} workflow{drafts === 1 ? " isn't" : "s aren't"} ready to teach yet, so {drafts === 1 ? "it isn't" : "they aren't"} listed.{" "}
                <Link href="/vault" className="text-indigo underline">Review and approve {drafts === 1 ? "it" : "them"}</Link>.
              </p>
            )}
          </div>

          <div className={panel}>
            <h2 className={panelHead}>
              Current assignments
              <span className="ml-auto text-[13px] font-normal normal-case tracking-normal text-[#667085]">
                {rows.length === all.length ? `${all.length} assignment${all.length === 1 ? "" : "s"}` : `${rows.length} of ${all.length}`}
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
              <div className="flex flex-wrap rounded-sm border border-line bg-white text-[14px]" role="group" aria-label="Status">
                {(["all", "late", "relearn", "progress", "none", "done"] as const).filter((k) => k === "all" || counts[k]).map((k) => (
                  <button key={k} onClick={() => setStatus(k)} aria-pressed={status === k} className={`h-[38px] px-3 ${status === k ? "bg-indigo-soft font-medium text-indigo" : "text-[#475467]"}`}>
                    {k === "all" ? "All" : STATE_LABEL[k]}
                    <i className="ml-1.5 text-[12.5px] not-italic text-[#98a2b3]">{counts[k] ?? 0}</i>
                  </button>
                ))}
              </div>
              <select value={wfFilter} onChange={(e) => setWfFilter(e.target.value)} aria-label="Workflow" className="ml-auto h-[38px] rounded-sm border border-[#9aa0a6] bg-white px-2.5 text-[14px]">
                <option value="">All workflows</option>
                {[...new Map(all.map((a) => [a.workflowId, a.workflowName])).entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] font-bold uppercase tracking-[.06em] text-[#667085]">
                    <th className="px-3 py-2.5">New hire</th><th className="px-3 py-2.5">Finish by</th><th className="px-3 py-2.5">Progress</th><th className="px-3 py-2.5">Status</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const st = stateFor(a);
                    return (
                      <tr key={a.id} className={`border-b border-line last:border-0 ${st === "late" ? "shadow-[inset_3px_0_0_var(--color-err)]" : ""}`}>
                        <td className="px-3 py-3 align-middle">
                          <b className="font-medium">{a.learnerName}</b>
                          <span className="block text-[12.5px] text-[#667085]">{a.workflowName}</span>
                          {a.note && <span className="block max-w-[220px] truncate text-[12.5px] italic text-[#667085]" title={a.note}>&ldquo;{a.note}&rdquo;</span>}
                        </td>
                        <td className="px-3 py-3 align-middle">
                          {st === "done" ? (
                            <span className="text-[12.5px] text-[#667085]">{a.due ? short(a.due) : "–"}</span>
                          ) : (
                            <>
                              <input type="date" value={a.due ?? ""} onChange={(e) => changeDue(a, e.target.value)} aria-label="Finish by" className={`h-8 w-[128px] rounded-sm border border-transparent bg-transparent px-1.5 hover:border-[#9aa0a6] hover:bg-white focus:border-[#9aa0a6] focus:bg-white ${st === "late" ? "font-medium text-err" : ""}`} />
                              <span className="block text-[12.5px] text-[#667085]">{dueText(a.due, today)}</span>
                            </>
                          )}
                        </td>
                        <td className="min-w-[120px] px-3 py-3 align-middle">
                          <div className="h-1.5 overflow-hidden rounded-[3px] bg-[#eceef1]"><i className="block h-full bg-indigo" style={{ width: `${Math.min(100, Math.round((a.learned / Math.max(1, a.stepCount)) * 100))}%` }} /></div>
                          <small className="mt-1 block whitespace-nowrap text-[12.5px] text-[#667085]">{a.learned}/{a.stepCount} learned{a.relearn ? ` · ${a.relearn} to relearn` : ""}</small>
                        </td>
                        <td className="px-3 py-3 align-middle"><span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${STATE_STYLE[st]}`}>{STATE_LABEL[st]}</span></td>
                        <td className="px-3 py-3 text-right align-middle">
                          {removing === a.id ? (
                            <span className="whitespace-nowrap text-[13px]">
                              Remove? <button onClick={() => remove(a)} className="text-err underline">Yes</button> · <button onClick={() => setRemoving(null)} className="text-[#667085] underline">No</button>
                            </span>
                          ) : (
                            <button onClick={() => setRemoving(a.id)} className="rounded-sm px-2 py-1 text-[13.5px] text-[#667085] hover:bg-err-soft hover:text-err" aria-label={`Remove ${a.learnerName} from ${a.workflowName}`}>Remove</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {assignments === null && <p className="p-8 text-center text-[#667085]">Loading…</p>}
            {assignments !== null && rows.length === 0 && (
              <p className="p-8 text-center text-[#475467]">{all.length ? "Nothing matches this filter." : "No assignments yet. Pick a workflow and a new hire on the left."}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
