"use client";
// The floating Torchbearer in Training mode. First it asks which saved workflow to practise.
// Then: the workflow's steps with Learned ✓ / Relearn ↺ (this session, or from last time),
// the latest gentle guidance, and Start / Stop recording.

import Link from "next/link";
import { ListeningBars } from "@/features/apprentice/Popup";
import { BotFace } from "./Launcher";
import MicMeter from "./MicMeter";
import type { StepMastery, WorkflowRecord, WorkflowSummary } from "@/lib/types";
import type { Coach, CoachStatus } from "./useCoach";

const STATUS: Record<CoachStatus, string> = {
  idle: "Not recording",
  connecting: "Connecting…",
  watching: "Watching · guides when you pause",
  reading: "Looking at your screen…",
  speaking: "Speaking…",
  done: "Practice finished",
};

const btnPrimary = "h-9 rounded-sm bg-indigo px-3 text-[14px] text-white hover:bg-indigo-dark disabled:opacity-50";

interface Props {
  c: Coach;
  workflows: WorkflowSummary[];
  selected: WorkflowRecord | null;
  onSelect: (id: string | null) => void;
}

export default function CoachPanel({ c, workflows, selected, onSelect }: Props) {
  const learned = Object.values(c.mastery).filter((m) => m === "learned").length;
  const relearn = Object.values(c.mastery).filter((m) => m === "relearn").length;

  return (
    <div className="flex h-full flex-col bg-white text-ink">
      <div className="flex items-center gap-3 bg-indigo px-4 py-3 text-white">
        <BotFace size={34} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[17px] font-medium">Torchbearer</div>
          <div className="truncate text-[12.5px] opacity-90">{selected ? `Practising · ${selected.name}` : "Learning from your team's experts"}</div>
        </div>
        <span className="rounded-sm border border-white/70 px-2 py-0.5 text-[11px] font-bold tracking-wide">TEACHING MODE</span>
      </div>

      {!selected ? (
        // Step 1: which workflow?
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <p className="text-[16px] leading-snug">Hi! Which workflow do you want to practise?</p>
          <ul className="mt-3 space-y-2">
            {workflows.map((w) => {
              const ready = w.published;
              return (
                <li key={w.id}>
                  <button
                    disabled={!ready}
                    onClick={() => onSelect(w.id)}
                    className="w-full rounded-md border border-line px-3 py-2.5 text-left hover:border-indigo hover:bg-indigo-soft/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line disabled:hover:bg-transparent"
                  >
                    <div className="text-[15px] font-medium">{w.name}</div>
                    <div className="text-[12.5px] text-[#667085]">
                      {w.stepCount} steps · {ready ? "approved by the expert" : "on hold, waiting for the expert's approval"}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {workflows.length === 0 && (
            <p className="mt-3 text-[14px] text-[#667085]">
              No workflows yet. <Link href="/capture" className="text-brand hover:underline">Record one in Capture</Link>.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2 text-[13px] text-indigo">
            {c.status === "watching" && <ListeningBars active />}
            {c.status === "reading" && <span className="h-2 w-2 animate-pulse rounded-full bg-indigo" />}
            <span className="flex-1 truncate">{STATUS[c.status]}</span>
            <MicMeter getLevel={c.micLevel} active={c.connected} />
            {c.sharing && <span className="text-[12px] text-err">● REC</span>}
          </div>

          {c.transcript.length > 0 && (
            <div className="border-b border-line px-4 py-2 text-[13px] leading-snug">
              {c.transcript.slice(-2).map((t, i) => (
                <p key={i}><b className={t.speaker === "agent" ? "text-indigo" : "text-[#0f766e]"}>{t.speaker === "agent" ? "Torchbearer" : "You"}:</b> {t.text}</p>
              ))}
            </div>
          )}
          {c.message && (
            <div className={`border-b px-4 py-3 ${c.message.verdict === "match" ? "border-[#bfe3cc] bg-ok-soft" : "border-[#F0D58A] bg-warn-soft"}`}>
              <div className="text-[12px] font-medium text-[#555]">{c.message.verdict === "match" ? "✓ Looks right" : "⚑ Might be different · under review"} · {c.message.time}</div>
              <p className="mt-0.5 text-[15.5px] leading-snug">{c.message.text}</p>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="mb-2 flex items-center text-[12px] font-bold uppercase tracking-[.12em] text-[#667085]">
              The expert&apos;s steps
              <span className="ml-auto font-normal normal-case tracking-normal">{learned} learned · {relearn} to relearn</span>
            </div>
            <ol className="space-y-2">
              {selected.map.steps.map((s, i) => (
                <StepRow key={s.id} n={i + 1} title={s.correction || s.title} now={c.mastery[s.id]} before={c.previous[s.id]} />
              ))}
            </ol>
            {c.finished && (
              <div className="mt-4 rounded-md border border-line p-3 text-[14px]">
                <b>Practice finished.</b> {learned} step(s) learned · {relearn} to relearn · {c.reviews.length} sent to your supervisor.
                {c.reviews.length > 0 && (
                  <div className="mt-2">
                    <Link href="/review" target="_blank" className="text-brand hover:underline">Open the supervisor review ↗</Link>
                  </div>
                )}
              </div>
            )}
            {c.error && <p className="mt-3 border-l-4 border-warn bg-warn-soft px-3 py-2 text-[12.5px]">{c.error}</p>}
          </div>

          <div className="flex items-center gap-2 border-t border-line px-4 py-3">
            {!c.sharing ? (
              <>
                <button className="h-9 rounded-sm border border-indigo bg-white px-3 text-[14px] text-indigo hover:bg-indigo-soft" onClick={() => onSelect(null)}>
                  ← Workflows
                </button>
                <button className={`${btnPrimary} flex-1`} onClick={c.start}>{c.finished ? "● Practise again" : "● Start recording"}</button>
              </>
            ) : (
              <button className={`${btnPrimary} flex-1`} onClick={c.stop}>Stop recording</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StepRow({ n, title, now, before }: { n: number; title: string; now?: StepMastery; before?: StepMastery }) {
  const tone = now === "learned" ? "border-[#bfe3cc] bg-ok-soft/60" : now === "relearn" ? "border-[#F0D58A] bg-warn-soft/60" : "border-line";
  const dot = now === "learned" ? "bg-ok" : now === "relearn" ? "bg-warn" : "bg-[#c7ccd1]";
  return (
    <li className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${tone}`}>
      <span className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-bold text-white ${dot}`}>
        {now === "learned" ? "✓" : now === "relearn" ? "↺" : n}
      </span>
      <div className="min-w-0 flex-1 text-[14px] leading-snug">
        {title}
        {now === "learned" && <div className="text-[12px] text-ok">Learned</div>}
        {now === "relearn" && <div className="text-[12px] text-[#7a5a00]">Relearn · under review by your supervisor</div>}
        {!now && before === "relearn" && <div className="text-[12px] text-[#7a5a00]">Needed relearning last time</div>}
        {!now && before === "learned" && <div className="text-[12px] text-[#667085]">Learned last time</div>}
      </div>
    </li>
  );
}
