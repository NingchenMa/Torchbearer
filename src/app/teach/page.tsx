"use client";
// Training: the work assigned to you. Pick one, and one click launches Torchbearer into an always-on-top
// floating window. You start recording and work in any browser tab; matching steps are marked Learned,
// anything that might differ is never called wrong: it's marked Relearn and goes to review (/review).
// Only workflows assigned to the signed-in person open here (the server checks).

import { createPortal } from "react-dom";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import CoachPanel from "@/features/observe/CoachPanel";
import Launcher from "@/features/observe/Launcher";
import { useCoach } from "@/features/observe/useCoach";
import { pipSupported, usePip } from "@/features/observe/usePip";
import { requestMic } from "@/lib/useVoiceAgent";
import NoAccess from "@/features/nav/NoAccess";
import { STATE_LABEL, dueText, stateOf, STATE_RANK, todayIso, type AssignmentState } from "@/lib/assignmentStatus";
import { exampleWorkflow, getTrainingWorkflow } from "@/lib/session";
import type { AssignmentView, WorkflowRecord, WorkflowSummary } from "@/lib/types";

const readId = () => {
  try {
    return new URLSearchParams(window.location.search).get("id");
  } catch {
    return null;
  }
};

export default function TeachPage() {
  return (
    <ConversationProvider>
      <Teach />
    </ConversationProvider>
  );
}

function Teach() {
  const idParam = useSyncExternalStore(() => () => {}, readId, () => null);
  // What was assigned to the signed-in person.
  const [assigned, setAssigned] = useState<AssignmentView[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/assignments?mine=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((a: AssignmentView[]) => setAssigned(a))
      .catch(() => {})
      .finally(() => setListLoaded(true));
  }, []);
  const workflows: WorkflowSummary[] = assigned.map((a) => ({ id: a.workflowId, name: a.workflowName, createdAt: a.createdAt, published: true, stepCount: a.stepCount, trainedBy: a.trainedBy }));
  const [picked, setPickedState] = useState<string | null | undefined>(undefined); // undefined = use ?id
  const selectedId = picked === undefined ? idParam : picked;
  const setPicked = (id: string | null) => {
    setPickedState(id);
    try {
      window.history.replaceState(null, "", id ? `/teach?id=${encodeURIComponent(id)}` : "/teach");
    } catch {}
  };
  const [selectedRaw, setSelectedRaw] = useState<WorkflowRecord | null>(null);
  const [denied, setDenied] = useState(false); // not assigned to this person
  useEffect(() => {
    let live = true;
    getTrainingWorkflow(selectedId).then(({ record, denied: refused }) => {
      if (!live) return;
      setSelectedRaw(record);
      setDenied(refused);
    });
    return () => {
      live = false;
    };
  }, [selectedId]);
  const selected = selectedRaw && selectedRaw.id === selectedId && selectedRaw.map.published ? selectedRaw : null; // only approved workflows teach

  const c = useCoach(selected?.map ?? exampleWorkflow().map, selected?.id ?? "none");
  const pip = usePip();
  const [micError, setMicError] = useState<string | null>(null);
  const canPip = useSyncExternalStore(() => () => {}, pipSupported, () => true);
  const bot = <CoachPanel c={c} workflows={workflows} selected={selected} onSelect={setPicked} />;
  const notReady = selectedRaw && selectedRaw.id === selectedId && !selectedRaw.map.published;
  const startArea = !selected ? (
    <p className="text-[15px] text-[#475467]">
      {notReady ? "This workflow isn't approved yet." : "Loading the workflow…"}
    </p>
  ) : c.sharing ? (
    <div className="text-[15px]">
      <div className="font-medium text-err">● Recording · {selected.name}</div>
      <p className="mt-1 text-[14px] text-[#475467]">Switch to the new hire&apos;s work. Stop recording in the floating Torchbearer when they&apos;re done.</p>
    </div>
  ) : (
    <div className="flex flex-col gap-2">
      <div className="text-[15px]">Practising: <b>{selected.name}</b></div>
      <button onClick={c.start} className="h-11 rounded-sm bg-indigo text-[16px] text-white hover:bg-indigo-dark">
        {c.finished ? "● Practise again" : "● Start recording"}
      </button>
      <p className="text-[13px] text-[#667085]">Chrome will ask what to share: choose <b>Entire screen</b>.</p>
      {c.error && <p className="rounded-sm bg-err-soft px-3 py-2 text-[13.5px] text-[#8E1B1B]">{c.error}</p>}
    </div>
  );

  // Training always starts from something assigned to you: without one picked, show your list.
  if (!selectedId) return <AssignedList assigned={assigned} loaded={listLoaded} onPick={setPicked} />;
  if (denied) return <NoAccess message="This workflow isn't assigned to you." backHref="/teach" backLabel="← Back to Training" />;

  return (
    <>
      <div className="bg-[#f3f2ff]">
        <div className="mx-auto max-w-3xl px-6 pt-4 text-[13.5px]">
          <button onClick={() => setPicked(null)} className="text-[#667085] hover:text-indigo">← Back to Training</button>
        </div>
      </div>
      <Launcher
        eyebrow={selected ? `Training · ${selected.name}` : "Training"}
        title={<>Torchbearer <span className="font-medium text-indigo">guides the new hire</span></>}
        text="Launch it and it floats on the new hire's screen. They start and work as usual. Torchbearer marks each step learned or to relearn, and anything that might differ goes to their supervisor, never called wrong."
        launched={pip.isOpen}
        canPip={canPip}
        failed={pip.failed}
        onLaunch={() => {
          // Same click: open the bot (needs the click) and ask for the mic while this page is in front.
          pip.open();
          requestMic().then(setMicError);
        }}
        micError={micError}
        panel={bot}
        startArea={startArea}
        
        demo={{ href: "/ledgerline/index.html?user=maya", label: "Demo app: open Ledgerline as the new hire" }}
      />
      {pip.container && createPortal(bot, pip.container)}
    </>
  );
}

const STATE_STYLE: Record<AssignmentState, string> = {
  none: "bg-[#eef0f3] text-[#475467]",
  progress: "bg-indigo-soft text-indigo",
  relearn: "bg-warn-soft text-[#7a5a00]",
  done: "bg-ok-soft text-ok",
  late: "bg-err-soft text-err",
};
const dayShort = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The Training tab's first screen: the work assigned to you, what needs attention first. */
function AssignedList({ assigned, loaded, onPick }: { assigned: AssignmentView[]; loaded: boolean; onPick: (id: string) => void }) {
  const today = todayIso();
  const list = [...assigned].sort((a, b) => STATE_RANK[stateOf(a, today)] - STATE_RANK[stateOf(b, today)] || (a.due ?? "9").localeCompare(b.due ?? "9"));
  return (
    <div className="min-h-full bg-[#f6f8fc]">
      <div className="mx-auto max-w-[1240px] px-4 pb-10 sm:px-7">
        <h1 className="pb-5 pt-6 text-[26px] font-medium leading-tight text-[#1f2d3d]">Training</h1>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[.12em] text-[#667085]">Assigned to you</h2>
        {!loaded ? (
          <p className="text-[15px] text-[#667085]">Loading your training…</p>
        ) : list.length === 0 ? (
          <div className="rounded-md border border-line bg-white p-8 text-center text-[15px] text-[#475467]">Nothing assigned yet. Your supervisor will give you a workflow here.</div>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((a) => {
              const st = stateOf(a, today);
              const done = st === "done";
              return (
                <li key={a.id} className={`grid items-center gap-4 rounded-md border border-line border-l-4 bg-white p-4 shadow-[0_4px_14px_rgba(16,24,40,.04)] sm:grid-cols-[minmax(0,1fr)_auto] ${st === "late" ? "border-l-err" : done ? "border-l-ok" : "border-l-indigo"}`}>
                  <div className="min-w-0">
                    <h3 className="text-[17px] font-medium text-[#1f2d3d]">{a.workflowName}</h3>
                    <p className="mb-2 mt-0.5 text-[13.5px] text-[#667085]">
                      {a.stepCount} step{a.stepCount === 1 ? "" : "s"}
                      {a.trainedBy ? ` · taught by ${a.trainedBy}` : ""}
                      {a.due && !done && (
                        <>
                          {" · "}
                          <b className={`font-medium ${st === "late" ? "text-err" : ""}`}>{dueText(a.due, today)}</b> ({dayShort(a.due)})
                        </>
                      )}
                    </p>
                    {a.note && <p className="mb-2.5 rounded-md bg-indigo-soft px-2.5 py-1.5 text-[14px] text-[#3b3399]"><b className="font-medium">From your supervisor:</b> {a.note}</p>}
                    <div className="max-w-[360px]">
                      <div className="h-1.5 overflow-hidden rounded-[3px] bg-[#eceef1]"><i className="block h-full bg-indigo" style={{ width: `${Math.min(100, Math.round((a.learned / Math.max(1, a.stepCount)) * 100))}%` }} /></div>
                      <small className="mt-1 block text-[12.5px] text-[#667085]">{a.learned}/{a.stepCount} learned{a.relearn ? ` · ${a.relearn} to relearn` : ""}</small>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-1.5 sm:items-end">
                    <span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${STATE_STYLE[st]}`}>{STATE_LABEL[st]}</span>
                    <button
                      onClick={() => onPick(a.workflowId)}
                      className={done ? "h-9 rounded-sm border border-line px-3 text-[14px] text-[#344054] hover:bg-panel" : "h-10 rounded-sm bg-indigo px-5 text-[15px] text-white hover:bg-indigo-dark"}
                    >
                      {done ? "Practise again" : a.learned || a.relearn ? (a.relearn ? `Relearn ${a.relearn} step${a.relearn === 1 ? "" : "s"}` : "Continue") : "Start"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
