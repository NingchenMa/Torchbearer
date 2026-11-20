"use client";
// Shared ElevenLabs session logic for the Interviewer and the Tutor.
// Must be used inside <ConversationProvider>.

import { useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { elapsed } from "./events";
import type { TranscriptLine } from "./types";

export function useVoiceAgent(role: "interviewer" | "tutor") {
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastUserSpeech = useRef(0);
  const lastAgentSpeech = useRef(0); // when the agent last said something (its reply may still be playing)

  const conv = useConversation({
    onMessage: ({ message, role: from }) => {
      if (from === "user" && message.startsWith("[")) return; // our own tagged control messages
      // The agent sometimes echoes a tag or adds a style tag ("[slow]"): show only the words.
      const text = from === "user" ? message : message.replace(/\[[A-Za-z ]{1,20}\]\s*/g, "").trim();
      if (!text) return;
      if (from === "user") lastUserSpeech.current = Date.now();
      else lastAgentSpeech.current = Date.now();
      setTranscript((t) => [...t, { time: elapsed(), speaker: from === "user" ? "expert" : "agent", text }]);
    },
    onError: (message) => setError(String(message)),
  });

  async function start() {
    setError(null);
    try {
      // Only checks the permission; the voice session opens its own mic stream.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      const res = await fetch(`/api/elevenlabs/token?role=${role}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await conv.startSession({ conversationToken: data.token, connectionType: "webrtc" });
    } catch (e) {
      setError(micErrorText(e));
    }
  }

  return { ...conv, start, transcript, error, connected: conv.status === "connected", lastUserSpeech, lastAgentSpeech };
}

/** Ask for the microphone early (e.g. on the Launch click, while the page is in front), so the
 *  user actually sees Chrome's prompt. Resolves to an error text, or null when allowed. */
export async function requestMic(): Promise<string | null> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return null;
  } catch (e) {
    return micErrorText(e);
  }
}

function micErrorText(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone is blocked. Click the icon left of the address bar on the Torchbearer page, set Microphone to Allow, then press Start recording again.";
  if (name === "NotFoundError") return "No microphone found. Plug one in (or check System Settings → Sound → Input) and press Start recording again.";
  if (name === "NotReadableError") return "The microphone is in use by another app (Zoom, Meet…). Close it and press Start recording again.";
  return e instanceof Error ? e.message : String(e);
}
