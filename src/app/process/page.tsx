"use client";
// Process map for one saved workflow (?id=…): how the work flows from step to step.
//   - time each step took (from the recording's step times)
//   - the tool / system / site each step happens in, as a timeline per tool
//   - the data each step needs and where it comes from, what it produces, which later steps use it
//   - the decisions made, and what is still unknown (questions for the expert)
// Times are computed here; tools, data and links are built once by /api/processmap and stored on the workflow.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { EXAMPLE_ID, getWorkflow, listWorkflows, saveWorkflow } from "@/lib/session";
import type { StepAnswer, WorkflowRecord, WorkflowSummary, WorkMap, WorkMapStep } from "@/lib/types";
import { ProcessCanvas } from "@/features/workmap/ProcessCanvas";

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

export default function ProcessMapPage() {
  const idParam = useSyncExternalStore(() => () => {}, readId, () => null);
  const [library, setLibrary] = useState<WorkflowSummary[]>([]);
  const [record, setRecord] = useState<WorkflowRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; title: string } | null>(null);
  const [me, setMe] = useState<string | undefined>(undefined);
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
      const loaded = await getWorkflow(idParam ?? list[0]?.id);
      if (live) {
        setRecord(loaded);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [idParam]);

  /** Save the expert's answer to one of a step's open questions (replaces an earlier answer to it). */
  async function answer(stepId: string, q: string, a: string) {
    if (!record) return false;
    const me = await fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const entry: StepAnswer = { q, a: a.trim(), by: me?.email ?? "", at: new Date().toISOString() };
    const next: WorkflowRecord = {
      ...record,
      map: {
        ...record.map,
        steps: record.map.steps.map((s) =>
          s.id !== stepId ? s : { ...s, answers: [...(s.answers ?? []).filter((x) => x.q !== q), ...(entry.a ? [entry] : [])] },
        ),
      },
    };
    const ok = await saveWorkflow(next);
    if (ok) setRecord(next);
    return ok;
  }

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
  if (!record) {
    return (
      <div className="grid min-h-full place-items-center bg-[#f6f8fc] p-6 text-center text-[15px] text-[#475467]">
        <div>
          No recorded workflow yet. <Link href="/capture" className="text-indigo underline">Record one in Teaching</Link>.
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

      {/* The diagram gets the full screen width; the reading sections below keep the page width. */}
      <div className="mx-auto max-w-[1720px] px-4 pt-6 sm:px-6">
        {!built && (
          <p className="mb-5 rounded-md border border-dashed border-[#b9bdc4] bg-white px-4 py-3 text-[14.5px] text-[#475467]">
            Showing step times only. Press <b>Build process map</b> to add the tools, the data each step needs and produces, and how the steps connect.
          </p>
        )}

        {/* The whole process as a diagram: lanes per tool, rules as diamonds, durations on the arrows */}
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[.12em] text-[#667085]">Process diagram</h2>
        <ProcessCanvas
          timed={timed}
          map={record.map}
          onSave={record.id === EXAMPLE_ID ? undefined : saveCanvas}
          me={me}
          tools={built ? tools : []}
          lanes={built && tools.length ? tools : ["All steps"]}
          laneOf={(s) => (built && tools.length ? Math.max(0, tools.indexOf(s.process?.tool ?? "")) : 0)}
          color={(lane) => (built ? color(lane) : "#a4161a")}
          fmt={fmt}
        />
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-6 sm:px-6">

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
                  {p && (
                    <div className="mt-1.5">
                      <span className="inline-block rounded-sm px-2 py-0.5 text-[12px] font-medium text-white" style={{ background: color(p.tool) }}>{p.tool}</span>
                    </div>
                  )}
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
                  {!s.reason && !s.expertQuote && !p?.decision && (
                    <p className="mt-1.5 text-[13.5px] text-[#98a2b3]">No reason recorded: the expert wasn&apos;t asked about this step.</p>
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
                  {((p?.unknown.length ?? 0) > 0 || (s.answers?.length ?? 0) > 0) && (
                    <ExpertQuestions step={s} canEdit={record.id !== EXAMPLE_ID} onAnswer={(q, a) => answer(s.id, q, a)} />
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Data lineage: each piece of data, where it's made and where it's used */}
        {built && <DataFlow steps={steps} order={order} />}
      </div>

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

/** "Ask the expert": each question with the expert's answer, or a box to add one. */
function ExpertQuestions({ step, canEdit, onAnswer }: { step: WorkMapStep; canEdit: boolean; onAnswer: (q: string, a: string) => Promise<boolean> }) {
  // Open questions plus every answered one: a rebuild drops answered questions from the list, the answers stay.
  const qs = [...new Set([...(step.process?.unknown ?? []), ...(step.answers ?? []).map((x) => x.q)])];
  const open = openQuestions(step).length;
  return (
    <div className={`mt-3 rounded-md border px-3 py-2.5 text-[13.5px] ${open ? "border-[#f2d48a] bg-warn-soft" : "border-[#b7e0c9] bg-[#eefaf3]"}`}>
      <b className={open ? "text-[#7a5a00]" : "text-[#11643f]"}>{open ? `Ask the expert (${open} open)` : "Answered by the expert"}</b>
      <ul className="mt-1.5 space-y-2">
        {qs.map((q) => (
          <ExpertQuestion key={q} q={q} answer={step.answers?.find((x) => x.q === q)} canEdit={canEdit} onAnswer={(a) => onAnswer(q, a)} />
        ))}
      </ul>
    </div>
  );
}

function ExpertQuestion({ q, answer, canEdit, onAnswer }: { q: string; answer?: StepAnswer; canEdit: boolean; onAnswer: (a: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(answer?.a ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  async function save() {
    setSaving(true);
    setFailed(false);
    const ok = await onAnswer(text);
    setSaving(false);
    if (ok) setEditing(false);
    else setFailed(true);
  }
  return (
    <li>
      <div className="text-[#344054]"><span className="font-semibold">Q:</span> {q}</div>
      {editing ? (
        <div className="mt-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            autoFocus
            placeholder="The expert's answer, e.g. the receipt photo comes from the company card app."
            className="w-full rounded-sm border border-[#9aa0a6] bg-white px-2.5 py-1.5 text-[14px] text-[#1f2d3d] focus:border-indigo focus:outline-none"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button onClick={save} disabled={saving || !text.trim()} className="h-8 rounded-sm bg-indigo px-3 text-[13px] text-white hover:bg-indigo-dark disabled:opacity-50">
              {saving ? "Saving…" : "Save answer"}
            </button>
            <button onClick={() => { setEditing(false); setText(answer?.a ?? ""); }} className="h-8 px-2 text-[13px] text-[#475467] hover:text-indigo">Cancel</button>
            {failed && <span className="text-[13px] text-err">Couldn&apos;t save. Try again.</span>}
          </div>
        </div>
      ) : answer ? (
        <div className="mt-1 rounded-sm bg-white/80 px-2.5 py-1.5 text-[#1f2d3d]">
          <span className="font-semibold text-[#11643f]">A:</span> {answer.a}
          <span className="ml-2 text-[12px] text-[#667085]">{answer.by ? `${answer.by} · ` : ""}{new Date(answer.at).toLocaleDateString()}</span>
          {canEdit && <button onClick={() => setEditing(true)} className="ml-2 text-[12.5px] text-indigo hover:underline">Edit</button>}
        </div>
      ) : canEdit ? (
        <button onClick={() => setEditing(true)} className="mt-1 text-[13px] font-medium text-indigo hover:underline">+ Add the expert&apos;s answer</button>
      ) : null}
    </li>
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
