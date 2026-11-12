"use client";
// Process diagram: the workflow drawn like a consulting process chart.
//   - one swimlane per tool or site (one lane "All steps" before the process map is built)
//   - Start → step boxes → End, arrows labeled with how long the step took
//   - a diamond before every step with a rule or decision
//   - dashed arrows where a step's output is used in a later, non-adjacent step
// Steps wrap into rows that fit the page width (each row repeats the lanes), so a long workflow
// reads top to bottom instead of scrolling sideways. Positions come from the step order: no layout library.

import { useEffect, useRef, useState } from "react";
import type { WorkMapStep } from "@/lib/types";

const LANE_H = 196;
const LABEL_W = 40;
const PAD = 26;
const GAP = 60;
const BAND_GAP = 40; // space between wrapped rows, where the arrow turns the corner
const BOX_W = 210;
const BOX_H = 144;
const RULE_W = 136;
const DIAMOND = 64;
const PILL_W = 74;
const PILL_H = 40;

type Base = { lane: number; band: number; x: number; w: number; h: number };
type Node =
  | (Base & { kind: "start" | "end" })
  | (Base & { kind: "rule"; step: WorkMapStep; text: string })
  | (Base & { kind: "step"; step: WorkMapStep; index: number });

export interface DiagramStep {
  step: WorkMapStep;
  index: number;
  duration: number | null;
}

export function ProcessDiagram({
  timed,
  lanes,
  laneOf,
  color,
  fmt,
}: {
  timed: DiagramStep[];
  lanes: string[];
  laneOf: (s: WorkMapStep) => number;
  color: (lane: string) => string;
  fmt: (sec: number | null) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(1100);
  // The node under the pointer: its arrows light up and the rest of the diagram fades back.
  const [hot, setHot] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!timed.length) return null;

  // Lay the nodes out left to right, starting a new row when the next one would not fit.
  // On a phone the diagram keeps a readable width and scrolls sideways inside its box.
  const maxW = Math.max(avail, 760);
  const nodes: Node[] = [];
  let x = LABEL_W + PAD;
  let band = 0;
  const fits = (w: number) => x + w + PAD <= maxW;
  const push = (n: Node, keepWith = 0) => {
    // A rule diamond stays on the same row as its step.
    if (!fits(n.w + keepWith) && x > LABEL_W + PAD) {
      band++;
      x = LABEL_W + PAD;
    }
    nodes.push({ ...n, x, band });
    x += n.w + GAP;
  };
  const at = { x: 0, band: 0 };
  push({ kind: "start", lane: laneOf(timed[0].step), ...at, w: PILL_W, h: PILL_H });
  for (const t of timed) {
    const s = t.step;
    const rule = s.guardrails[0] || s.process?.decision;
    if (rule) push({ kind: "rule", lane: laneOf(s), ...at, w: RULE_W, h: DIAMOND, step: s, text: rule }, GAP + BOX_W);
    // The last step keeps End on its row.
    push({ kind: "step", lane: laneOf(s), ...at, w: BOX_W, h: BOX_H, step: s, index: t.index }, t === timed[timed.length - 1] ? GAP + PILL_W : 0);
  }
  push({ kind: "end", lane: laneOf(timed[timed.length - 1].step), ...at, w: PILL_W, h: PILL_H });
  const bands = band + 1;
  // Spread each row across the full width so wide screens are not left empty on the right.
  for (let b = 0; b < bands; b++) {
    const row = nodes.filter((n) => n.band === b);
    if (row.length < 2) continue;
    const last = row[row.length - 1];
    const extra = Math.min((maxW - PAD - (last.x + last.w)) / (row.length - 1), 90);
    if (extra > 0) row.forEach((n, j) => (n.x += j * extra));
  }
  const rightmost = Math.max(...nodes.map((n) => n.x + n.w));
  // Each row shows only the lanes it uses, in the overall lane order.
  const rowLanes = Array.from({ length: bands }, (_, b) => [...new Set(nodes.filter((n) => n.band === b).map((n) => n.lane))].sort((a, c) => a - c));
  const tops: number[] = [];
  let y = 0;
  for (const ls of rowLanes) {
    tops.push(y);
    y += ls.length * LANE_H + BAND_GAP;
  }
  const width = band ? maxW : rightmost + PAD;
  const height = y - BAND_GAP;
  const bandTop = (b: number) => tops[b];
  const cy = (n: { lane: number; band: number }) => bandTop(n.band) + rowLanes[n.band].indexOf(n.lane) * LANE_H + LANE_H / 2;

  // Main flow: each node to the next. The arrow leaving a step carries that step's duration.
  const durationOf = new Map(timed.map((t) => [t.step.id, t.duration]));
  const flow = nodes.slice(0, -1).map((a, i) => {
    const b = nodes[i + 1];
    const x1 = a.x + a.w;
    const y1 = cy(a);
    const x2 = b.x - 4;
    const y2 = cy(b);
    const label = a.kind === "step" ? fmt(durationOf.get(a.step.id) ?? null) : "";
    if (a.band !== b.band) {
      // Wrap to the next row: out to the right, down into the gap, back to the left, down to the node.
      const turn = bandTop(b.band) - BAND_GAP / 2;
      const right = x1 + 18;
      const left = b.x - 22;
      return { d: `M${x1},${y1} H${right} V${turn} H${left} V${y2} H${x2}`, label, lx: (right + left) / 2, ly: turn - 6, i };
    }
    const mx = x1 + GAP / 2;
    const d = y1 === y2 ? `M${x1},${y1} H${x2}` : `M${x1},${y1} H${mx} V${y2} H${x2}`;
    return { d, label, lx: (x1 + (y1 === y2 ? x2 : mx)) / 2, ly: y1 - 9, i };
  });

  // Data links that skip ahead within a row: dashed curves under the boxes.
  const boxById = new Map(nodes.filter((n): n is Extract<Node, { kind: "step" }> => n.kind === "step").map((n) => [n.step.id, n]));
  const stepNodes = [...boxById.values()];
  const links = stepNodes.flatMap((a, i) =>
    (a.step.process?.feedsInto ?? [])
      .filter((id) => id !== stepNodes[i + 1]?.step.id && boxById.get(id)?.band === a.band)
      .map((id) => {
        const b = boxById.get(id)!;
        const x1 = a.x + a.w / 2;
        const y1 = cy(a) + BOX_H / 2;
        const x2 = b.x + b.w / 2;
        const y2 = cy(b) + BOX_H / 2 + 4;
        const dip = Math.max(y1, y2) + 22;
        return { key: `${a.step.id}-${id}`, from: nodes.indexOf(a), to: nodes.indexOf(b), d: `M${x1},${y1} C${x1},${dip} ${x2},${dip} ${x2},${y2}`, title: `Step ${a.index + 1} feeds step ${b.index + 1}` };
      }),
  );

  // Arrow i runs from node i to node i + 1.
  const lit = (from: number, to: number) => hot !== null && (hot === from || hot === to);
  const near = (i: number) => hot === null || Math.abs(hot - i) <= 1;
  const hover = (i: number) => ({ onMouseEnter: () => setHot(i), onMouseLeave: () => setHot(null), onFocus: () => setHot(i), onBlur: () => setHot(null) });

  return (
    <div
      ref={box}
      className="mb-8 overflow-x-auto rounded-lg border border-line bg-white bg-[radial-gradient(#e4e7ec_1px,transparent_1px)] shadow-[0_1px_3px_rgba(16,24,40,.06)] [background-size:18px_18px]"
    >
      <div className="relative" style={{ width, height }}>
        {/* Swimlanes, repeated for every row */}
        {rowLanes.map((ls, b) =>
          ls.map((li) => lanes[li]).map((lane, i) => (
            <div
              key={`${b}-${lane}`}
              className={`absolute left-0 right-0 border-line ${i ? "border-t" : ""} ${b && !i ? "border-t" : ""}`}
              style={{ top: bandTop(b) + i * LANE_H, height: LANE_H, background: `linear-gradient(90deg, ${color(lane)}14, ${color(lane)}03 45%, transparent)` }}
            >
              <div className="absolute inset-y-0 left-0 flex items-center justify-center border-r border-line bg-white" style={{ width: LABEL_W }}>
                <span className="absolute inset-y-0 left-0 w-[4px]" style={{ background: color(lane) }} aria-hidden="true" />
                <span className="max-h-[180px] truncate text-[12.5px] font-bold [transform:rotate(180deg)] [writing-mode:vertical-rl]" style={{ color: color(lane) }} title={lane}>{lane}</span>
              </div>
            </div>
          )),
        )}

        {/* Arrows */}
        <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
          <defs>
            <marker id="pd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#667085" />
            </marker>
            <marker id="pd-arrow-data" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#5146d9" />
            </marker>
          </defs>
          {links.map((l) => (
            <path
              key={l.key}
              d={l.d}
              fill="none"
              stroke="#5146d9"
              strokeOpacity={hot === null ? 0.55 : lit(l.from, l.to) ? 1 : 0.15}
              strokeWidth={lit(l.from, l.to) ? 2.2 : 1.5}
              strokeDasharray="5 4"
              markerEnd="url(#pd-arrow-data)"
              className="transition-all duration-200"
            >
              <title>{l.title}</title>
            </path>
          ))}
          {flow.map((f) => (
            <g key={f.i} className="transition-opacity duration-200" style={{ opacity: hot === null || lit(f.i, f.i + 1) ? 1 : 0.3 }}>
              <path d={f.d} fill="none" stroke={lit(f.i, f.i + 1) ? "#5146d9" : "#667085"} strokeWidth={lit(f.i, f.i + 1) ? 2.4 : 1.6} markerEnd="url(#pd-arrow)" />
              {/* Pulses travelling along the arrow show the direction of work */}
              <path d={f.d} fill="none" stroke="#5146d9" strokeWidth="2.6" strokeLinecap="round" className="pd-flow" strokeOpacity=".85" />
              {f.label && f.label !== "–" && (
                <text x={f.lx} y={f.ly} textAnchor="middle" className="fill-[#344054] text-[11.5px] font-bold">{f.label}</text>
              )}
            </g>
          ))}
        </svg>

        {/* Nodes */}
        {nodes.map((n, i) => {
          const top = cy(n) - n.h / 2;
          const pop = { animationDelay: `${Math.min(i, 24) * 45}ms` };
          // A filter, not opacity: the entrance animation holds opacity at 1.
          const fade = `transition-[filter] duration-200 ${near(i) ? "" : "[filter:opacity(.4)_saturate(.5)]"}`;
          if (n.kind === "start" || n.kind === "end") {
            return (
              <div
                key={i}
                className={`pd-pop absolute grid place-items-center rounded-full text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(43,47,69,.25)] ${fade} ${
                  n.kind === "start" ? "bg-[linear-gradient(135deg,#6a5ff0,#3d33b8)]" : "bg-[linear-gradient(135deg,#3a3f5c,#1d2033)]"
                }`}
                style={{ left: n.x, top, width: n.w, height: n.h, ...pop }}
              >
                {n.kind === "start" && <span className="pd-ring absolute inset-0 rounded-full" aria-hidden="true" />}
                {n.kind === "start" ? "Start" : "End"}
              </div>
            );
          }
          if (n.kind === "rule") {
            return (
              <a key={i} {...hover(i)} href={`#step-${n.step.id}`} className={`pd-pop group absolute flex flex-col items-center ${fade}`} style={{ left: n.x, top, width: n.w, ...pop }} title={n.text}>
                <div className="grid place-items-center" style={{ width: DIAMOND, height: DIAMOND }}>
                  <div className="grid h-[46px] w-[46px] rotate-45 place-items-center rounded-[4px] bg-[linear-gradient(135deg,#3a3f5c,#1d2033)] shadow-[0_4px_10px_rgba(43,47,69,.25)] transition duration-200 group-hover:scale-110 group-hover:bg-[linear-gradient(135deg,#6a5ff0,#3d33b8)]">
                    <span className="-rotate-45 text-[11px] font-bold text-white">{n.step.guardrails.length ? "Rule" : "Decide"}</span>
                  </div>
                </div>
                <p className="mt-1 line-clamp-3 text-center text-[11.5px] leading-snug text-[#344054]">{n.text}</p>
              </a>
            );
          }
          if (n.kind !== "step") return null;
          const s = n.step;
          const p = s.process;
          const lane = lanes[n.lane];
          const needs = p?.inputs.map((x) => x.name) ?? [];
          const makes = p?.outputs ?? [];
          const answered = new Set((s.answers ?? []).map((x) => x.q));
          const open = (p?.unknown ?? []).filter((q) => !answered.has(q)).length;
          return (
            <div key={i} className={`pd-pop absolute ${fade}`} style={{ left: n.x, top, width: n.w, height: n.h, ...pop }}>
            <a
              {...hover(i)}
              href={`#step-${s.id}`}
              className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-white shadow-[0_2px_6px_rgba(16,24,40,.08)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_12px_28px_rgba(16,24,40,.16)] focus-visible:outline-2 focus-visible:outline-indigo"
              style={hot === i ? { borderColor: color(lane), boxShadow: `0 0 0 3px ${color(lane)}33, 0 12px 28px rgba(16,24,40,.16)` } : undefined}
            >
              <div className="flex items-start gap-2 px-3 py-2 text-white" style={{ background: `linear-gradient(135deg, ${color(lane)}, ${color(lane)}cc)` }}>
                <span className="mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/25 text-[11px] font-bold">{n.index + 1}</span>
                <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug">{s.title}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2 text-[12px] leading-snug text-[#475467]">
                {p ? (
                  <>
                    <Line label="Needs" items={needs} />
                    <Line label="Produces" items={makes} />
                  </>
                ) : (
                  <p className="line-clamp-3">{s.decision || s.short || "Recorded step"}</p>
                )}
                {(s.guardrails.length > 0 || open > 0) && (
                  <div className="mt-auto flex gap-1.5">
                    {s.guardrails.length > 0 && <span className="rounded-sm bg-indigo-soft px-1.5 py-[1px] text-[11px] font-bold text-indigo">◆ {s.guardrails.length} rule{s.guardrails.length > 1 ? "s" : ""}</span>}
                    {open > 0 && <span className="rounded-sm bg-warn-soft px-1.5 py-[1px] text-[11px] font-bold text-[#7a5a00]">? {open} to ask</span>}
                  </div>
                )}
              </div>
            </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Line({ label, items }: { label: string; items: string[] }) {
  return (
    <p className="line-clamp-2">
      <b className="text-[#344054]">{label}:</b> {items.length ? items.join(", ") : <span className="text-[#98a2b3]">nothing recorded</span>}
    </p>
  );
}
