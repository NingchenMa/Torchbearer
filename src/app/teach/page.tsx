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
import { ArrowRight } from "lucide-react";
import { Spotlight, StepTrail, Torch } from "@/features/ui/fx";

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
  useEffect(() => {
    listWorkflows().then((list) => setWorkflows([...list, exampleSummary()]));
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
      <button onClick={c.start} className="tb-btn-amber h-12 w-full text-[16px]">
        {c.finished ? "● Practise again" : "● Start recording"}
      </button>
      <p className="text-[13px] text-[#667085]">Chrome will ask what to share: choose <b>Entire screen</b>.</p>
      {c.error && <p className="rounded-sm bg-err-soft px-3 py-2 text-[13.5px] text-[#8E1B1B]">{c.error}</p>}
    </div>
  );

  // Training always starts from an approved workflow: without one, show the list to pick from.
  if (!selectedId) return <WorkflowPicker workflows={workflows} onPick={setPicked} />;

  return (
    <>
      <div className="bg-maroon-3">
        <div className="mx-auto max-w-6xl px-6 pt-4 text-[14px]">
          <button onClick={() => setPicked(null)} className="text-blush-2 transition-colors hover:text-amber">← Choose a different workflow</button>
        </div>
      </div>
      <Launcher
        eyebrow="Training · coach a new hire"
        title={
          selected ? (
            <>
              Train a new hire on <span className="font-serif italic text-amber">{selected.name}.</span>
            </>
          ) : (
            <>Train a new hire.</>
          )
        }
        text={`TorchBearer floats on the new hire's screen and coaches them through ${selected ? `all ${selected.map.steps.length} steps` : "each step"} the way your expert does it. Each step is marked learned or to practise again; anything that differs goes to their supervisor, never marked wrong.`}
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
function WorkflowPicker({ workflows, onPick }: { workflows: WorkflowSummary[]; onPick: (id: string) => void }) {
  const approved = workflows.filter((w) => w.published && w.id !== EXAMPLE_ID).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <div className="min-h-full bg-cream">
      <section className="tb-hero relative overflow-hidden">
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-10">
          <div className="tb-rise">
            <p className="text-[12px] font-bold uppercase tracking-[.16em] text-amber">Training · coach a new hire</p>
            <h1 className="mt-3 font-display text-[40px] leading-[1.05] text-blush sm:text-[50px]">
              Which task <span className="font-serif italic text-amber">are they learning?</span>
            </h1>
            <p className="mt-3 max-w-xl text-[16px] text-blush-2">
              {approved.length
                ? `${approved.length} approved workflow${approved.length === 1 ? "" : "s"} ready. Pick one and TorchBearer coaches the new hire through it the way your expert does it.`
                : "No workflow is approved yet."}
            </p>
          </div>
          <div className="hidden md:block">
            <Torch size={170} />
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-6xl px-6 py-8">
        {approved.length === 0 ? (
          <div className="rounded-lg border border-line bg-white p-10 text-center">
            <h2 className="font-display text-[28px] text-ink">
              Nothing to train on <span className="font-serif italic text-crimson">yet.</span>
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[16px] text-muted">An expert records a workflow in Teaching, then someone approves it in Workflows. It shows up here once it&apos;s approved.</p>
            <a href="/vault" className="tb-btn-amber mt-6 h-11">Go to Workflows</a>
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {approved.map((w, k) => (
              <Spotlight
                as="li"
                key={w.id}
                style={{ animationDelay: `${Math.min(k, 9) * 60}ms` }}
                className="tb-rise flex flex-col rounded-lg border border-line bg-white p-5 transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(58,11,20,.12)]"
              >
                <h2 className="font-display text-[22px] leading-tight text-ink [text-wrap:balance]">{w.name || "Untitled workflow"}</h2>
                <div className="mt-4">
                  <StepTrail count={w.stepCount} lit />
                  <p className="mt-2 text-[14px] text-muted">
                    {w.stepCount} step{w.stepCount === 1 ? "" : "s"}
                    {w.trainedBy ? (
                      <>
                        {" · taught by "}
                        <span className="font-serif italic text-crimson">{w.trainedBy}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="mt-auto border-t border-line pt-4">
                  <button onClick={() => onPick(w.id)} className="tb-btn-dark group/btn h-10">
                    Start training
                    <ArrowRight size={16} className="transition-transform duration-200 group-hover/btn:translate-x-1" aria-hidden="true" />
                  </button>
                </div>
              </Spotlight>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
