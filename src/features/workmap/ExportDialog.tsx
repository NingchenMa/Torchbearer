"use client";
// "Export for AI agents": choose Markdown (any AI agent) or JSON (developers), what to
// include, preview exactly what the agent will read, then download.

import { useState } from "react";
import type { WorkflowRecord, WorkMap } from "@/lib/types";
import Dialog, { btnIndigo, btnIndigoOutline } from "@/features/apprentice/Dialog";
import { DEFAULT_EXPORT, downloadText, toAgentJson, toAgentMarkdown, type ExportOptions } from "./exportAgent";

export default function ExportDialog({
  map,
  onClose,
  workflowId,
  onBuilt,
}: {
  map: WorkMap;
  onClose: () => void;
  /** Set for a saved workflow: lets the dialog add tools and data by building the process map. */
  workflowId?: string;
  onBuilt?: (record: WorkflowRecord) => void;
}) {
  const [format, setFormat] = useState<"md" | "json">("md");
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const built = !!map.processBuiltAt;

  async function build() {
    if (!workflowId) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const r = await fetch("/api/processmap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: workflowId }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(data.error ?? ""));
      onBuilt?.(data as WorkflowRecord);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setBuildError(/took longer|503|429|high demand/i.test(m) ? "The AI model is busy right now. Try again in a minute." : "Couldn't add them. Try again.");
    } finally {
      setBuilding(false);
    }
  }
  const text = format === "md" ? toAgentMarkdown(map, opts) : toAgentJson(map, opts);
  const file = format === "md" ? "apprentice-rules.md" : "apprentice-rules.json";

  const formatOption = (value: "md" | "json", title: string, sub: string) => (
    <label className={`flex cursor-pointer gap-3 border p-3 ${format === value ? "border-indigo bg-indigo-soft" : "border-line"}`}>
      <input type="radio" name="format" checked={format === value} onChange={() => setFormat(value)} className="mt-1 accent-[#5146d9]" />
      <span>
        <span className="block text-[16px]">{title}</span>
        <span className="text-[13.5px] text-[#444]">{sub}</span>
      </span>
    </label>
  );
  const include = (key: keyof ExportOptions, label: string) => (
    <label className="flex cursor-pointer items-center gap-2.5 py-1 text-[15px]">
      <input type="checkbox" checked={opts[key]} onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })} className="h-4 w-4 accent-[#5146d9]" />
      {label}
    </label>
  );

  return (
    <Dialog
      title="Export for AI agents"
      subtitle="Turn the Work Map into rules an agent can follow"
      modeLabel="REVIEW MODE"
      width={940}
      footer={
        <>
          <span className="flex-1 text-[13.5px] text-[#444]">The agent follows the expert&apos;s steps and stops where they would.</span>
          <button className={btnIndigoOutline} onClick={onClose}>Cancel</button>
          <button className={btnIndigo} onClick={() => downloadText(file, text, format === "md" ? "text/markdown" : "application/json")}>
            Download {file} ↓
          </button>
        </>
      }
    >
      <div className="grid md:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-3 border-line p-5 md:border-r">
          <div className="text-[13px] font-bold uppercase tracking-wide text-[#333]">Format</div>
          {formatOption("md", "Markdown · for any AI agent", "Paste into ChatGPT, Claude or a company bot's instructions")}
          {formatOption("json", "JSON · for developers", "Build new tools or checks on top of it")}
          <div className="pt-2 text-[13px] font-bold uppercase tracking-wide text-[#333]">Include</div>
          {include("quotes", "Expert quotes")}
          {include("guardrails", "Guardrails")}
          {include("process", "Tools, data and step links")}
          {include("screenMoments", "Timing of each step")}
          {opts.process && !built && workflowId && (
            <div className="rounded-sm border border-[#f0d58a] bg-warn-soft p-3 text-[13.5px] text-[#5c4400]">
              Tools, the data each step needs and produces, and how steps connect aren&apos;t worked out yet.
              <button onClick={build} disabled={building} className="mt-2 block h-9 rounded-sm bg-indigo px-3 text-[14px] text-white hover:bg-indigo-dark disabled:opacity-60">
                {building ? "Working it out… (about 15 s)" : "Add them now"}
              </button>
              {buildError && <span className="mt-1 block text-err">{buildError}</span>}
            </div>
          )}
          <p className="text-[13px] text-[#444]">Names and card numbers are removed from the export.</p>
        </div>
        <div className="min-w-0 p-5">
          <div className="mb-2 text-[13px] font-bold uppercase tracking-wide text-[#333]">Preview · {file}</div>
          <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap border border-line bg-panel-2 p-4 font-mono text-[13px] leading-relaxed">{text}</pre>
        </div>
      </div>
    </Dialog>
  );
}
