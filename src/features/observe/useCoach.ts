"use client";
// Teaching loop: watch the new hire's screen (screenshot every second), compare each new action
// with the expert's approved steps (/api/coach), and guide gently by voice at pauses:
// "that's right, next…" or "that isn't quite right, your expert does X because Y".
// Anything that differs also goes to the supervisor's review list.
// Must be used inside <ConversationProvider>.

import { useEffect, useRef, useState } from "react";
import { elapsed, resetSession } from "@/lib/events";
import { loadMastery, loadMyReviews, saveMastery, saveMyReviews } from "@/lib/session";
import { requestMic, useVoiceAgent } from "@/lib/useVoiceAgent";
import type { ReviewItem, StepMastery, WorkMap } from "@/lib/types";
import { workMapText } from "@/lib/workmapText";
import { ScreenWatcher, friendly, shareErrorText, type Frame } from "./screenWatcher";

const PAUSE_MS = 2000;
const IDLE_MS = 15000; // screen still and nobody talking: check in on the new hire
// Progress and review items belong to the signed-in person; the server knows who that is.

export type CoachStatus = "idle" | "connecting" | "watching" | "reading" | "speaking" | "done";

export function useCoach(map: WorkMap, workflowId: string) {
  const agent = useVoiceAgent("tutor");
  const watcher = useRef(new ScreenWatcher());
  const [sharing, setSharing] = useState(false);
  const [reading, setReading] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [flagged, setFlagged] = useState<string[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [message, setMessage] = useState<{ text: string; verdict: "match" | "different"; time: string } | null>(null);
  const [finished, setFinished] = useState(false);
  // Learned / relearn per step: this session, and what was saved from earlier sessions.
  const [mastery, setMastery] = useState<Record<string, StepMastery>>({});
  const [sessions, setSessions] = useState(0); // bumps on start/stop so saved progress is re-read
  const [previous, setPrevious] = useState<Record<string, StepMastery>>({});
  useEffect(() => {
    let live = true;
    loadMastery(workflowId).then((m) => live && setPrevious(m));
    return () => {
      live = false;
    };
  }, [workflowId, sessions]);
  const [error, setError] = useState<string | null>(null);

  const live = useRef({ agent, done, flagged, reviews });
  useEffect(() => {
    live.current = { agent, done, flagged, reviews };
  });
  const lastSent = useRef<string | null>(null);
  const inFlight = useRef(false);
  const missed = useRef(false); // the screen changed while a call was running
  const actions = useRef<{ time: string; text: string }[]>([]);
  // The one thing waiting to be said. A correction is never pushed out by a later "looks right",
  // and a tip that waited too long is dropped instead of being spoken about a screen long gone.
  const toSay = useRef<{ text: string; verdict: "match" | "different"; at: number } | null>(null);
  const lastNudge = useRef(0);
  const idleAsked = useRef(0); // when we last checked in on a silent stop // last time the tutor spoke up on its own
  const recent = useRef<string[]>([]);
  const pendingReviews = useRef<ReviewItem[]>([]); // unsubmitted items from earlier sessions
  const masteryRef = useRef<Record<string, StepMastery>>({});

  function mark(stepId: string, value: StepMastery) {
    // A step that needed a second look this session stays "relearn" until the supervisor says it's fine.
    if (value === "learned" && masteryRef.current[stepId] === "relearn") return;
    masteryRef.current = { ...masteryRef.current, [stepId]: value };
    setMastery(masteryRef.current);
    saveMastery(workflowId, { [stepId]: value });
  }

  const steps = map.steps.map((s) => ({
    id: s.id,
    title: (s.correction ? s.correction : s.title) + (previous[s.id] === "relearn" ? " (needed relearning last time: guide this one a bit more)" : ""),
    detail: s.decision,
    why: s.expertQuote || s.reason,
    rule: s.guardrails.join("; "),
  }));

  async function onFrame(f: Frame) {
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
    const l = live.current;
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame: f.dataUrl, previous: lastSent.current, steps, done: l.done, flagged: l.flagged, actions: actions.current, recent: recent.current, now }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      lastSent.current = f.dataUrl;
      setError(null);
      if (data.action) {
        actions.current = [...actions.current, { time: now, text: data.action }];
        // The voice tutor must know what the new hire is doing to answer their questions.
        if (l.agent.connected) l.agent.sendContextualUpdate(`[SCREEN] ${now} ${data.action}`);
      }
      if (data.verdict === "match" && data.stepId) {
        if (!l.done.includes(data.stepId)) setDone((d) => [...d, data.stepId]);
        mark(data.stepId, "learned");
      }
      if (data.verdict === "different") {
        const step = map.steps.find((s) => s.id === data.stepId);
        const item: ReviewItem = {
          id: `r${Date.now()}`,
          time: now,
          screenshot: watcher.current.grab(640) ?? undefined,
          observed: data.action ?? "Something on this screen",
          expected: step ? `${step.correction || step.title}${step.guardrails[0] ? `: ${step.guardrails[0]}` : ""}` : "The expert's usual way",
          note: data.message ?? "",
          workflowId,
          stepId: data.stepId ?? undefined,
          stepLabel: step ? `Step ${map.steps.indexOf(step) + 1} · ${step.correction || step.title}` : undefined,
        };
        if (data.stepId) mark(data.stepId, "relearn");
        const next = [...l.reviews, item];
        setReviews(next);
        saveMyReviews(workflowId, [...pendingReviews.current, ...next]);
        if (data.stepId && !l.flagged.includes(data.stepId)) setFlagged((x) => [...x, data.stepId]);
      }
      if (data.message && (data.verdict === "match" || data.verdict === "different")) {
        setMessage({ text: data.message, verdict: data.verdict, time: now });
        const pending = toSay.current;
        if (!(pending?.verdict === "different" && data.verdict === "match")) toSay.current = { text: data.message, verdict: data.verdict, at: Date.now() };
        recent.current = [...recent.current, data.message].slice(-4);
      }
    } catch (e) {
      missed.current = true; // try this screen again with the next frame
      setError(friendly(e));
    } finally {
      inFlight.current = false;
      setReading(false);
    }
  }

  // Speak guidance at a natural pause only.
  useEffect(() => {
    if (!agent.connected) return;
    const t = setInterval(() => {
      const a = live.current.agent;
      const tip = toSay.current;
      if (!tip || a.isSpeaking) return;
      if (Date.now() - tip.at > (tip.verdict === "different" ? 60_000 : 20_000)) {
        toSay.current = null;
        return;
      }
      if (Date.now() - watcher.current.lastChange < PAUSE_MS) return;
      if (Date.now() - a.lastUserSpeech.current < 2000) return;
      a.sendUserMessage(`[GUIDE] ${tip.text}`);
      toSay.current = null;
      lastNudge.current = Date.now();
    }, 800);
    return () => clearInterval(t);
  }, [agent.connected]);

  // Stopped for a while: ask what happened or where they are stuck.
  useEffect(() => {
    if (!agent.connected) return;
    lastNudge.current = Date.now();
    const t = setInterval(() => {
      const a = live.current.agent;
      const now = Date.now();
      if (toSay.current || a.isSpeaking) return;
      if (idleAsked.current > Math.max(watcher.current.lastChange, a.lastUserSpeech.current)) return; // already asked during this stop
      const quietSince = Math.max(watcher.current.lastChange, a.lastUserSpeech.current, lastNudge.current);
      if (now - quietSince < IDLE_MS) return;
      a.sendUserMessage(`[IDLE] The new hire has stopped and gone quiet for ${Math.round((now - quietSince) / 1000)} seconds. Ask briefly what happened or what they are unsure about. Don't give the answer.`);
      lastNudge.current = now;
      idleAsked.current = now;
    }, 2000);
    return () => clearInterval(t);
  }, [agent.connected]);

  async function start() {
    setError(null);
    resetSession();
    actions.current = [];
    lastSent.current = null;
    setDone([]);
    setFlagged([]);
    setReviews([]);
    setMessage(null);
    setFinished(false);
    masteryRef.current = {};
    setMastery({});
    setSessions((n) => n + 1);
    recent.current = [];
    // Keep anything the supervisor hasn't reviewed yet; a submitted batch starts fresh.
    loadMyReviews(workflowId).then((prev) => {
      pendingReviews.current = prev && !prev.submitted ? prev.items : [];
    });
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

  function stop() {
    watcher.current.stop();
    setSharing(false);
    setFinished(true);
    setSessions((n) => n + 1);
    if (agent.connected) {
      agent.sendUserMessage(
        `[DONE] The new hire finished. Learned: ${Object.values(masteryRef.current).filter((m) => m === "learned").length} step(s); to relearn: ${Object.values(masteryRef.current).filter((m) => m === "relearn").length}; ${live.current.reviews.length} item(s) went to the supervisor for review. Close warmly in two sentences: what they have down, and what they still need to get right.`,
      );
      setTimeout(() => live.current.agent.endSession(), 12000);
    }
  }

  // Give the agent the Work Map once connected.
  useEffect(() => {
    if (!agent.connected) return;
    agent.sendContextualUpdate(`[WORKMAP] ${workMapText(map)}`);
    const again = map.steps.filter((s) => previous[s.id] === "relearn").map((s) => s.correction || s.title);
    if (again.length) agent.sendContextualUpdate(`[PROGRESS] Last time the new hire needed to relearn: ${again.join("; ")}. Give those steps a little extra guidance.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.connected]);

  const status: CoachStatus = finished ? "done" : !sharing ? "idle" : agent.status === "connecting" ? "connecting" : agent.isSpeaking ? "speaking" : reading ? "reading" : "watching";

  return { status, sharing, done, flagged, reviews, message, finished, mastery, previous, error: error ?? agent.error, start, stop, transcript: agent.transcript, connected: agent.connected, micLevel: agent.getInputVolume };
}

export type Coach = ReturnType<typeof useCoach>;
