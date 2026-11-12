"use client";
// Process map as an editable canvas (React Flow).
//   Move:    drag boxes and notes; scroll or pinch to zoom; drag the background to pan.
//   Links:   drag from the dot on a box's right edge to another box to add an arrow;
//            from the bottom dot to add a data link ("this step's output is used there").
//            Click an arrow and press Delete, or its × button, to remove it.
//   Order:   when the arrows from Start give a different step order, "Apply new order" reorders
//            the workflow's steps (Work Map and Training follow the new order).
//   Notes:   "Add note" drops a sticky note; type in it, drag it, connect it to a step.
//   Steps:   "Add step" drops a new step to fill in (title, what to do, tool); connect it with arrows
//            and apply the new order to put it in the workflow. Only hand-added steps can be edited or deleted.
// Everything is saved with the workflow: map.layout (positions), map.flow (arrows), map.notes,
// and step.process.feedsInto (data links). "Reset" goes back to the automatic arrows and layout.

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Eye, ListOrdered, Maximize2, Pencil, Plus, RotateCcw, StickyNote, Trash2, X } from "lucide-react";
import type { CanvasNote, WorkMap, WorkMapStep } from "@/lib/types";

export interface CanvasStep {
  step: WorkMapStep;
  index: number;
  duration: number | null;
}
type XY = { x: number; y: number };
type Kind = "next" | "data" | "note";

const LANE_H = 290; // room for a step box with its questions and answers
const GAP = 70;
const BOX_W = 230;
const BOX_H = 150;
const RULE_W = 120;
const PILL_W = 86;
const LABEL_W = 46;
const NOTE_W = 200;

type StepEdit = { title?: string; decision?: string; tool?: string };
type StepData = {
  step: WorkMapStep;
  index: number;
  color: string;
  open: number;
  hot: boolean;
  notes: number;
  tools?: string[];
  onEdit?: (id: string, edit: StepEdit) => void;
  onRemove?: (id: string) => void;
};
type RuleData = { text: string; kind: string; stepId: string };
type PillData = { label: string };
type LaneData = { label: string; color: string; width: number };
type NoteData = { text: string; onText: (id: string, text: string) => void; onDelete: (id: string) => void; editable: boolean };
type EdgeData = { kind: Kind; label?: string; hot?: boolean; dim?: boolean; onDelete?: (id: string) => void };

interface Props {
  timed: CanvasStep[];
  lanes: string[];
  laneOf: (s: WorkMapStep) => number;
  color: (lane: string) => string;
  fmt: (sec: number | null) => string;
  map: Pick<WorkMap, "layout" | "flow" | "notes" | "steps">;
  /** Save changes to the workflow; absent for the read-only example. */
  onSave?: (patch: Partial<WorkMap>) => void;
  me?: string;
  /** Tools and sites a hand-added step can be in (empty before the process map is built). */
  tools?: string[];
}

export function ProcessCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ timed, lanes, laneOf, color, fmt, map, onSave, me, tools = [] }: Props) {
  const flow = useReactFlow();
  const [hot, setHot] = useState<string | null>(null);
  // View (default): look, pan and zoom only. Edit: move, link, add and delete. Only with a save target.
  const [mode, setMode] = useState<"view" | "edit">("view");
  const canEdit = !!onSave;
  const editable = canEdit && mode === "edit";

  // The layout is keyed on the workflow's content: the page passes new functions on every render,
  // which would otherwise undo a drag.
  const sig = [
    lanes.join(","),
    ...timed.map((t) => {
      const s = t.step;
      return [s.id, s.title, s.decision, s.addedBy ?? "-", laneOf(s), color(lanes[laneOf(s)]), s.guardrails.join(";"), JSON.stringify(s.process ?? null), (s.answers ?? []).map((a) => `${a.q}=${a.a}`).join(";")].join("~");
    }),
  ].join("|");

  // Automatic layout: left to right in step order, each node in its tool's band.
  const auto = useMemo(() => {
    const out: { id: string; type: string; x: number; lane: number; w: number; h: number; data: StepData | RuleData | PillData }[] = [];
    let x = LABEL_W + 30;
    const add = (n: Omit<(typeof out)[number], "x">) => {
      out.push({ ...n, x });
      x += n.w + GAP;
    };
    if (!timed.length) return { nodes: out, width: 0 };
    add({ id: "start", type: "pill", lane: laneOf(timed[0].step), w: PILL_W, h: 44, data: { label: "Start" } });
    for (const t of timed) {
      const s = t.step;
      const rule = s.guardrails[0] || s.process?.decision;
      if (rule) add({ id: `rule-${s.id}`, type: "rule", lane: laneOf(s), w: RULE_W, h: 110, data: { text: rule, kind: s.guardrails.length ? "Rule" : "Decide", stepId: s.id } });
      const answered = new Set((s.answers ?? []).map((a) => a.q));
      const open = (s.process?.unknown ?? []).filter((q) => !answered.has(q)).length;
      add({ id: s.id, type: "step", lane: laneOf(s), w: BOX_W, h: BOX_H, data: { step: s, index: t.index, color: color(lanes[laneOf(s)]), open, hot: false, notes: 0 } });
    }
    add({ id: "end", type: "pill", lane: laneOf(timed[timed.length - 1].step), w: PILL_W, h: 44, data: { label: "End" } });
    return { nodes: out, width: x };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the content signature above
  }, [sig]);

  const usedLanes = useMemo(() => [...new Set(auto.nodes.map((n) => n.lane))].sort((a, b) => a - b), [auto]);
  const laneY = useCallback((lane: number) => usedLanes.indexOf(lane) * LANE_H, [usedLanes]);
  const ids = useMemo(() => new Set(auto.nodes.map((n) => n.id)), [auto]);
  const durationOf = useMemo(() => new Map(timed.map((t) => [t.step.id, t.duration])), [timed]);

  // ---- saving -------------------------------------------------------------------------------
  // Read the latest nodes and edges from React Flow, so a save never uses a stale copy.
  const snapshot = useCallback(() => {
    const ns = flow.getNodes();
    const es = flow.getEdges();
    const layout: Record<string, XY> = {};
    for (const n of ns) if (n.type !== "lane" && n.type !== "note") layout[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    const nextEdges = es.filter((e) => (e.data as EdgeData)?.kind === "next").map((e) => ({ source: e.source, target: e.target }));
    const notes: CanvasNote[] = ns
      .filter((n) => n.type === "note")
      .map((n) => {
        const old = (map.notes ?? []).find((x) => x.id === n.id);
        const link = es.find((e) => (e.data as EdgeData)?.kind === "note" && e.source === n.id);
        return {
          id: n.id,
          text: (n.data as NoteData).text,
          x: Math.round(n.position.x),
          y: Math.round(n.position.y),
          ...(link ? { stepId: link.target } : {}),
          by: old?.by ?? me,
          at: old?.at ?? new Date().toISOString(),
        };
      });
    const feeds = new Map<string, string[]>();
    for (const e of es) if ((e.data as EdgeData)?.kind === "data") feeds.set(e.source, [...(feeds.get(e.source) ?? []), e.target]);
    const steps = map.steps.map((s) => (s.process ? { ...s, process: { ...s.process, feedsInto: feeds.get(s.id) ?? [] } } : s));
    return { layout, flow: nextEdges, notes, steps };
  }, [flow, map.notes, map.steps, me]);

  const save = useCallback(
    (what: ("layout" | "flow" | "notes" | "steps")[]) => {
      if (!onSave || !what.length) return;
      // Let React Flow apply the change first.
      requestAnimationFrame(() => {
        const snap = snapshot();
        const patch: Partial<WorkMap> = {};
        for (const k of what) (patch as Record<string, unknown>)[k] = snap[k];
        onSave(patch);
      });
    },
    [onSave, snapshot],
  );

  // ---- notes --------------------------------------------------------------------------------
  const noteText = useCallback(
    (id: string, text: string) => {
      flow.setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...(n.data as NoteData), text } } : n)));
      save(["notes"]);
    },
    [flow, save],
  );
  const noteDelete = useCallback(
    (id: string) => {
      flow.setNodes((ns) => ns.filter((n) => n.id !== id));
      flow.setEdges((es) => es.filter((e) => e.source !== id));
      save(["notes"]);
    },
    [flow, save],
  );
  const noteNode = useCallback(
    (n: CanvasNote): Node => ({
      id: n.id,
      type: "note",
      position: { x: n.x, y: n.y },
      data: { text: n.text, onText: noteText, onDelete: noteDelete, editable } satisfies NoteData,
      dragHandle: ".tb-note-grip",
      deletable: false,
      zIndex: 5,
    }),
    [noteText, noteDelete, editable],
  );

  // ---- hand-added steps -----------------------------------------------------------------------
  const editStep = useCallback(
    (id: string, edit: StepEdit) => {
      if (!onSave) return;
      const snap = snapshot();
      onSave({
        layout: snap.layout,
        flow: map.flow ? snap.flow : undefined,
        steps: snap.steps.map((s) =>
          s.id !== id
            ? s
            : {
                ...s,
                ...(edit.title !== undefined ? { title: edit.title.trim() || "New step" } : {}),
                ...(edit.decision !== undefined ? { decision: edit.decision.trim() } : {}),
                ...(edit.tool !== undefined && s.process ? { process: { ...s.process, tool: edit.tool } } : {}),
              },
        ),
      });
    },
    [onSave, snapshot, map.flow],
  );
  const removeStep = useCallback(
    (id: string) => {
      if (!onSave) return;
      const snap = snapshot();
      const steps = snap.steps
        .filter((s) => s.id !== id)
        .map((s, i) => ({ ...s, order: i + 1, ...(s.process ? { process: { ...s.process, feedsInto: s.process.feedsInto.filter((x) => x !== id) } } : {}) }));
      const layout = { ...snap.layout };
      delete layout[id];
      delete layout[`rule-${id}`];
      onSave({
        steps,
        layout,
        flow: map.flow ? snap.flow.filter((e) => e.source !== id && e.target !== id) : undefined,
        notes: snap.notes.map((n) => (n.stepId === id ? { ...n, stepId: undefined } : n)),
      });
    },
    [onSave, snapshot, map.flow],
  );

  // ---- nodes --------------------------------------------------------------------------------
  const buildNodes = useCallback(
    (layout?: Record<string, XY>): Node[] => [
      ...usedLanes.map((li, i) => ({
        id: `lane-${li}`,
        type: "lane",
        position: { x: 0, y: i * LANE_H },
        data: {
          label: lanes[li],
          color: (auto.nodes.find((n) => n.lane === li && n.type === "step")?.data as StepData | undefined)?.color ?? "#5a1220",
          width: Math.max(auto.width + 400, 1600),
        } satisfies LaneData,
        draggable: false,
        selectable: false,
        deletable: false,
        focusable: false,
        zIndex: -1,
      })),
      ...auto.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: layout?.[n.id] ?? { x: n.x, y: laneY(n.lane) + (LANE_H - n.h) / 2 },
        data: n.type === "step" && editable ? { ...(n.data as StepData), tools, onEdit: editStep, onRemove: removeStep } : n.data,
        deletable: false,
      })),
      ...(map.notes ?? []).map(noteNode),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lanes and tools are part of the signature behind auto; notes load once per workflow
    [auto, usedLanes, laneY, noteNode, editStep, removeStep, editable],
  );

  // ---- edges --------------------------------------------------------------------------------
  const deleteEdge = useCallback(
    (id: string) => {
      const kind = (flow.getEdge(id)?.data as EdgeData | undefined)?.kind;
      flow.setEdges((es) => es.filter((e) => e.id !== id));
      save(kind === "data" ? ["steps"] : kind === "note" ? ["notes"] : ["flow"]);
    },
    [flow, save],
  );
  const makeEdge = useCallback(
    (source: string, target: string, kind: Kind): Edge => ({
      id: `${kind}:${source}->${target}`,
      source,
      target,
      ...(kind === "data" ? { sourceHandle: "data-out", targetHandle: "data-in" } : kind === "note" ? { targetHandle: "note-in" } : {}),
      type: "tb",
      data: { kind, onDelete: editable ? deleteEdge : undefined } satisfies EdgeData,
      deletable: editable,
    }),
    [deleteEdge, editable],
  );
  const buildEdges = useCallback(
    (savedFlow?: { source: string; target: string }[]): Edge[] => {
      const seq = auto.nodes;
      const next = (savedFlow ?? seq.slice(0, -1).map((a, i) => ({ source: a.id, target: seq[i + 1].id }))).filter((e) => ids.has(e.source) && ids.has(e.target));
      const data = timed.flatMap((t) => (t.step.process?.feedsInto ?? []).filter((id) => durationOf.has(id)).map((id) => ({ source: t.step.id, target: id })));
      const notes = (map.notes ?? []).filter((n) => n.stepId && ids.has(n.stepId)).map((n) => ({ source: n.id, target: n.stepId! }));
      return [
        ...next.map((e) => makeEdge(e.source, e.target, "next")),
        ...data.map((e) => makeEdge(e.source, e.target, "data")),
        ...notes.map((e) => makeEdge(e.source, e.target, "note")),
      ];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notes load once per workflow
    [auto, ids, timed, durationOf, makeEdge],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(buildNodes(map.layout));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(buildEdges(map.flow));
  // A rebuilt process map or a different workflow: lay out again (keeping saved positions and arrows).
  useEffect(() => {
    setNodes(buildNodes(map.layout));
    setEdges(buildEdges(map.flow));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the steps change, not after every save
  }, [buildNodes, buildEdges]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!editable || !c.source || !c.target || c.source === c.target) return;
      const from = flow.getNode(c.source);
      const to = flow.getNode(c.target);
      if (!from || !to || to.type === "note" || to.type === "lane") return;
      let kind: Kind = "next";
      if (from.type === "note") {
        if (to.type !== "step") return;
        kind = "note";
      } else if (c.sourceHandle === "data-out" || c.targetHandle === "data-in") {
        if (from.type !== "step" || to.type !== "step") return;
        kind = "data";
      }
      const e = makeEdge(c.source, c.target, kind);
      flow.setEdges((es) => [
        // A note is attached to one step: replace its old link.
        ...es.filter((x) => x.id !== e.id && !(kind === "note" && x.source === c.source && (x.data as EdgeData)?.kind === "note")),
        e,
      ]);
      save(kind === "data" ? ["steps"] : kind === "note" ? ["notes"] : ["flow"]);
    },
    [editable, flow, makeEdge, save],
  );

  // ---- order --------------------------------------------------------------------------------
  // Follow the arrows from Start; the steps met on the way, in that order, are the new order.
  const stepIds = useMemo(() => new Set(timed.map((t) => t.step.id)), [timed]);
  const chain = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    let at: string | undefined = "start";
    while (at && !seen.has(at)) {
      seen.add(at);
      if (stepIds.has(at)) out.push(at);
      const from: string = at;
      at = edges.find((e) => e.source === from && (e.data as EdgeData)?.kind === "next" && !seen.has(e.target))?.target;
    }
    return out;
  }, [edges, stepIds]);
  const current = timed.map((t) => t.step.id);
  const proposed = [...chain, ...current.filter((id) => !chain.includes(id))];
  const reordered = editable && proposed.some((id, i) => id !== current[i]);
  const unreached = current.filter((id) => !chain.includes(id)).length;
  const numberOf = new Map(timed.map((t) => [t.step.id, t.index + 1]));

  const applyOrder = () => {
    if (!onSave) return;
    const snap = snapshot();
    const byId = new Map(snap.steps.map((s) => [s.id, s]));
    // Arrows and positions are rebuilt for the new order; notes and data links stay.
    onSave({ steps: proposed.map((id, i) => ({ ...byId.get(id)!, order: i + 1 })), flow: undefined, layout: undefined, notes: snap.notes });
  };

  const reset = () => {
    const keepNotes = flow.getNodes().filter((n) => n.type === "note");
    const noteEdges = flow.getEdges().filter((e) => (e.data as EdgeData)?.kind !== "next");
    setNodes([...buildNodes(undefined).filter((n) => n.type !== "note"), ...keepNotes]);
    setEdges([...buildEdges(undefined).filter((e) => (e.data as EdgeData).kind === "next"), ...noteEdges]);
    onSave?.({ layout: undefined, flow: undefined });
    requestAnimationFrame(() => flow.fitView({ nodes: auto.nodes.map((n) => ({ id: n.id })), padding: 0.12, duration: 400 }));
  };

  const addNote = () => {
    const box = document.querySelector(".tb-canvas")?.getBoundingClientRect();
    const at = box ? flow.screenToFlowPosition({ x: box.left + box.width / 2 - NOTE_W / 2, y: box.top + 40 }) : { x: 100, y: 40 };
    flow.setNodes((ns) => [...ns, noteNode({ id: `note-${Date.now().toString(36)}`, text: "", x: Math.round(at.x), y: Math.round(at.y) })]);
    save(["notes"]);
  };

  const addStep = () => {
    if (!onSave) return;
    const box = document.querySelector(".tb-canvas")?.getBoundingClientRect();
    const at = box ? flow.screenToFlowPosition({ x: box.left + box.width / 2 - BOX_W / 2, y: box.top + box.height / 2 - BOX_H / 2 }) : { x: 200, y: 60 };
    const snap = snapshot();
    const id = `m${Date.now().toString(36)}`;
    const step: WorkMapStep = {
      id,
      order: snap.steps.length + 1,
      title: "New step",
      time: "",
      decision: "",
      reason: "",
      expertQuote: "",
      guardrails: [],
      addedBy: me ?? "",
      ...(snap.steps.some((s) => s.process) ? { process: { tool: tools[0] ?? "", inputs: [], outputs: [], feedsInto: [], decision: "", unknown: [] } } : {}),
    };
    onSave({ steps: [...snap.steps, step], layout: { ...snap.layout, [id]: { x: Math.round(at.x), y: Math.round(at.y) } }, flow: map.flow ? snap.flow : undefined, notes: snap.notes });
  };

  // ---- view ---------------------------------------------------------------------------------
  const boxes = auto.nodes.map((n) => ({ id: n.id }));
  const fitAll = () => flow.fitView({ nodes: boxes, padding: 0.12, duration: 400 });
  const notesPer = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) if ((e.data as EdgeData)?.kind === "note") m.set(e.target, (m.get(e.target) ?? 0) + 1);
    return m;
  }, [edges]);
  const shownNodes = useMemo(
    () => nodes.map((n) => (n.type === "step" ? { ...n, data: { ...(n.data as StepData), hot: n.id === hot, notes: notesPer.get(n.id) ?? 0 } } : n)),
    [nodes, hot, notesPer],
  );
  const shownEdges = useMemo(
    () =>
      edges.map((e) => {
        const d = e.data as EdgeData;
        const on = hot !== null && (e.source === hot || e.target === hot);
        const label = d.kind === "next" && stepIds.has(e.source) ? fmt(durationOf.get(e.source) ?? null) : undefined;
        return { ...e, data: { ...d, hot: on, dim: hot !== null && !on, label: label && label !== "–" ? label : undefined } };
      }),
    [edges, hot, stepIds, durationOf, fmt],
  );

  const openDetails = (n: Node) => {
    const id = n.type === "rule" ? (n.data as RuleData).stepId : n.id;
    if (n.type === "step" || n.type === "rule") document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!timed.length) return null;
  const height = Math.min(Math.max(usedLanes.length * LANE_H + 60, 380), 720);
  const btn = "inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-ink transition-colors hover:border-crimson/40";

  return (
    <div className="mb-8 overflow-hidden rounded-lg border border-line bg-white shadow-[0_1px_3px_rgba(58,11,20,.06)]">
      <div className={`flex flex-wrap items-center gap-2 border-b px-3 py-2 text-[13px] text-muted transition-colors ${editable ? "border-amber/50 bg-[#fff6db]" : "border-line bg-cream"}`}>
        {canEdit && (
          <div className="flex shrink-0 rounded-full border border-line bg-white p-0.5" role="group" aria-label="Mode">
            {(["view", "edit"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setHot(null);
                }}
                aria-pressed={mode === m}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors ${mode === m ? "bg-maroon font-bold text-blush" : "text-ink hover:text-crimson"}`}
              >
                {m === "view" ? <Eye size={14} aria-hidden="true" /> : <Pencil size={13} aria-hidden="true" />}
                {m === "view" ? "View" : "Edit"}
              </button>
            ))}
          </div>
        )}
        <span className="min-w-0 flex-1 basis-72">
          {editable
            ? "Drag boxes to move them. Drag from a box's right dot to another box to add an arrow (bottom dots: data link). Click an arrow, then × or Delete, to remove it. Double-click a box for its details."
            : canEdit
              ? "Click a box for its details. Drag the background to move around, scroll or pinch to zoom. Switch to Edit to change the map."
              : "Drag the background to move around. Scroll or pinch to zoom."}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {editable && (
            <>
              <button onClick={addStep} className={`${btn} border-crimson/40 bg-white text-crimson`}>
                <Plus size={14} aria-hidden="true" /> Add step
              </button>
              <button onClick={addNote} className={`${btn} border-amber/60 bg-[#fff6db]`}>
                <StickyNote size={14} aria-hidden="true" /> Add note
              </button>
            </>
          )}
          <button onClick={fitAll} className={btn}>
            <Maximize2 size={14} aria-hidden="true" /> Fit to screen
          </button>
          {editable && (
            <button onClick={reset} className={btn} title="Automatic arrows and layout (notes and data links stay)">
              <RotateCcw size={14} aria-hidden="true" /> Reset
            </button>
          )}
        </span>
      </div>

      {reordered && (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber/40 bg-[#fff6db] px-4 py-2.5 text-[14px] text-[#5c4300]">
          <ListOrdered size={18} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            The arrows now give a new step order: <b>{proposed.map((id) => numberOf.get(id)).join(" → ")}</b>
            {unreached > 0 && ` (${unreached} step${unreached === 1 ? "" : "s"} not reached from Start go last)`}. The Work Map and Training will follow it.
          </span>
          <button onClick={applyOrder} className="tb-btn-dark h-9">Apply new order</button>
        </div>
      )}

      <div style={{ height }} className={`tb-canvas relative ${editable ? "tb-editing" : ""}`}>
        <Markers />
        <ReactFlow
          nodes={shownNodes}
          edges={shownEdges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgesDelete={(es) => {
            const kinds = new Set(es.map((e) => (e.data as EdgeData)?.kind));
            save([...(kinds.has("next") ? (["flow"] as const) : []), ...(kinds.has("data") ? (["steps"] as const) : []), ...(kinds.has("note") ? (["notes"] as const) : [])]);
          }}
          onNodeDragStop={(_, n) => save(n.type === "note" ? ["notes"] : ["layout"])}
          onNodeMouseEnter={(_, n) => n.type !== "lane" && n.type !== "note" && setHot(n.id)}
          onNodeMouseLeave={() => setHot(null)}
          // View mode: a click opens the step's details (as before). Edit mode: double-click, so a click can select.
          onNodeClick={(_, n) => !editable && openDetails(n)}
          onNodeDoubleClick={(_, n) => editable && openDetails(n)}
          nodesConnectable={editable}
          nodesDraggable={editable}
          elementsSelectable={editable}
          edgesReconnectable={false}
          deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
          connectionLineStyle={{ stroke: "#a4161a", strokeWidth: 2 }}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ nodes: boxes.slice(0, 6), padding: 0.1, maxZoom: 1 }}
          minZoom={0.25}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#ddc9cc" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(n) => (n.type === "lane" ? "transparent" : n.type === "step" ? (n.data as StepData).color : n.type === "note" ? "#f2c94c" : "#3a0b14")}
            maskColor="rgba(248,242,243,.7)"
            className="!hidden !rounded-md !border !border-line sm:!block"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

// ---- nodes ----------------------------------------------------------------------------------

function StepNode(props: NodeProps) {
  const d = props.data as StepData;
  if (d.step.addedBy !== undefined && d.onEdit) return <ManualStepNode {...props} />;
  return <RecordedStepNode {...props} />;
}

/** A step someone added by hand: title, what to do and tool are typed in on the box. */
function ManualStepNode({ id, data }: NodeProps) {
  const { step: s, index, color, hot, tools = [], onEdit, onRemove } = data as StepData;
  const [title, setTitle] = useState(s.title === "New step" ? "" : s.title);
  const [what, setWhat] = useState(s.decision);
  const [confirm, setConfirm] = useState(false);
  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border-2 border-dashed bg-white"
      style={{ width: BOX_W, minHeight: BOX_H, borderColor: hot ? color : `${color}99`, boxShadow: hot ? `0 0 0 3px ${color}33, 0 14px 32px rgba(58,11,20,.18)` : "0 2px 8px rgba(58,11,20,.08)" }}
    >
      <Handle type="target" position={Position.Left} className="tb-h" />
      <Handle type="source" position={Position.Right} className="tb-h" />
      <Handle id="data-out" type="source" position={Position.Bottom} className="tb-h tb-h-data" style={{ left: "35%" }} />
      <Handle id="data-in" type="target" position={Position.Bottom} className="tb-h tb-h-data" style={{ left: "65%" }} />
      <Handle id="note-in" type="target" position={Position.Top} className="tb-h tb-h-note" />
      <div className="flex cursor-grab items-center gap-2 px-2.5 py-1.5 text-white active:cursor-grabbing" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/25 text-[11px] font-bold">{index + 1}</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== s.title && onEdit?.(id, { title })}
          placeholder="Step title"
          aria-label="Step title"
          autoFocus={s.title === "New step"}
          className="nodrag min-w-0 flex-1 rounded bg-white/15 px-1.5 py-0.5 text-[13.5px] font-bold text-white outline-none placeholder:text-white/60 focus:bg-white/25"
        />
        <button onClick={() => setConfirm(true)} className="nodrag grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-white/20" aria-label="Delete this step" title="Delete this step">
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>
      {confirm ? (
        <div className="flex flex-1 flex-col justify-center gap-2 bg-err-soft px-3 py-2 text-[12.5px] text-[#8E1B1B]">
          Delete this step?
          <span className="flex gap-1.5">
            <button onClick={() => onRemove?.(id)} className="nodrag rounded-full bg-err px-3 py-1 font-bold text-white">Delete</button>
            <button onClick={() => setConfirm(false)} className="nodrag rounded-full border border-line bg-white px-3 py-1 text-ink">Cancel</button>
          </span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5 px-2.5 py-2">
          <textarea
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            onBlur={() => what.trim() !== s.decision && onEdit?.(id, { decision: what })}
            placeholder="What to do in this step"
            aria-label="What to do in this step"
            rows={2}
            className="nodrag nowheel w-full resize-none rounded border border-line px-2 py-1 text-[12.5px] leading-snug text-ink outline-none focus:border-crimson"
          />
          {tools.length > 0 && (
            <select
              value={s.process?.tool ?? ""}
              onChange={(e) => onEdit?.(id, { tool: e.target.value })}
              aria-label="Tool or site"
              className="nodrag h-7 rounded border border-line bg-white px-1.5 text-[12px] text-ink outline-none focus:border-crimson"
            >
              {tools.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          <span className="text-[11px] text-muted">Added by hand · connect it with arrows</span>
        </div>
      )}
    </div>
  );
}

function RecordedStepNode({ data }: NodeProps) {
  const { step: s, index, color, hot, notes } = data as StepData;
  const p = s.process;
  // Questions for the expert on this step: answered ones with their answer, then the open ones.
  const answered = s.answers ?? [];
  const asked = new Set(answered.map((a) => a.q));
  const openQs = (p?.unknown ?? []).filter((q) => !asked.has(q));
  const qas: { q: string; a?: string }[] = [...answered.map((a) => ({ q: a.q, a: a.a })), ...openQs.map((q) => ({ q }))];
  const shownQas = qas.slice(0, 2);
  const needs = p?.inputs.map((x) => x.name) ?? [];
  const makes = p?.outputs ?? [];
  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border bg-white transition-shadow duration-200"
      style={{
        width: BOX_W,
        minHeight: BOX_H,
        borderColor: hot ? color : "#ded4d5",
        boxShadow: hot ? `0 0 0 3px ${color}33, 0 14px 32px rgba(58,11,20,.18)` : "0 2px 8px rgba(58,11,20,.08)",
      }}
    >
      <Handle type="target" position={Position.Left} className="tb-h" style={{ top: 22 }} />
      <Handle type="source" position={Position.Right} className="tb-h" style={{ top: 22 }} />
      <Handle id="data-out" type="source" position={Position.Bottom} className="tb-h tb-h-data" style={{ left: "35%" }} />
      <Handle id="data-in" type="target" position={Position.Bottom} className="tb-h tb-h-data" style={{ left: "65%" }} />
      <Handle id="note-in" type="target" position={Position.Top} className="tb-h tb-h-note" />
      <div className="flex cursor-grab items-start gap-2 px-3 py-2 text-white active:cursor-grabbing" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
        <span className="mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/25 text-[11px] font-bold">{index + 1}</span>
        <span className="line-clamp-2 text-[13.5px] font-bold leading-snug">{s.title}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2 text-[12px] leading-snug text-[#5b4b4e]">
        {p ? (
          <>
            <Line label="Needs" items={needs} />
            <Line label="Produces" items={makes} />
          </>
        ) : (
          <p className="line-clamp-3">{s.decision || s.short || "Recorded step"}</p>
        )}
        {shownQas.length > 0 && (
          <ul className="mt-1 flex flex-col gap-1 border-t border-line pt-1.5">
            {shownQas.map(({ q, a }) => (
              <li key={q} className={`rounded px-1.5 py-1 text-[11.5px] leading-snug ${a ? "bg-ok-soft" : "bg-warn-soft"}`}>
                <p className={`line-clamp-2 ${a ? "text-[#2f4a3a]" : "text-[#6b5000]"}`}>
                  <b>{a ? "Q:" : "? Ask:"}</b> {q}
                </p>
                {a && (
                  <p className="mt-0.5 line-clamp-2 text-ok">
                    <b>A:</b> {a}
                  </p>
                )}
              </li>
            ))}
            {qas.length > 2 && <li className="text-[11px] text-muted">+{qas.length - 2} more in the step details</li>}
          </ul>
        )}
        {(s.guardrails.length > 0 || notes > 0 || s.addedBy !== undefined) && (
          <div className="mt-auto flex flex-wrap gap-1.5">
            {s.addedBy !== undefined && <span className="rounded-full border border-dashed border-crimson/50 px-2 py-[1px] text-[11px] font-bold text-crimson">Added by hand</span>}
            {s.guardrails.length > 0 && <span className="rounded-full bg-cream px-2 py-[1px] text-[11px] font-bold text-crimson">◆ {s.guardrails.length} rule{s.guardrails.length > 1 ? "s" : ""}</span>}
            {notes > 0 && <span className="rounded-full bg-[#fff1c2] px-2 py-[1px] text-[11px] font-bold text-[#6b5000]">✎ {notes} note{notes > 1 ? "s" : ""}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function RuleNode({ data }: NodeProps) {
  const { text, kind } = data as RuleData;
  return (
    <div className="flex flex-col items-center" style={{ width: RULE_W }} title={text}>
      <Handle type="target" position={Position.Left} className="tb-h" style={{ top: 32 }} />
      <Handle type="source" position={Position.Right} className="tb-h" style={{ top: 32 }} />
      <div className="grid h-16 w-16 place-items-center">
        <div className="grid h-[46px] w-[46px] rotate-45 place-items-center rounded-[4px] bg-[linear-gradient(135deg,#5a1220,#2a070e)] shadow-[0_4px_10px_rgba(58,11,20,.3)]">
          <span className="-rotate-45 text-[11px] font-bold text-amber">{kind}</span>
        </div>
      </div>
      <p className="mt-1 line-clamp-3 text-center text-[11.5px] leading-snug text-[#5b4b4e]">{text}</p>
    </div>
  );
}

function PillNode({ data }: NodeProps) {
  const { label } = data as PillData;
  const start = label === "Start";
  return (
    <div
      className={`relative grid h-11 place-items-center rounded-full text-[14px] font-bold shadow-[0_4px_12px_rgba(58,11,20,.25)] ${start ? "bg-amber text-maroon-3" : "bg-maroon text-blush"}`}
      style={{ width: PILL_W }}
    >
      {start && <span className="tb-cta absolute inset-0 rounded-full" aria-hidden="true" />}
      {start ? <Handle type="source" position={Position.Right} className="tb-h" /> : <Handle type="target" position={Position.Left} className="tb-h" />}
      <span className="relative">{label}</span>
    </div>
  );
}

function NoteNode({ id, data, selected }: NodeProps) {
  const { text, onText, onDelete, editable } = data as NoteData;
  const [draft, setDraft] = useState(text);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!text && editable) area.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus a new, empty note once
  }, []);
  return (
    <div
      className={`relative flex flex-col rounded-md bg-[#fff1c2] shadow-[0_8px_20px_rgba(107,80,0,.18)] [transform:rotate(-1deg)] ${selected ? "ring-2 ring-amber" : ""}`}
      style={{ width: NOTE_W }}
    >
      <Handle type="source" position={Position.Bottom} className="tb-h tb-h-note" />
      <div className="tb-note-grip flex cursor-grab items-center justify-between rounded-t-md bg-[#f7dc8a] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.1em] text-[#6b5000] active:cursor-grabbing">
        Note
        {editable && (
          <button onClick={() => onDelete(id)} className="nodrag grid h-5 w-5 place-items-center rounded-full hover:bg-black/10" aria-label="Delete note" title="Delete note">
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      <textarea
        ref={area}
        value={draft}
        readOnly={!editable}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== text && onText(id, draft)}
        placeholder="Write a note, then drag the dot below onto a step to attach it."
        rows={4}
        aria-label="Note"
        className="nodrag nowheel w-full resize-none rounded-b-md bg-transparent px-2.5 py-2 text-[13.5px] leading-snug text-[#3d2f00] outline-none placeholder:text-[#9a8440]"
      />
    </div>
  );
}

function LaneNode({ data }: NodeProps) {
  const { label, color, width } = data as LaneData;
  return (
    <div className="pointer-events-none border-b border-line" style={{ width, height: LANE_H, background: `linear-gradient(90deg, ${color}16, ${color}05 30%, transparent 70%)` }}>
      <div className="absolute inset-y-0 left-0 flex items-center justify-center border-r border-line bg-white/80" style={{ width: LABEL_W }}>
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
        <span className="max-h-[200px] truncate text-[12.5px] font-bold [transform:rotate(180deg)] [writing-mode:vertical-rl]" style={{ color }}>
          {label}
        </span>
      </div>
    </div>
  );
}

function Line({ label, items }: { label: string; items: string[] }) {
  return (
    <p className="line-clamp-2">
      <b className="text-ink">{label}:</b> {items.length ? items.join(", ") : <span className="text-[#a8999c]">nothing recorded</span>}
    </p>
  );
}

// ---- edges ----------------------------------------------------------------------------------

function TbEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps) {
  const d = (data ?? { kind: "next" }) as EdgeData;
  const [path, lx, ly] =
    d.kind === "next"
      ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 })
      : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: d.kind === "data" ? 0.5 : 0.25 });
  const on = selected || d.hot;
  const stroke = selected ? "#a4161a" : d.kind === "data" ? "#f2a007" : d.kind === "note" ? "#c9a227" : d.hot ? "#a4161a" : "#8c7a7d";
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={d.kind === "note" ? undefined : `url(#tb-arrow-${on ? "on" : d.kind})`}
        className={d.kind === "next" && !selected ? "tb-flow-edge" : ""}
        style={{
          stroke,
          strokeWidth: on ? 2.6 : 1.7,
          strokeDasharray: d.kind === "data" ? "6 5" : d.kind === "note" ? "2 4" : undefined,
          opacity: d.dim && !selected ? 0.3 : 1,
          transition: "opacity .2s ease-out",
        }}
        interactionWidth={22}
      />
      <EdgeLabelRenderer>
        <div className="nodrag nopan pointer-events-auto absolute flex items-center gap-1" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
          {d.label && <span className="rounded-full border border-line bg-white px-2 py-[1px] text-[11.5px] font-bold text-ink shadow-sm">{d.label}</span>}
          {selected && d.onDelete && (
            <button
              onClick={() => d.onDelete!(id)}
              className="grid h-6 w-6 place-items-center rounded-full bg-crimson text-white shadow-md transition-transform hover:scale-110"
              aria-label="Remove this arrow"
              title="Remove this arrow"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/** Arrow heads for the edges, one per colour. */
function Markers() {
  const heads: [string, string][] = [
    ["next", "#8c7a7d"],
    ["data", "#f2a007"],
    ["on", "#a4161a"],
  ];
  return (
    <svg className="absolute h-0 w-0" aria-hidden="true">
      <defs>
        {heads.map(([k, c]) => (
          <marker key={k} id={`tb-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={c} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

const NODE_TYPES = { step: StepNode, rule: RuleNode, pill: PillNode, lane: LaneNode, note: NoteNode };
const EDGE_TYPES = { tb: TbEdge };
