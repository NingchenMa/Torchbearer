"use client";
// Process map for one saved workflow (?id=…): how the work flows from step to step.
//   - time each step took (from the recording's step times)
//   - the tool / system / site each step happens in, as a timeline per tool
//   - the data each step needs and where it comes from, what it produces, which later steps use it
//   - the decisions made, and what is still unknown (questions for the expert)
// Times are computed here; tools, data and links are built once by /api/processmap and stored on the workflow.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import NoAccess from "@/features/nav/NoAccess";
import { EXAMPLE_ID, getWorkflowAccess, listWorkflows, saveWorkflow } from "@/lib/session";
import type { WorkflowRecord, WorkflowSummary, WorkMap, WorkMapStep } from "@/lib/types";
import { ProcessCanvas } from "@/features/workmap/ProcessCanvas";
import { ACTION_NAMES, OTHER_ACTION, actionColor, actionOf } from "@/features/workmap/actionCategory";
import { Segmented } from "@/features/ui/fx";

const readId = () => {
  try {
    return new URLSearchParams(window.location.search).get("id");
  } catch {
    return null;
  }
};

/** "mm:ss" or "h:mm:ss" → seconds; NaN when unreadable. */
function toSec(t: string): number {
  if (!t?.trim()) return NaN; // a step added by hand has no recorded time
  const p = t.split(":").map(Number);
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
  // Durations come from the recording (each step until the next one started), so they stay right
  // even after the steps were put in a different order on the process canvas.
  const times = steps.map((x) => toSec(x.time)).filter(Number.isFinite).sort((a, b) => a - b);
  const t0 = times[0] ?? 0;
  return steps.map((step, index) => {
    const own = toSec(step.time);
    const start = own - t0;
    const after = times.find((t) => t > own);
    const next = after !== undefined ? after - t0 : NaN;
    const duration = Number.isFinite(next) && Number.isFinite(start) && next >= start ? next - start : null;
    return { step, index, start: Number.isFinite(start) ? start : 0, duration };
  });
}

// A small fixed palette for tools (works on light backgrounds).
const TOOL_COLORS = ["#a4161a", "#b8650a", "#0f766e", "#5a1220", "#2f5d8a", "#6b4e3d"]; // the website palette: crimson, amber, teal, maroon, slate, umber

// The process map is view-only: steps are added, removed, reordered and annotated on the Work Map (/map).
// Set to true to bring back editing on the canvas.
const CANVAS_EDITING: boolean = false;

export default function ProcessMapPage() {
  const idParam = useSyncExternalStore(() => () => {}, readId, () => null);
  const [library, setLibrary] = useState<WorkflowSummary[]>([]);
  const [record, setRecord] = useState<WorkflowRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false); // the server refused: not the recorder, not a manager
  const [building, setBuilding] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; title: string } | null>(null);
  const [me, setMe] = useState<string | undefined>(undefined);
  const [openStep, setOpenStep] = useState<string | null>(null); // the step whose details are open in a popup
  const [groupBy, setGroupBy] = useState<"tool" | "action">("tool");
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m?.email && setMe(m.email))
      .catch(() => {});
  }, []);
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

  /** Save what was changed on the process canvas: positions, arrows, notes, data links or a new step order. */
  // Saves can follow each other quickly (a drag, then a new arrow), so build on the latest record.
  const latest = useRef(record);
  useEffect(() => {
    latest.current = record;
  }, [record]);
  const saveCanvas = (patch: Partial<WorkMap>) => {
    const r = latest.current;
    if (!r) return;
    const next: WorkflowRecord = { ...r, map: { ...r.map, ...patch } };
    latest.current = next;
    setRecord(next);
    saveWorkflow(next).then((ok) => !ok && setError("Couldn't save the change to the process map. Please try again."));
  };

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
  // Grouped by action: one lane per kind of action, in the usual order of a task, Other last.
  const byAction = groupBy === "action";
  const actionLanes = [...ACTION_NAMES, OTHER_ACTION.name];
  // Moving boxes while grouped by action keeps its own positions, so the tool view stays as it was.
  const saveActionCanvas = (patch: Partial<WorkMap>) => {
    if (!("layout" in patch)) return saveCanvas(patch);
    const { layout, ...rest } = patch;
    saveCanvas({ ...rest, layoutByAction: layout });
  };
  const decisions = steps.filter((s) => s.process?.decision || s.guardrails.length).length;
  const questions = steps.reduce((a, s) => a + openQuestions(s).length, 0);
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
            {!record.map.published && <Link href={`/map?id=${encodeURIComponent(record.id)}`} className="text-[#667085] hover:text-indigo">Work Map</Link>}
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

      {/* The diagram gets the full screen width; the reading sections below keep the page width. */}
      <div className="mx-auto max-w-[1720px] px-4 pt-6 sm:px-6">
        {!built && (
          <p className="mb-5 rounded-md border border-dashed border-[#b9bdc4] bg-white px-4 py-3 text-[14.5px] text-[#475467]">
            Showing step times only. Press <b>Build process map</b> to add the tools, the data each step needs and produces, and how the steps connect.
          </p>
        )}

        {/* The whole process as a diagram: lanes per tool, rules as diamonds, durations on the arrows */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[13px] font-bold uppercase tracking-[.12em] text-[#667085]">Process diagram</h2>
          <div className="flex items-center gap-2 text-[13.5px] text-muted">
            <span>Group steps by</span>
            <Segmented
              label="Group steps by"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "tool", label: "Tool" },
                { value: "action", label: "Action" },
              ]}
            />
          </div>
        </div>
        <ProcessCanvas
          key={groupBy}
          timed={timed}
          map={byAction ? { ...record.map, layout: record.map.layoutByAction } : record.map}
          onSave={!CANVAS_EDITING || record.id === EXAMPLE_ID ? undefined : byAction ? saveActionCanvas : saveCanvas}
          me={me}
          onOpenStep={setOpenStep}
          tools={built ? tools : []}
          lanes={byAction ? actionLanes : built && tools.length ? tools : ["All steps"]}
          laneOf={(s) => (byAction ? actionLanes.indexOf(actionOf(s)) : built && tools.length ? Math.max(0, tools.indexOf(s.process?.tool ?? "")) : 0)}
          color={(lane) => (byAction ? actionColor(lane) : built ? color(lane) : "#a4161a")}
          fmt={fmt}
        />
      </div>

      {/* The page shows the map only. A click on a step opens its details here. */}
      {openStep && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Step details"
        className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[rgba(20,28,38,.55)] p-4 sm:p-8"
        onClick={() => setOpenStep(null)}
      >
        <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex justify-end">
          <button onClick={() => setOpenStep(null)} className="h-9 rounded-full bg-white px-4 text-[14px] font-bold text-[#344054] shadow hover:text-indigo">Close ✕</button>
        </div>
        <ol className="flex flex-col">
          {timed.filter((t) => t.step.id === openStep).map(({ step: s, index, duration }) => {
            const p = s.process;
            return (
              <li key={s.id} className="relative pb-5 pl-10">
                <span
                  className="absolute left-0 top-1 grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold text-white"
                  style={{ background: p ? color(p.tool) : "#5146d9" }}
                >
                  {index + 1}
                </span>
                <div id={`step-${s.id}`} className="flow-root rounded-md border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
                  {s.screenshot && (
                    <button
                      onClick={() => setZoom({ src: s.screenshot!, title: `Step ${index + 1}: ${s.title}` })}
                      className="group mb-3 block w-full overflow-hidden rounded-md border border-line sm:float-right sm:mb-2 sm:ml-5 sm:w-[260px]"
                      aria-label={`Enlarge the screenshot of step ${index + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- recorded screenshot as a data URL */}
                      <img src={s.screenshot} alt="" className="aspect-video w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]" />
                    </button>
                  )}
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1 text-[16.5px] leading-snug text-[#1f2d3d]">{s.title}</div>
                    {s.addedBy !== undefined ? (
                      <span className="rounded-full bg-cream px-2.5 py-0.5 text-[12px] font-bold text-crimson">Added by hand{s.addedBy ? ` · ${s.addedBy}` : ""}</span>
                    ) : (
                      <span className="rounded-full bg-[#f2f4f7] px-2.5 py-0.5 font-mono text-[12px] text-[#475467]">{s.time} · {fmt(duration)}</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p && <span className="inline-block rounded-sm px-2 py-0.5 text-[12px] font-medium text-white" style={{ background: color(p.tool) }}>{p.tool}</span>}
                    <span className="inline-block rounded-sm border px-2 py-0.5 text-[12px] font-medium" style={{ color: actionColor(actionOf(s)), borderColor: actionColor(actionOf(s)) }}>{actionOf(s)}</span>
                  </div>
                  {(s.correction || s.decision) && (
                    <p className="mt-3 text-[15px] leading-relaxed text-[#344054]">
                      <b className="text-[#1f2d3d]">What the expert did:</b> {s.correction || s.decision}
                    </p>
                  )}
                  {s.reason && (
                    <p className="mt-1.5 text-[15px] leading-relaxed text-[#344054]">
                      <b className="text-[#1f2d3d]">Why:</b> {s.reason}
                    </p>
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
                              <button key={id} onClick={() => setOpenStep(id)} className="text-indigo hover:underline">
                                {k ? ", " : ""}step {order.get(id)}
                              </button>
                            ))}
                          </li>
                        )}
                      </Block>
                    </div>
                  ) : null}
                  {p?.decision && (
                    <div className="mt-3 rounded-md bg-indigo-soft/60 px-3 py-2 text-[14px]">
                      <b className="text-indigo">Decision:</b> {p.decision}
                    </div>
                  )}
                  {s.expertQuote && (
                    <blockquote className="mt-3 border-l-2 border-amber pl-3 font-serif text-[15px] italic text-[#344054]">&ldquo;{s.expertQuote}&rdquo;</blockquote>
                  )}
                  {(record.map.notes ?? [])
                    .filter((n) => n.stepId === s.id && n.text.trim())
                    .map((n) => (
                      <div key={n.id} className="mt-3 rounded-md bg-[#fff1c2] px-3 py-2 text-[14px] text-[#3d2f00] shadow-[0_2px_6px_rgba(107,80,0,.12)]">
                        <b className="text-[#6b5000]">Note:</b> {n.text}
                        {n.by && <span className="ml-2 text-[12.5px] text-[#8a7330]">· {n.by}</span>}
                      </div>
                    ))}
                  {s.guardrails.map((g) => (
                    <div key={g} className="mt-2 text-[14px] text-[#344054]"><b>Rule:</b> {g}</div>
                  ))}
                  {s.note?.trim() && (
                    <div className="mt-3 rounded-md bg-[#fff1c2] px-3 py-2 text-[14px] text-[#3d2f00]">
                      <b className="text-[#6b5000]">Note:</b> {s.note}
                    </div>
                  )}
                  {p?.summary && (
                    <div className="mt-3 rounded-md bg-cream px-3 py-2 text-[14.5px] leading-relaxed text-[#344054]">
                      <b className="text-crimson">The expert&apos;s explanation:</b> {p.summary}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        </div>
      </div>
      )}

      {/* A step's screenshot, full size */}
      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={zoom.title}
          onClick={() => setZoom(null)}
          onKeyDown={(e) => e.key === "Escape" && setZoom(null)}
          tabIndex={-1}
          ref={(el) => el?.focus()}
          className="fixed inset-0 z-50 grid place-items-center bg-[#2a070e]/80 p-4 backdrop-blur-sm"
        >
          <figure className="max-h-full max-w-5xl overflow-auto rounded-md bg-white p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- recorded screenshot as a data URL */}
            <img src={zoom.src} alt={zoom.title} className="w-full rounded" />
            <figcaption className="flex items-center justify-between gap-3 px-2 pb-1 pt-2 text-[14px] text-[#344054]">
              {zoom.title}
              <button onClick={() => setZoom(null)} className="rounded-full border border-line px-3 py-1 text-[13px] hover:bg-panel">Close</button>
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

/** The process map's questions for this step that nobody has answered yet. */
function openQuestions(s: WorkMapStep): string[] {
  const answered = new Set((s.answers ?? []).map((x) => x.q));
  return (s.process?.unknown ?? []).filter((q) => !answered.has(q));
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-bold uppercase tracking-wide text-[#667085]">{title}</div>
      <ul className="mt-1 space-y-0.5 text-[#344054]">{children}</ul>
    </div>
  );
}
