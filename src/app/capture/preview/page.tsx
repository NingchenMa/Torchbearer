"use client";
// Design preview (mock data only): every state of Torchbearer popup over Ledgerline,
// without a voice agent, mic or API keys. Matches docs/design/. Not part of the demo flow.

import { useState } from "react";
import LedgerlineFrame from "@/features/erp/LedgerlineFrame";
import StartCard from "@/features/apprentice/StartCard";
import LearningPopup from "@/features/apprentice/LearningPopup";

const STATES = [
  { id: "start", label: "1 · Start learning" },
  { id: "listening", label: "2 · Listening" },
  { id: "question", label: "3 · Asks why at a pause" },
  { id: "off", label: "4 · Off the record" },
] as const;
type State = (typeof STATES)[number]["id"];

const noop = () => {};

export default function DesignPreview() {
  const [state, setState] = useState<State>("start");

  const popup = {
    expert: "you",
    review: false,
    taskPhase: true,
    connected: true,
    status: "Listening…",
    listening: true,
    idleText: "Work as usual and explain as you go. I'll ask whenever something isn't clear.",
    showBuild: false,
    onToggleOffRecord: () => setState(state === "off" ? "question" : "off"),
    onEndTask: noop,
    onBuildMap: noop,
    onLoadPreparedMap: noop,
  };

  return (
    <div className="h-full">
      <LedgerlineFrame query="user=paul" mode="capture" apprenticeOn={state !== "start"} onApprenticeClick={() => setState("start")} />

      <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-sm border border-line bg-white p-1 text-[13px] shadow-[0_4px_16px_rgba(0,0,0,.15)]">
        <span className="px-2 text-muted">Design preview · Learning mode</span>
        {STATES.map((s) => (
          <button
            key={s.id}
            onClick={() => setState(s.id)}
            className={`h-8 rounded-sm px-3 ${state === s.id ? "bg-indigo text-white" : "text-indigo hover:bg-indigo-soft"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {state === "start" && (
        <StartCard
          title="Torchbearer"
          subtitle="Show it a task. It learns why."
          modeLabel="LEARNING MODE"
          taskLabel="Task you'll show"
          tasks={["Meal expense report"]}
          expectations={[
            "Watches <b>this Ledgerline window only</b>, nothing else on your screen.",
            "Listens while you work and asks short questions out loud whenever something isn't clear.",
            "You can go <b>off the record</b> any time.",
            "Names and card numbers are hidden automatically.",
            "You review everything it learned before anyone else sees it.",
          ]}
          startLabel="Start learning"
          onStart={() => setState("listening")}
          onClose={noop}
        />
      )}
      {state === "listening" && <LearningPopup key="listening" {...popup} offRecord={false} autoFold />}
      {state === "question" && (
        <LearningPopup
          key="question"
          {...popup}
          offRecord={false}
          autoFold={false}
          question={{ time: "00:52", text: "You added a screenshot on this one that wasn't on the first one. What's that for?" }}
        />
      )}
      {state === "off" && <LearningPopup key="off" {...popup} offRecord autoFold={false} listening={false} />}
    </div>
  );
}
