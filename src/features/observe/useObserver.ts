"use client";
// The screenshot-only Torchbearer loop:
//   watch    every second a frame; changed frames go to /api/observe with the workflow so far
//   write    the LLM returns what happened + the updated workflow (+ maybe a question)
//   ask      a question is spoken only at a pause: screen still ≥ 3 s, nobody talking,
//            ≥ 15 s since the last question
//   learn    the spoken answer is paired with its question and written into the workflow
//            right away by a fast text-only call (why / rule on the right step)
// Must be used inside <ConversationProvider>.

import { useEffect, useMemo, useRef, useState } from "react";
import { elapsed, resetSession } from "@/lib/events";
import { saveWorkflow } from "@/lib/session";
import { requestMic, useVoiceAgent } from "@/lib/useVoiceAgent";
import type { ObservedStep, ObserveQA, TranscriptLine } from "@/lib/types";
import { ScreenWatcher, friendly, shareErrorText, type Frame } from "./screenWatcher";

const PAUSE_MS = 3000;
const MIN_GAP_MS = 15000;
const IDLE_MS = 12000; // screen still, nobody talking, nothing to ask: ask what happened

export type ObserverStatus = "idle" | "connecting" | "watching" | "reading" | "asking" | "off_record" | "debrief" | "building";

/** Pair each question the agent asked with the expert's spoken answer (follow-up lines are appended). */
function pairAnswers(transcript: TranscriptLine[]): ObserveQA[] {
  const pairs: ObserveQA[] = [];
  let open: string | null = null;
  let answering = false;
  for (const line of transcript) {
    if (line.speaker === "agent") {
      answering = false;
      if (line.text.includes("?")) open = line.text;
    } else if (open) {
      pairs.push({ q: open, a: line.text });
      open = null;
      answering = true;
    } else if (answering && pairs.length) {
      pairs[pairs.length - 1].a += ` ${line.text}`;
    }
  }
  return pairs;
}

export function useObserver(onWorkMapReady: (workflowId: string) => void) {
  const agent = useVoiceAgent("interviewer");
  const watcher = useRef(new ScreenWatcher());
  const [sharing, setSharing] = useState(false);
  const [workflow, setWorkflow] = useState<ObservedStep[]>([]);
  const [reading, setReading] = useState(false);
  const [offRecord, setOffRecord] = useState(false);
  const [phase, setPhase] = useState<"task" | "debrief" | "building">("task");
  const [error, setError] = useState<string | null>(null);

  const qa = useMemo(() => pairAnswers(agent.transcript), [agent.transcript]);

  // Latest values for the 2-second loop.
  const live = useRef({ agent, workflow, qa, offRecord, phase });
  useEffect(() => {
    live.current = { agent, workflow, qa, offRecord, phase };
  });
  const lastSent = useRef<string | null>(null);
  const inFlight = useRef(false);
  const missed = useRef(false); // the screen changed while a call was running
  const integrated = useRef(0); // how many Q&A pairs the LLM has already seen
  const asked = useRef<string[]>([]);
  const pending = useRef<string | null>(null);
  const lastQuestionAt = useRef(0);
  const idleAsked = useRef(0); // when we last checked in on a silent stop
  const shots = useRef<Record<string, string>>({});
  const offRanges = useRef<{ from: string; to: string }[]>([]);
  const actionsRef = useRef<{ time: string; text: string }[]>([]);
  const stepShots = useRef<Record<string, string>>({}); // screenshot kept for each observed step
  const workflowName = useRef("Untitled workflow");

  // Write each new spoken answer into the workflow right away (fast, text-only call).
  useEffect(() => {
    if (qa.length <= integrated.current) return;
    const count = qa.length;
    const ctrl = new AbortController();
    fetch("/api/observe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "integrate", workflow: live.current.workflow, qa, asked: asked.current, now: elapsed() }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.workflow) return;
        integrated.current = count;
        setWorkflow(data.workflow);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [qa]);

  async function onFrame(f: Frame) {
    const l = live.current;
    // Only the task itself is recorded: nothing while off the record, and nothing after Stop
    // recording (during the debrief the expert often switches to other apps).
    if (l.offRecord || l.phase !== "task") return;
    // A change that lands while a call is running must not be lost: send it with the next frame.
    if (inFlight.current) {
      if (f.changed) missed.current = true;
      return;
    }
    if (!f.changed && !missed.current) return;
    missed.current = false;
    inFlight.current = true;
    setReading(true);
    const now = elapsed();
    try {
      const res = await fetch("/api/observe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: workflowName.current, frame: f.dataUrl, previous: lastSent.current, workflow: l.workflow, actions: actionsRef.current, qa: l.qa, asked: asked.current, now }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      lastSent.current = f.dataUrl;
      for (const step of data.workflow as ObservedStep[]) {
        if (!stepShots.current[step.id]) stepShots.current[step.id] = watcher.current.grab(640) ?? "";
      }
      setWorkflow(data.workflow);
      setError(null);
      if (data.action) {
        actionsRef.current = [...actionsRef.current, { time: now, text: data.action }];
        if (l.agent.connected) l.agent.sendContextualUpdate(`[SCREEN] ${now} ${data.action}`);
        const shot = watcher.current.grab(720);
        if (shot) shots.current[now] = shot;
      }
      if (data.question && l.phase === "task") pending.current = data.question;
    } catch (e) {
      missed.current = true; // try this screen again with the next frame
      setError(friendly(e));
    } finally {
      inFlight.current = false;
      setReading(false);
    }
  }

  // Ask the pending question only at a natural pause.
  useEffect(() => {
    if (!agent.connected || phase !== "task") return;
    const t = setInterval(() => {
      const l = live.current;
      const q = pending.current;
      const now = Date.now();
      if (!q || l.offRecord || l.agent.isSpeaking) return;
      if (now - watcher.current.lastChange < PAUSE_MS) return; // still working on screen
      if (now - l.agent.lastUserSpeech.current < 2500) return; // still talking
      if (now - lastQuestionAt.current < MIN_GAP_MS) return; // question budget
      l.agent.sendUserMessage(`[ASK] ${q}`);
      asked.current.push(q);
      pending.current = null;
      lastQuestionAt.current = now;
    }, 1000);
    return () => clearInterval(t);
  }, [agent.connected, phase]);

  // A long silent stop is often a judgment call: ask what happened or why they stopped.
  useEffect(() => {
    if (!agent.connected || phase !== "task") return;
    lastQuestionAt.current = Math.max(lastQuestionAt.current, Date.now());
    const t = setInterval(() => {
      const l = live.current;
      const now = Date.now();
      if (pending.current || l.offRecord || l.agent.isSpeaking) return;
      if (idleAsked.current > Math.max(watcher.current.lastChange, l.agent.lastUserSpeech.current)) return; // already asked during this stop
      const quietSince = Math.max(watcher.current.lastChange, l.agent.lastUserSpeech.current, lastQuestionAt.current);
      if (now - quietSince < IDLE_MS || now - lastQuestionAt.current < MIN_GAP_MS) return;
      const last = actionsRef.current[actionsRef.current.length - 1];
      l.agent.sendUserMessage(
        `[IDLE] The expert has stopped and gone quiet for ${Math.round((now - quietSince) / 1000)} seconds${last ? `, right after: ${last.text}` : ""}. Ask one short question about what happened or why they stopped.`,
      );
      lastQuestionAt.current = now;
      idleAsked.current = now;
    }, 2000);
    return () => clearInterval(t);
  }, [agent.connected, phase]);

  async function start(name?: string) {
    workflowName.current = name?.trim() || `Workflow ${new Date().toLocaleString()}`;
    setError(null);
    resetSession();
    shots.current = {};
    stepShots.current = {};
    offRanges.current = [];
    asked.current = [];
    integrated.current = 0;
    lastSent.current = null;
    actionsRef.current = [];
    setWorkflow([]);
    setPhase("task");
    // Ask for screen and microphone in this same click, while this page is in front. Browsers
    // without the floating window (Firefox, Safari) otherwise show the mic prompt only after the
    // user has switched to their work, so it sits unanswered and the voice never starts.
    const sharing = watcher.current.start((f) => onFrame(f), () => setSharing(false));
    const mic = requestMic();
    try {
      await sharing;
      setSharing(true);
    } catch (e) {
      setError(shareErrorText(e));
      return;
    }
    const micError = await mic;
    if (micError) {
      setError(micError);
      return;
    }
    agent.start();
  }

  function toggleOffRecord() {
    const next = !offRecord;
    setOffRecord(next);
    watcher.current.paused = next;
    agent.setMuted(next);
    if (next) offRanges.current.push({ from: elapsed(), to: "" });
    else if (offRanges.current.length) offRanges.current[offRanges.current.length - 1].to = elapsed();
    if (agent.connected) agent.sendContextualUpdate(next ? "[SCREEN] The expert went off the record." : "[SCREEN] The expert is back on the record.");
  }

  function endTask() {
    setPhase("debrief");
    watcher.current.paused = true; // stop reading the screen; sharing stays on until Send to Mapping
    pending.current = null;
    if (!agent.connected) return; // no voice (e.g. out of credits): go straight to building the map
    agent.sendUserMessage(
      `[DEBRIEF] The expert is done. The workflow I wrote from the screen:\n${workflow
        .map((s, i) => `${i + 1}. ${s.title}${s.why ? ` (why: ${s.why})` : ""}${s.rule ? ` (rule: ${s.rule})` : ""}`)
        .join("\n")}\nAsk about what is still unclear, then explain it back.`,
    );
  }

  /** Stop recording and hand everything the AI observed to Mapping, on hold until the expert approves. */
  async function sendToMapping() {
    setPhase("building");
    agent.endSession();
    watcher.current.stop();
    setSharing(false);
    const steps = workflow.map((o, i) => ({
      id: o.id || `s${i + 1}`,
      order: i + 1,
      title: o.title,
      time: o.time,
      screenshot: stepShots.current[o.id] || undefined,
      decision: o.detail,
      reason: o.why ?? "",
      expertQuote: o.why ?? "",
      guardrails: o.rule ? [o.rule] : [],
    }));
    const offRecordRanges = offRanges.current.map((r) => ({ from: r.from, to: r.to || elapsed() }));
    const id = `wf_${Date.now().toString(36)}`;
    const saved = await saveWorkflow({
      id,
      name: workflowName.current,
      createdAt: new Date().toISOString(),
      map: { task: workflowName.current, steps, gaps: [], confirmed: qa.length > 0, offRecord: offRecordRanges, published: false },
    });
    if (!saved) {
      setError("Couldn't save the workflow to the database. Check the connection and try again.");
      setPhase("debrief");
      return;
    }
    onWorkMapReady(id);
  }

  const status: ObserverStatus =
    phase === "building" ? "building"
    : offRecord ? "off_record"
    : !sharing ? "idle"
    : agent.status === "connecting" ? "connecting"
    : agent.isSpeaking ? "asking"
    : phase === "debrief" ? "debrief"
    : reading ? "reading"
    : "watching";

  return {
    status,
    phase,
    sharing,
    connected: agent.connected,
    micLevel: agent.getInputVolume,
    workflow,
    qa,
    transcript: agent.transcript,
    error: error ?? agent.error,
    start,
    toggleOffRecord,
    offRecord,
    endTask,
    sendToMapping,
  };
}

export type Observer = ReturnType<typeof useObserver>;
