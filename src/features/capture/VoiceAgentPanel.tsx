"use client";
// The Apprentice in learning mode (/capture): start card → floating popup over Ledgerline.
// When to ask: after a judgment-relevant action (an attachment, a guest, a key field,
// a save) we wait until there has been no typing/pointer activity, no screen event
// and no expert speech for PAUSE_MS, the agent is silent, no document is open
// (he is reading), and MIN_GAP_MS has passed since the last question.
// Then the agent may ask one question, and the field it is about gets an indigo outline.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConversationProvider } from "@elevenlabs/react";
import { elapsed, getHistory, onActivity, resetSession, subscribe, useScreenEvents } from "@/lib/events";
import { fieldFor, sendCommand } from "@/lib/ledgerline";
import { attachDocs, attachScreenshots, saveSession, saveWorkMap } from "@/lib/session";
import { useApprenticeAgent } from "@/features/mock/useApprenticeAgent";
import { sampleWorkMap } from "@/data/sampleWorkMap";
import type { ScreenEvent } from "@/lib/types";
import { ListeningBars } from "@/features/apprentice/Popup";
import LearningPopup from "@/features/apprentice/LearningPopup";
import Dialog, { btnIndigo, btnIndigoOutline } from "@/features/apprentice/Dialog";
import StartCard from "@/features/apprentice/StartCard";
import { registerAgent, sendToAgent, STATE_LABEL, type AgentUiState } from "./agent";
import { setCapturePaused, snapshot, startScreenCapture, stopScreenCapture } from "./screenCapture";
import EventLog from "./EventLog";

const PAUSE_MS = 3500;
const MIN_GAP_MS = 20000;
const IDLE_MS = 12000; // no work, no speech, nothing pending: ask what happened
const EXPERT = "you"; // the expert is the person using Capture

// Actions worth a "why" question. Plain amount typing is not: the screen already answers it.
const JUDGMENT_FIELDS = new Set(["type_of_meal", "location", "business_purpose"]);
const JUDGMENT_TYPES = new Set(["guest_added", "guest_removed", "attachment_added", "attachment_removed", "project_selected", "expense_saved", "validation_failed"]);
const isNotable = (e: ScreenEvent) =>
  e.source === "dom" && (JUDGMENT_TYPES.has(e.type) || (e.type === "field_changed" && JUDGMENT_FIELDS.has(e.field ?? "")));

export type CaptureStage = "closed" | "intro" | "live";

interface Props {
  stage: CaptureStage;
  setStage: (s: CaptureStage) => void;
}

export default function VoiceAgentPanel(props: Props) {
  return (
    <ConversationProvider>
      <Interviewer {...props} />
    </ConversationProvider>
  );
}

function Interviewer({ stage, setStage }: Props) {
  const router = useRouter();
  const agent = useApprenticeAgent("interviewer");
  const [offRecord, setOffRecord] = useState(false);
  const [phase, setPhase] = useState<"task" | "debrief" | "building">("task");
  const [waiting, setWaiting] = useState<string | null>(null); // why the agent is holding a question
  const [sharing, setSharing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  // Transcript / pause-detector panel only with ?details in the URL (for the team, hidden from the expert).
  // Safe for hydration: the popup isn't rendered until the Apprentice button is clicked.
  const [detailsAllowed] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("details"));
  const [task, setTask] = useState("Meal expense report");
  const seenEvents = useScreenEvents();

  const agentRef = useRef(agent);
  const offRef = useRef(false);
  const pending = useRef<ScreenEvent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastActivity = useRef(0);
  const lastQuestion = useRef(0);
  const reading = useRef(false);
  const highlighted = useRef(false);
  const offRecordEvents = useRef(new Set<ScreenEvent>());
  const shots = useRef<Record<string, string>>({});
  const offRanges = useRef<{ from: string; to: string }[]>([]);
  const [debriefFrom, setDebriefFrom] = useState(0); // transcript index where the debrief starts

  useEffect(() => {
    agentRef.current = agent;
    offRef.current = offRecord;
  });

  useEffect(() => {
    if (!agent.connected) return;
    return registerAgent({
      context: (t) => agentRef.current.sendContextualUpdate(t),
      message: (t) => agentRef.current.sendUserMessage(t),
    });
  }, [agent.connected]);

  // The question's highlight goes away once the expert answers.
  const lastLine = agent.transcript[agent.transcript.length - 1];
  useEffect(() => {
    if (lastLine?.speaker === "expert" && highlighted.current) {
      sendCommand({ cmd: "clear_highlight" });
      highlighted.current = false;
    }
  }, [lastLine]);

  useEffect(() => {
    if (!agent.connected || phase !== "task") return;

    function tryAsk() {
      const a = agentRef.current;
      const now = Date.now();
      const e = pending.current;
      if (!e || offRef.current) return setWaiting(null);
      if (a.isSpeaking || reading.current || now - a.lastUserSpeech.current < 2500 || now - lastActivity.current < PAUSE_MS) {
        setWaiting(reading.current ? "he is reading a document" : a.isSpeaking ? "agent is speaking" : "he is working or talking");
        timer.current = setTimeout(tryAsk, 1000);
        return;
      }
      const wait = MIN_GAP_MS - (now - lastQuestion.current);
      if (wait > 0) {
        setWaiting(`question budget: next in ${Math.ceil(wait / 1000)}s`);
        timer.current = setTimeout(tryAsk, Math.min(wait, 1000));
        return;
      }
      // Earlier saved expenses let the agent spot "same kind of expense, different steps".
      const earlier = getHistory()
        .filter((h) => h.type === "expense_saved" && h !== e)
        .slice(-3)
        .map((h) => `- ${h.description}`)
        .join("\n");
      sendToAgent(
        `[PAUSE] The expert paused right after: ${e.description}.${earlier ? `\nEarlier items they saved:\n${earlier}` : ""}\nIf they handled this one differently from a similar earlier one, ask what the difference is. Otherwise ask one short question about why, a limit, or when they would stop and ask. If you are not sure what they did, say so and ask.`,
        { respond: true },
      );
      const field = fieldFor(e);
      if (field) {
        sendCommand({ cmd: "highlight", fields: [field] });
        highlighted.current = true;
      }
      lastQuestion.current = now;
      pending.current = null;
      setWaiting(null);
    }

    const unsubscribe = subscribe((e) => {
      if (offRef.current) {
        offRecordEvents.current.add(e);
        return;
      }
      sendToAgent(`[SCREEN] ${e.time} ${e.description}`);
      // A screen change is activity too (vision lags 2–3 s behind, so only Ledgerline's own events count).
      if (e.source === "dom") lastActivity.current = Date.now();
      if (e.type === "document_opened") reading.current = true;
      if (e.type === "document_closed") reading.current = false;
      // Screen moment: grab the frame a beat later so the change is visible on it.
      setTimeout(() => {
        const shot = snapshot();
        if (shot && !shots.current[e.time]) shots.current[e.time] = shot;
      }, 600);
      if (isNotable(e)) {
        pending.current = e;
        setWaiting("waiting for a pause");
        clearTimeout(timer.current);
        timer.current = setTimeout(tryAsk, PAUSE_MS);
      }
    });

    lastActivity.current = Date.now(); // the clock starts when the session does
    // A long silent stop with nothing pending is often a judgment call: ask what happened.
    const idle = setInterval(() => {
      const a = agentRef.current;
      const now = Date.now();
      if (offRef.current || pending.current || reading.current || a.isSpeaking) return;
      const quietSince = Math.max(lastActivity.current, a.lastUserSpeech.current, lastQuestion.current);
      if (!quietSince || now - quietSince < IDLE_MS) return;
      const last = getHistory().filter((h) => h.source === "dom").pop();
      sendToAgent(
        `[IDLE] The expert has stopped working and gone quiet for ${Math.round((now - quietSince) / 1000)} seconds${last ? `, right after: ${last.description}` : ""}. Ask one short question about what happened or why they stopped.`,
        { respond: true },
      );
      lastQuestion.current = now;
    }, 2000);

    function onKey() {
      lastActivity.current = Date.now();
      agentRef.current.sendUserActivity();
    }
    window.addEventListener("keydown", onKey);
    const offActivity = onActivity(onKey); // typing / pointer / scroll inside Ledgerline
    return () => {
      unsubscribe();
      clearInterval(idle);
      offActivity();
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer.current);
    };
  }, [agent.connected, phase]);

  useEffect(() => {
    saveSession({ events: recordedEvents(), transcript: agent.transcript });
  });

  function recordedEvents() {
    return getHistory().filter((e) => !offRecordEvents.current.has(e));
  }

  async function start(chosenTask: string) {
    setTask(chosenTask);
    setStage("live");
    setStarting(true);
    resetSession();
    shots.current = {};
    offRanges.current = [];
    try {
      await startScreenCapture(() => setSharing(false));
      setSharing(true);
    } catch {
      // Sharing declined: the agent still gets Ledgerline's events, just no vision/screenshots.
    }
    await agent.start();
    setStarting(false);
  }

  function stop() {
    agent.endSession();
    stopScreenCapture();
    setSharing(false);
  }

  function toggleOffRecord() {
    const next = !offRecord;
    setOffRecord(next);
    agent.setMuted(next);
    setCapturePaused(next);
    // Remember the window so the Work Map can show it as a gap.
    if (next) offRanges.current.push({ from: elapsed(), to: "" });
    else if (offRanges.current.length) offRanges.current[offRanges.current.length - 1].to = elapsed();
    sendToAgent(next ? "[SCREEN] The expert went off the record." : "[SCREEN] The expert is back on the record.");
  }

  function endTask() {
    setPhase("debrief");
    setDebriefFrom(agent.transcript.length);
    sendCommand({ cmd: "clear_highlight" });
    sendToAgent(
      `[DEBRIEF] The expert is done with the task (${task}). Everything that happened on screen:\n${recordedEvents()
        .map((e) => `${e.time} ${e.description}`)
        .join("\n")}\nStart the debrief now.`,
      { respond: true },
    );
  }

  function offRecordRanges() {
    return offRanges.current.map((r) => ({ from: r.from, to: r.to || elapsed() }));
  }

  async function buildMap() {
    setPhase("building");
    setBuildError(null);
    stop();
    const events = recordedEvents();
    try {
      const res = await fetch("/api/workmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events, transcript: agent.transcript }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json();
      if (!res.ok || !data.steps?.length) throw new Error(data.error || "The Work Map came back empty.");
      saveWorkMap({ ...attachDocs(attachScreenshots(data, shots.current), events), offRecord: offRecordRanges(), published: false });
      router.push("/map");
    } catch (e) {
      // Safety net for the live demo: retry, or fall back to the prepared map.
      setBuildError(e instanceof Error && e.name === "TimeoutError" ? "Building the Work Map took too long." : String(e instanceof Error ? e.message : e).slice(0, 200));
      setPhase("debrief");
    }
  }

  function loadPreparedMap() {
    // Prepared map from the rehearsal (sample), with this session's screen moments where they fit.
    saveWorkMap({ ...attachScreenshots(sampleWorkMap, shots.current), offRecord: offRecordRanges(), published: false });
    router.push("/map");
  }

  if (stage === "closed") return null;

  if (stage === "intro") {
    return (
      <StartCard
        title="Apprentice"
        subtitle="Show it a task. It learns why."
        modeLabel="LEARNING MODE"
        taskLabel="Task you'll show"
        tasks={["Meal expense report", "Client-travel expense report"]}
        expectations={[
          "Watches <b>this Ledgerline window only</b>, nothing else on your screen.",
          "Listens while you work and asks short questions out loud whenever something isn't clear.",
          "You can go <b>off the record</b> any time.",
          "Names and card numbers are hidden automatically.",
          "You review everything it learned before anyone else sees it.",
        ]}
        startLabel="Start learning"
        onStart={start}
        onClose={() => setStage("closed")}
      />
    );
  }

  const ui: AgentUiState =
    phase === "building" ? "building"
    : starting || agent.status === "connecting" ? "connecting"
    : !agent.connected ? "not_started"
    : offRecord ? "off_record"
    : agent.isSpeaking ? "asking"
    : phase === "debrief" ? "debrief"
    : waiting && waiting !== "waiting for a pause" ? "quiet"
    : "listening";

  const lastAgent = [...agent.transcript].reverse().find((t) => t.speaker === "agent");
  // Folds to a small bar while the expert works; opens while the agent speaks and keeps its
  // question visible until the expert answers or does the next thing on screen.
  const lastEvent = seenEvents[seenEvents.length - 1];
  const questionShowing = lastLine?.speaker === "agent" && !(lastEvent && lastEvent.time > lastLine.time);
  const autoFold = phase === "task" && agent.connected && !agent.isSpeaking && !questionShowing && !offRecord && !buildError && !agent.error;
  const statusLabel = ui === "listening" || ui === "debrief" ? "Listening…" : STATE_LABEL[ui];

  // ---------- Review mode: debrief questions, then the teach-back ----------
  if (phase !== "task") {
    const lines = agent.transcript.slice(debriefFrom);
    const tbIndex = lines.findIndex((l) => l.speaker === "agent" && /^so[:,]|did i get that right/i.test(l.text));
    const qa: { q: string; a?: string }[] = [];
    (tbIndex >= 0 ? lines.slice(0, tbIndex) : lines).forEach((l) => {
      if (l.speaker === "agent" && l.text.includes("?")) qa.push({ q: l.text });
      else if (l.speaker === "expert" && qa.length && !qa[qa.length - 1].a) qa[qa.length - 1].a = l.text;
    });
    const answered = qa.filter((x) => x.a).length;
    const teachBack = tbIndex >= 0 ? lines[tbIndex].text : null;
    const reply = tbIndex >= 0 ? lines.slice(tbIndex + 1).filter((l) => l.speaker === "expert").pop() : undefined;
    const sentences = teachBack
      ? teachBack.replace(/^so[:,]\s*/i, "").split(/(?<=[.!])\s+/).filter((x) => x && !/did i get that right/i.test(x))
      : [];
    const errorBox = buildError && (
      <div className="mx-5 mb-4 border-l-4 border-warn bg-warn-soft px-3 py-2 text-[14px]">
        <b>Couldn&apos;t build the Work Map.</b> {buildError}
        <div className="mt-2 flex gap-2">
          <button className={btnIndigoOutline} onClick={buildMap}>Try again</button>
          <button className={btnIndigo} onClick={loadPreparedMap}>Use prepared Work Map</button>
        </div>
      </div>
    );

    if (phase === "building") {
      return (
        <Dialog title="Work Map" subtitle="Writing up what I learned" modeLabel="REVIEW MODE" width={560}>
          <p className="flex items-center gap-3 px-5 py-6 text-[16px]"><ListeningBars active /> Merging your answers, the screen moments and the teach-back…</p>
        </Dialog>
      );
    }

    if (teachBack) {
      return (
        <Dialog
          title="Teach-back"
          subtitle="Here's how I understand it"
          modeLabel="REVIEW MODE"
          footer={
            <>
              <span className="flex-1 text-[13px] text-muted">Explained back in under a minute</span>
              <button className={btnIndigoOutline} disabled={!agent.connected} onClick={() => sendToAgent("[CORRECT] The expert wants to correct a step.", { respond: true })}>
                Correct a step
              </button>
              <button
                className={btnIndigo}
                onClick={() => {
                  sendToAgent("[SCREEN] The expert confirmed the teach-back: yes, that's how it works.");
                  buildMap();
                }}
              >
                Yes, that&apos;s how it works
              </button>
            </>
          }
        >
          <ol className="list-decimal space-y-1.5 px-5 pb-2 pl-10 pt-4 text-[16px] leading-snug">
            {sentences.map((x) => <li key={x}>{x}</li>)}
          </ol>
          <p className="px-5 pb-3 text-[16px]">Did I get that right?</p>
          {reply && (
            <div className="border-y border-line bg-panel-2 px-5 py-2 text-right text-[14.5px]">
              <b className="text-[#0f766e]">You</b> “{reply.text}”
            </div>
          )}
          {errorBox}
        </Dialog>
      );
    }

    return (
      <Dialog
        title="Debrief"
        subtitle="A few questions before I write this up"
        modeLabel="REVIEW MODE"
        footer={
          <>
            <span className="flex flex-1 items-center gap-2 text-[14px] text-indigo">
              {agent.connected ? <><ListeningBars active /> {agent.isSpeaking ? "Asking…" : "Listening…"}</> : "Voice not connected"}
            </span>
            {agent.connected ? (
              <>
                <button className={btnIndigoOutline} onClick={toggleOffRecord}>{offRecord ? "Back on record" : "Off the record"}</button>
                <button className={btnIndigoOutline} onClick={() => sendToAgent("[SKIP] The expert wants to skip this question.", { respond: true })}>Skip question</button>
              </>
            ) : (
              <button className={btnIndigo} onClick={buildMap}>Build Work Map</button>
            )}
          </>
        }
      >
        <div className="border-b border-line px-5 pb-2 pt-3">
          <div className="flex text-[14.5px]">
            <span>Things I couldn&apos;t tell from your screen</span>
            <span className="ml-auto">{answered} answered</span>
          </div>
          <div className="mt-1.5 h-1.5 bg-[#e5e7eb]">
            <div className="h-full bg-indigo transition-all" style={{ width: `${qa.length ? (answered / qa.length) * 100 : 0}%` }} />
          </div>
        </div>
        {qa.length === 0 && <p className="px-5 py-5 text-[15px] text-[#444]">{agent.connected ? "Starting the debrief…" : "Voice isn't connected. You can still build the Work Map from the screen events."}</p>}
        {qa.map((x, i) => (
          <div key={i} className={`flex gap-3 border-b border-[#eee] px-5 py-3 ${x.a ? "" : "bg-indigo-soft"}`}>
            <span className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-[12px] font-bold text-white ${x.a ? "bg-ok" : "bg-indigo"}`}>{i + 1}</span>
            <div className="flex-1 text-[16px] leading-snug">
              {x.q}
              {x.a && <div className="mt-0.5 text-[14.5px] text-[#0f766e]">You: “{x.a}”</div>}
            </div>
            <span className="text-[13px] text-muted">{x.a ? "✓ answered" : "asking now…"}</span>
          </div>
        ))}
        {errorBox}
      </Dialog>
    );
  }

  return (
    <LearningPopup
      expert={EXPERT}
      review={false}
      taskPhase
      connected={agent.connected}
      offRecord={offRecord}
      status={statusLabel}
      listening={ui === "listening"}
      question={lastAgent ? { time: lastAgent.time, text: lastAgent.text } : undefined}
      idleText={ui === "connecting" ? "Connecting…" : "Work as usual and explain as you go. I'll ask whenever something isn't clear."}
      autoFold={autoFold}
      // Also offered without a live agent (e.g. voice credits ran out): events alone still build a map.
      showBuild={!agent.connected && seenEvents.length > 0 && !starting}
      buildError={buildError}
      agentError={agent.error}
      onToggleOffRecord={toggleOffRecord}
      onEndTask={endTask}
      onBuildMap={buildMap}
      onLoadPreparedMap={loadPreparedMap}
      details={
        detailsAllowed && (
          <>
            <button onClick={() => setDetails((d) => !d)} className="w-full border-t border-line bg-panel-2 px-4 py-1.5 text-left text-[12.5px] text-muted hover:text-indigo">
              {details ? "▾ Hide details" : "▸ Details: transcript, screen events, pause detector"}
            </button>
            {details && (
              <div className="flex h-72 flex-col gap-2 border-t border-line bg-panel p-2">
                <div className="text-[12px] text-[#444]">
                  Pause detector: <b>{waiting ?? "idle"}</b> · Screen: <b>{sharing ? (offRecord ? "paused" : "shared, vision on") : "app events only"}</b>
                </div>
                <ol className="max-h-28 min-h-0 space-y-1 overflow-y-auto rounded-sm border border-line bg-white p-2 text-[12.5px]">
                  {agent.transcript.length === 0 && <li className="text-muted">No conversation yet.</li>}
                  {agent.transcript.map((t, i) => (
                    <li key={i}>
                      <b className={t.speaker === "agent" ? "text-indigo" : ""}>{t.speaker === "agent" ? "Apprentice" : "You"}:</b> {t.text}
                    </li>
                  ))}
                </ol>
                <EventLog />
              </div>
            )}
          </>
        )
      }
    />
  );
}
