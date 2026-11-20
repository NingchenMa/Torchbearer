"use client";
// The floating Torchbearer's face: status, the current question, the workflow it is
// writing live from the screenshots (with the expert's answers merged in), and controls.

import { useState } from "react";
import { ListeningBars } from "@/features/apprentice/Popup";
import { BotFace } from "./Launcher";
import MicMeter from "./MicMeter";
import { TypeChip, guardrailType } from "@/features/workmap/WorkMapView";
import type { Observer, ObserverStatus } from "./useObserver";

const STATUS: Record<ObserverStatus, string> = {
  idle: "Not recording",
  connecting: "Connecting…",
  watching: "Recording · asks when you pause",
  reading: "Reading the screen…",
  asking: "Asking…",
  off_record: "Paused",
  debrief: "Debrief · listening",
  building: "Saving the workflow…",
};

const btnOutline = "h-9 rounded-sm border border-indigo bg-white px-3 text-[14px] text-indigo hover:bg-indigo-soft disabled:opacity-50";
const btnPrimary = "h-9 rounded-sm bg-indigo px-3 text-[14px] text-white hover:bg-indigo-dark disabled:opacity-50";

export default function ObserverPanel({ o, onStart }: { o: Observer; onStart?: (workflowName: string, role: string) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const lastAgent = [...o.transcript].reverse().find((t) => t.speaker === "agent");
  const lastYou = [...o.transcript].reverse().find((t) => t.speaker === "expert");
  const tail = o.transcript.slice(-4);

  return (
    <div className="flex h-full flex-col bg-white text-ink">
      <div className="flex items-center gap-3 bg-indigo px-4 py-3 text-white">
        <BotFace size={34} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[17px] font-medium">Torchbearer</div>
          <div className="truncate text-[12.5px] opacity-90">{o.offRecord ? "Recording paused" : "Learning from your screen"}</div>
        </div>
        <span className="rounded-sm border border-white/70 px-2 py-0.5 text-[11px] font-bold tracking-wide">
          {o.phase === "task" ? "LEARNING MODE" : "REVIEW MODE"}
        </span>
      </div>

      <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2 text-[13px] text-indigo">
        {(o.status === "watching" || o.status === "debrief") && <ListeningBars active />}
        {o.status === "reading" && <span className="h-2 w-2 animate-pulse rounded-full bg-indigo" />}
        <span className="flex-1 truncate">{STATUS[o.status]}</span>
        <MicMeter getLevel={o.micLevel} active={o.connected && !o.offRecord} />
        {o.sharing && <span className="text-[12px] text-err">● REC</span>}
      </div>

      {o.offRecord ? (
        <div className="px-5 py-8 text-center">
          <div className="text-[12px] font-bold tracking-[.12em] text-[#666]">PAUSED</div>
          <div className="my-1.5 text-[20px]">Nothing is being saved</div>
          <p className="text-[14px] leading-relaxed text-[#555]">No screenshots, no voice, no questions until you resume. Use it for anything private.</p>
        </div>
      ) : (
        lastAgent && (
          <div className="border-b border-line bg-indigo-soft/60 px-4 py-3">
            <div className="text-[12px] text-[#555]">
              <b className="text-indigo">Torchbearer</b> <span className="text-muted">{lastAgent.time}</span>
            </div>
            <p className="mt-0.5 text-[16px] leading-snug">{lastAgent.text}</p>
            {lastYou && <p className="mt-1.5 text-[13px] leading-snug text-[#0f766e]"><b>You said:</b> {lastYou.text}</p>}
          </div>
        )
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {o.phase === "task" ? (
          <>
            <div className="mb-2 flex items-center text-[12px] font-bold uppercase tracking-[.12em] text-[#667085]">
              Workflow, written live <span className="ml-auto font-normal normal-case tracking-normal">{o.workflow.length} steps</span>
            </div>
            {o.workflow.length === 0 && (
              <p className="text-[14px] leading-relaxed text-[#555]">
                {o.sharing
                  ? "Work as usual. I write down each step from your screen and only ask when something isn't clear from the screenshots."
                  : "Share your screen to start."}
              </p>
            )}
            <ol className="space-y-2.5">
              {o.workflow.map((s, i) => (
                <li key={s.id} className="rise rounded-md border border-line px-3 py-2">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-brand text-[11px] font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-medium leading-snug">{s.title}</div>
                      {s.detail && <div className="text-[12.5px] leading-snug text-[#667085]">{s.detail}</div>}
                      {s.why && <div className="mt-1 border-l-2 border-indigo pl-2 text-[13px] italic text-[#1f2d3d]">“{s.why}”</div>}
                      {s.rule && (
                        <div className="mt-1 flex items-start gap-1.5 text-[13px]">
                          <TypeChip type={guardrailType(s.rule)} /> {s.rule}
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-muted">{s.time}</span>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <div className="mb-2 text-[12px] font-bold uppercase tracking-[.12em] text-[#667085]">Debrief</div>
            <ol className="space-y-1.5 text-[14px] leading-snug">
              {tail.map((t, i) => (
                <li key={i}>
                  <b className={t.speaker === "agent" ? "text-indigo" : "text-[#0f766e]"}>{t.speaker === "agent" ? "Torchbearer" : "You"}:</b> {t.text}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[12.5px] text-muted">{o.workflow.length} workflow steps · {o.qa.length} answers so far</p>
          </>
        )}
        {o.error && <p className="mt-3 border-l-4 border-warn bg-warn-soft px-3 py-2 text-[12.5px]">{o.error}</p>}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        {!o.sharing && o.phase === "task" ? (
          onStart && (
            <div className="flex w-full flex-col gap-2">
              <label className="text-[12px] font-bold uppercase tracking-[.12em] text-[#667085]" htmlFor="wf-name">Name this workflow</label>
              <input
                id="wf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Paying a bill"
                className="h-10 w-full rounded-sm border border-[#9aa0a6] px-3 text-[15px] focus:border-indigo focus:outline-none"
              />
              <label className="text-[12px] font-bold uppercase tracking-[.12em] text-[#667085]" htmlFor="wf-role">Your role</label>
              <input
                id="wf-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Accounts payable"
                className="h-10 w-full rounded-sm border border-[#9aa0a6] px-3 text-[15px] focus:border-indigo focus:outline-none"
              />
              <button className={`${btnPrimary} w-full`} onClick={() => onStart(name, role)} disabled={!name.trim()}>● Start recording</button>
            </div>
          )
        ) : o.phase === "task" ? (
          <>
            <button className={`${btnOutline} flex-1`} onClick={o.toggleOffRecord}>{o.offRecord ? "▶ Resume" : "❚❚ Pause"}</button>
            <button className={`${btnPrimary} flex-1`} onClick={o.endTask}>Stop recording</button>
          </>
        ) : (
          <button className={`${btnPrimary} flex-1`} onClick={o.sendToMapping} disabled={o.phase === "building"}>
            {o.phase === "building" ? "Saving to the database…" : "Send to Mapping →"}
          </button>
        )}
      </div>
    </div>
  );
}
