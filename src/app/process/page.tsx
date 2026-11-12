"use client";
// Process map for one saved workflow (?id=…): how the work flows from step to step.
//   - time each step took (from the recording's step times)
//   - the tool / system / site each step happens in, as a timeline per tool
//   - the data each step needs and where it comes from, what it produces, which later steps use it
//   - the decisions made, and what is still unknown (questions for the expert)
// Times are computed here; tools, data and links are built once by /api/processmap and stored on the workflow.

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import NoAccess from "@/features/nav/NoAccess";
import { EXAMPLE_ID, getWorkflowAccess, listWorkflows } from "@/lib/session";
import type { WorkflowRecord, WorkflowSummary, WorkMapStep } from "@/lib/types";
import { ProcessDiagram } from "@/features/workmap/ProcessDiagram";

const readId = () => {
  try {
    return new URLSearchParams(window.location.search).get("id");
  } catch {
    return null;
  }
};

/** "mm:ss" or "h:mm:ss" → seconds; NaN when unreadable. */
function toSec(t: string): number {
  const p = (t ?? "").split(":").map(Number);
  if (!p.length || p.some((n) => Number.isNaN(n))) return NaN;
  return p.reduce((a, n) => a * 60 + n, 0);
}
function fmt(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "–";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

interface Timed {
  step: WorkMapStep;
  index: number;
  start: number; // seconds from the first step
  duration: number | null; // until the next step starts; unknown for the last step
}

function timeSteps(steps: WorkMapStep[]): Timed[] {
  const t0 = toSec(steps[0]?.time);
  return steps.map((step, index) => {
    const start = toSec(step.time) - t0;
    const next = steps[index + 1] ? toSec(steps[index + 1].time) - t0 : NaN;
    const duration = Number.isFinite(next) && Number.isFinite(start) && next >= start ? next - start : null;
    return { step, index, start: Number.isFinite(start) ? start : 0, duration };
  });
}

// A small fixed palette for tools (works on light backgrounds).
const TOOL_COLORS = ["#5146d9", "#2f74d0", "#0f8a6a", "#b25e09", "#a23b72", "#4b5563"];

export default function ProcessMapPage() {
  const idParam = useSyncExternalStore(() => () => {}, readId, () => null);
  const [library, setLibrary] = useState<WorkflowSummary[]>([]);
  const [record, setRecord] = useState<WorkflowRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false); // the server refused: not the recorder, not a manager
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listWorkflows().then(async (list) => {
      if (!live) return;
      setLibrary(list);
      const { record: loaded, denied: refused } = await getWorkflowAccess(idParam ?? list[0]?.id);
      if (live) {
        setDenied(refused);
        setRecord(loaded);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [idParam]);

  async function build() {
    if (!record) return;
    setBuilding(true);
    setError(null);
    try {
      const r = await fetch("/api/processmap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
      setRecord(data as WorkflowRecord);
    } catch (e) {
      setError(e instanceof Error && /longer than|503|429|demand/.test(e.message) ? "The AI model is busy right now. Try again in a minute." : "Couldn't build the process map. Try again.");
    } finally {
      setBuilding(false);
    }
  }

  if (loading) {
    return <div className="grid min-h-full place-items-center bg-[#f6f8fc] text-[15px] text-[#667085]">Loading the workflow…</div>;
  }
  if (denied) return <NoAccess message="You lack permission to edit or review this workflow." />;
  if (!record) {
    return (
      <div className="grid min-h-full place-items-center bg-[#f6f8fc] p-6 text-center text-[15px] text-[#475467]">
        <div>
          No recorded workflow yet. <Link href="/capture" className="text-indigo underline">Record one</Link>.
        </div>
      </div>
    );
  }

  const steps = record.map.steps;
  const timed = timeSteps(steps);
  const built = steps.some((s) => s.process);
  const total = timed.reduce((a, t) => a + (t.duration ?? 0), 0);
  const tools = [...new Set(steps.map((s) => s.process?.tool).filter((t): t is string => !!t))];
  const color = (tool?: string) => TOOL_COLORS[Math.max(0, tools.indexOf(tool ?? "")) % TOOL_COLORS.length];
  const decisions = steps.filter((s) => s.process?.decision || s.guardrails.length).length;
  const questions = steps.reduce((a, s) => a + (s.process?.unknown.length ?? 0), 0);
  const order = new Map(steps.map((s, i) => [s.id, i + 1]));

  const tiles: [string, string][] = [
    [String(steps.length), "Steps"],
    [fmt(total), "Recorded time"],
    [built ? String(tools.length) : "–", "Tools and sites"],
    [built ? String(decisions) : "–", "Decision points"],
    [built ? String(questions) : "–", "Open questions"],
  ];

  return (
    <div className="min-h-full bg-[#f6f8fc]">
      <section className="border-b border-line bg-[linear-gradient(180deg,#f3f2ff_0%,#ffffff_100%)]">
        <div className="mx-auto max-w-6xl px-4 pb-7 pt-5 sm:px-6">
          <div className="mb-4 flex flex-wrap items-center gap-3 text-[13.5px]">
            <Link href="/vault" className="text-[#667085] hover:text-indigo">← Workflows</Link>
            <Link href={`/map?id=${encodeURIComponent(record.id)}`} className="text-[#667085] hover:text-indigo">Work Map</Link>
            <select
              value={record.id}
              onChange={(e) => (window.location.search = `?id=${e.target.value}`)}
              className="ml-auto h-9 max-w-[60vw] rounded-sm border border-[#9aa0a6] bg-white px-2 text-[14px] focus:border-indigo focus:outline-none sm:max-w-xs"
            >
              {library.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <span className="rounded-sm border border-indigo/30 bg-indigo-soft px-2.5 py-1 text-[12px] font-bold uppercase tracking-wide text-indigo">Process map</span>
          <h1 className="mt-3 text-[30px] font-light leading-[1.1] tracking-tight text-[#1f2d3d] sm:text-[38px]">{record.name}</h1>
          <p className="mt-2 max-w-2xl text-[15.5px] leading-relaxed text-[#475467]">
            How this work flows: how long each step took, which tool it happens in, what data it needs and where that comes from, and which steps it feeds.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {record.id !== EXAMPLE_ID && (
              <button onClick={build} disabled={building} className="h-11 rounded-sm bg-indigo px-5 text-[15px] text-white hover:bg-indigo-dark disabled:opacity-50">
                {building ? "Building the process map…" : built ? "Rebuild process map" : "Build process map"}
              </button>
            )}
            {record.map.processBuiltAt && !building && (
              <span className="text-[13px] text-[#667085]">Built {new Date(record.map.processBuiltAt).toLocaleString()}</span>
            )}
            {error && <span className="text-[13.5px] text-err">{error}</span>}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {tiles.map(([n, label]) => (
              <div key={label} className="rounded-md border border-line bg-white/80 px-4 py-3">
                <div className="text-[28px] font-light leading-none text-[#1f2d3d]">{n}</div>
                <div className="mt-1.5 text-[13px] text-[#475467]">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {!built && (
          <p className="mb-5 rounded-md border border-dashed border-[#b9bdc4] bg-white px-4 py-3 text-[14.5px] text-[#475467]">
            Showing step times only. Press <b>Build process map</b> to add the tools, the data each step needs and produces, and how the steps connect.
          </p>
        )}

        {/* The whole process as a diagram: lanes per tool, rules as diamonds, durations on the arrows */}
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[.12em] text-[#667085]">Process diagram</h2>
        <ProcessDiagram
          timed={timed}
          lanes={built && tools.length ? tools : ["All steps"]}
          laneOf={(s) => (built && tools.length ? Math.max(0, tools.indexOf(s.process?.tool ?? "")) : 0)}
          color={(lane) => (built ? color(lane) : "#5146d9")}
          fmt={fmt}
        />

        {/* The flow, step by step */}
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[.12em] text-[#667085]">Step details</h2>
        <ol className="flex flex-col">
          {timed.map(({ step: s, index, duration }) => {
            const p = s.process;
            return (
              <li key={s.id} className="relative pb-5 pl-10">
                {index < timed.length - 1 && <span className="absolute bottom-0 left-[13px] top-8 w-[2px] bg-[#d0d5dd]" aria-hidden="true" />}
                <span
                  className="absolute left-0 top-1 grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold text-white"
                  style={{ background: p ? color(p.tool) : "#5146d9" }}
                >
                  {index + 1}
                </span>
                <div id={`step-${s.id}`} className="rounded-md border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1 text-[16.5px] leading-snug text-[#1f2d3d]">{s.title}</div>
                    <span className="rounded-full bg-[#f2f4f7] px-2.5 py-0.5 font-mono text-[12px] text-[#475467]">{s.time} · {fmt(duration)}</span>
                  </div>
                  {p && (
                    <div className="mt-1.5">
                      <span className="inline-block rounded-sm px-2 py-0.5 text-[12px] font-medium text-white" style={{ background: color(p.tool) }}>{p.tool}</span>
                    </div>
                  )}
                  {p ? (
                    <div className="mt-3 grid gap-3 text-[14px] sm:grid-cols-2">
                      <Block title="Needs">
                        {p.inputs.length ? (
                          p.inputs.map((x) => (
                            <li key={x.name + x.source}>
                              {x.name} <span className="text-[#667085]">← {x.source}</span>
                            </li>
                          ))
                        ) : (
                          <li className="text-[#98a2b3]">Nothing specific</li>
                        )}
                      </Block>
                      <Block title="Produces">
                        {p.outputs.length ? p.outputs.map((o) => <li key={o}>{o}</li>) : <li className="text-[#98a2b3]">Nothing recorded</li>}
                        {p.feedsInto.length > 0 && (
                          <li className="mt-1 text-[#667085]">
                            → used in{" "}
                            {p.feedsInto.map((id, k) => (
                              <a key={id} href={`#step-${id}`} className="text-indigo hover:underline">
                                {k ? ", " : ""}step {order.get(id)}
                              </a>
                            ))}
                          </li>
                        )}
                      </Block>
                    </div>
                  ) : null}
                  {(p?.decision || s.expertQuote) && (
                    <div className="mt-3 rounded-md bg-indigo-soft/60 px-3 py-2 text-[14px]">
                      <b className="text-indigo">Decision:</b> {p?.decision || `“${s.expertQuote}”`}
                    </div>
                  )}
                  {s.guardrails.map((g) => (
                    <div key={g} className="mt-2 text-[14px] text-[#344054]"><b>Rule:</b> {g}</div>
                  ))}
                  {p && p.unknown.length > 0 && (
                    <div className="mt-3 rounded-md border border-[#f2d48a] bg-warn-soft px-3 py-2 text-[13.5px] text-[#7a5a00]">
                      <b>Ask the expert:</b>
                      <ul className="mt-1 list-disc pl-5">{p.unknown.map((q) => <li key={q}>{q}</li>)}</ul>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Data lineage: each piece of data, where it's made and where it's used */}
        {built && <DataFlow steps={steps} order={order} />}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-bold uppercase tracking-wide text-[#667085]">{title}</div>
      <ul className="mt-1 space-y-0.5 text-[#344054]">{children}</ul>
    </div>
  );
}

function DataFlow({ steps, order }: { steps: WorkMapStep[]; order: Map<string, number> }) {
  // Each input row: the data, where it comes from, and the step that uses it.
  const rows = steps.flatMap((s) => (s.process?.inputs ?? []).map((x) => ({ name: x.name, source: x.source, usedIn: order.get(s.id) ?? 0 })));
  if (!rows.length) return null;
  return (
    <>
      <h2 className="mb-3 mt-4 text-[13px] font-bold uppercase tracking-[.12em] text-[#667085]">Data flow</h2>
      <div className="overflow-x-auto rounded-md border border-line bg-white">
        <table className="w-full min-w-[480px] text-left text-[14px]">
          <thead className="bg-[#f9fafb] text-[12px] uppercase tracking-wide text-[#667085]">
            <tr>
              <th className="px-4 py-2 font-bold">Data or document</th>
              <th className="px-4 py-2 font-bold">Comes from</th>
              <th className="px-4 py-2 font-bold">Used in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-4 py-2 text-[#1f2d3d]">{r.name}</td>
                <td className={`px-4 py-2 ${r.source === "unknown" ? "text-[#b25e09]" : "text-[#475467]"}`}>{r.source}</td>
                <td className="px-4 py-2 text-[#475467]">step {r.usedIn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
