"use client";
// Module 3 · Teaching: one click launches Torchbearer into an always-on-top floating window.
// It first asks which saved, approved workflow the new hire wants to practise. They start recording and
// works in any browser tab; matching steps are marked Learned, anything that might differ is never
// called wrong: it's marked Relearn and goes under review for the supervisor (/review).

import { createPortal } from "react-dom";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import CoachPanel from "@/features/observe/CoachPanel";
import Launcher from "@/features/observe/Launcher";
import { useCoach } from "@/features/observe/useCoach";
import { pipSupported, usePip } from "@/features/observe/usePip";
import { requestMic } from "@/lib/useVoiceAgent";
import { EXAMPLE_ID, exampleSummary, exampleWorkflow, getWorkflow, listWorkflows } from "@/lib/session";
import type { WorkflowRecord, WorkflowSummary } from "@/lib/types";

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
  // From the database: every trained workflow, plus the prepared example.
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([exampleSummary()]);
  const [listLoaded, setListLoaded] = useState(false);
  useEffect(() => {
    listWorkflows().then((list) => {
      setWorkflows([...list, exampleSummary()]);
      setListLoaded(true);
    });
  }, []);
  const [picked, setPickedState] = useState<string | null | undefined>(undefined); // undefined = use ?id
  const selectedId = picked === undefined ? idParam : picked;
  const setPicked = (id: string | null) => {
    setPickedState(id);
    try {
      window.history.replaceState(null, "", id ? `/teach?id=${encodeURIComponent(id)}` : "/teach");
    } catch {}
  };
  const [selectedRaw, setSelectedRaw] = useState<WorkflowRecord | null>(null);
  useEffect(() => {
    let live = true;
    getWorkflow(selectedId).then((w) => live && setSelectedRaw(w));
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
      {notReady ? "This workflow isn't approved yet. Approve it in Workflows first." : "Loading the workflow…"}
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

  // Training always starts from an approved workflow: without one, show the list to pick from.
  if (!selectedId) return <WorkflowPicker workflows={workflows} loaded={listLoaded} onPick={setPicked} />;

  return (
    <>
      <div className="bg-[#f3f2ff]">
        <div className="mx-auto max-w-3xl px-6 pt-4 text-[13.5px]">
          <button onClick={() => setPicked(null)} className="text-[#667085] hover:text-indigo">← Choose a different workflow</button>
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

/** The Training tab's first screen: approved workflows only, newest first. */
function WorkflowPicker({ workflows, loaded, onPick }: { workflows: WorkflowSummary[]; loaded: boolean; onPick: (id: string) => void }) {
  const approved = workflows.filter((w) => w.published && w.id !== EXAMPLE_ID).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <div className="min-h-full bg-[linear-gradient(180deg,#f3f2ff_0%,#ffffff_45%)]">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="text-[30px] font-light tracking-tight text-[#1f2d3d]">Training</h1>
        <p className="mt-1 text-[15px] text-[#475467]">Pick an approved workflow to train a new hire on. TorchBearer coaches them the way your expert does it.</p>
        {!loaded ? (
          <p className="mt-8 text-[15px] text-[#667085]">Loading your workflows…</p>
        ) : approved.length === 0 ? (
          <div className="mt-8 rounded-md border border-dashed border-[#c9c6f5] bg-white p-8 text-center">
            <h2 className="text-[18px] font-medium text-[#1f2d3d]">No approved workflows yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] text-[#475467]">An expert records a workflow in Teaching, then someone approves it in Workflows. It shows up here once it&apos;s approved.</p>
            <a href="/vault" className="mt-5 inline-flex h-10 items-center rounded-sm bg-indigo px-4 text-[15px] text-white hover:bg-indigo-dark">Go to Workflows</a>
          </div>
        ) : (
          <ul className="mt-6 grid gap-3 md:grid-cols-2">
            {approved.map((w) => (
              <li key={w.id} className="flex flex-col rounded-md border border-line bg-white p-4 shadow-[0_4px_14px_rgba(16,24,40,.04)]">
                <h2 className="text-[16.5px] font-medium leading-snug text-[#1f2d3d]">{w.name || "Untitled workflow"}</h2>
                <p className="mt-1 text-[13.5px] text-[#667085]">
                  {w.stepCount} step{w.stepCount === 1 ? "" : "s"}
                  {w.trainedBy ? ` · taught by ${w.trainedBy}` : ""}
                </p>
                <button
                  onClick={() => onPick(w.id)}
                  className="mt-4 inline-flex h-9 w-fit items-center rounded-sm bg-indigo px-3 text-[14px] text-white hover:bg-indigo-dark"
                >
                  Start training
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
