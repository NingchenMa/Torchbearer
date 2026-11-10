"use client";
// "Export for AI agents": choose Markdown (any AI agent) or JSON (developers), what to
// include, preview exactly what the agent will read, then download.

import { useState } from "react";
import type { WorkMap } from "@/lib/types";
import Dialog, { btnIndigo, btnIndigoOutline } from "@/features/apprentice/Dialog";
import { downloadText, toAgentJson, toAgentMarkdown, type ExportOptions } from "./exportAgent";
import { buildSkillFiles, buildSkillZip, downloadBytes, type SkillInput } from "./skillFolder";

export type ExportMeta = Pick<SkillInput, "id" | "name" | "createdAt" | "trainedBy">;

export default function ExportDialog({ map, meta, onClose }: { map: WorkMap; meta: ExportMeta; onClose: () => void }) {
  const [format, setFormat] = useState<"md" | "json" | "zip">("zip");
  const [screenshots, setScreenshots] = useState(true);
  const skill: SkillInput = { ...meta, map, steps: map.steps, includeScreenshots: screenshots };
  const [opts, setOpts] = useState<ExportOptions>({ quotes: true, guardrails: true, screenMoments: false });
  const zipName = buildSkillZip({ ...skill, includeScreenshots: false }).filename;
  const text = format === "zip" ? (buildSkillFiles({ ...skill, includeScreenshots: false })["SKILL.md"] as string) : format === "md" ? toAgentMarkdown(map, opts) : toAgentJson(map, opts);
  const file = format === "zip" ? zipName : format === "md" ? "apprentice-rules.md" : "apprentice-rules.json";
  const download = () => {
    if (format === "zip") {
      const z = buildSkillZip(skill);
      downloadBytes(z.filename, z.bytes);
    } else downloadText(file, text, format === "md" ? "text/markdown" : "application/json");
  };

  const formatOption = (value: "md" | "json" | "zip", title: string, sub: string) => (
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
          <button className={btnIndigo} onClick={download}>
            Download {file} ↓
          </button>
        </>
      }
    >
      <div className="grid md:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-3 border-line p-5 md:border-r">
          <div className="text-[13px] font-bold uppercase tracking-wide text-[#333]">Format</div>
          {formatOption("zip", "Skill folder (.zip) · for automation", "Markdown files and Mermaid diagrams: steps, rules, data, systems, hand-overs")}
          {formatOption("md", "Markdown · for any AI agent", "Paste into ChatGPT, Claude or a company bot's instructions")}
          {formatOption("json", "JSON · for developers", "Build new tools or checks on top of it")}
          <div className="pt-2 text-[13px] font-bold uppercase tracking-wide text-[#333]">Include</div>
          {format === "zip" ? (
            <>
              <label className="flex cursor-pointer items-center gap-2.5 py-1 text-[15px]">
                <input type="checkbox" checked={screenshots} onChange={(e) => setScreenshots(e.target.checked)} className="h-4 w-4 accent-[#5146d9]" />
                Screenshots
              </label>
              <p className="text-[13px] text-[#444]">Text has names and card numbers removed. Screenshots are copied as recorded, so check them before sharing.</p>
            </>
          ) : (
            <>
              {include("quotes", "Expert quotes")}
              {include("guardrails", "Guardrails")}
              {include("screenMoments", "Screen moments (times)")}
              <p className="text-[13px] text-[#444]">Names and card numbers are removed from the export.</p>
            </>
          )}
        </div>
        <div className="min-w-0 p-5">
          <div className="mb-2 text-[13px] font-bold uppercase tracking-wide text-[#333]">Preview · {file}</div>
          <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap border border-line bg-panel-2 p-4 font-mono text-[13px] leading-relaxed">{text}</pre>
        </div>
      </div>
    </Dialog>
  );
}
