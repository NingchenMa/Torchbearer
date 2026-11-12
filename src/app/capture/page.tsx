"use client";
// Module 1 · Capture: one click launches Torchbearer bot into an always-on-top floating
// window (Chrome/Edge Picture-in-Picture). In the bot: Start recording → choose Entire screen →
// it reads the screen every second in any browser tab, writes the workflow live and asks by voice
// when the screenshots can't explain something. Stop recording → everything goes to Mapping.

import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useState, useSyncExternalStore } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import ObserverPanel from "@/features/observe/ObserverPanel";
import Launcher from "@/features/observe/Launcher";
import { useObserver } from "@/features/observe/useObserver";
import { pipSupported, usePip } from "@/features/observe/usePip";
import { requestMic } from "@/lib/useVoiceAgent";

export default function CapturePage() {
  return (
    <ConversationProvider>
      <Capture />
    </ConversationProvider>
  );
}

function Capture() {
  const router = useRouter();
  const pip = usePip();
  const [micError, setMicError] = useState<string | null>(null);
  const o = useObserver((id) => {
    pip.close();
    window.focus();
    router.push(`/map?id=${id}`);
  });
  const canPip = useSyncExternalStore(() => () => {}, pipSupported, () => true);
  const bot = <ObserverPanel o={o} onStart={(name) => o.start(name)} />;
  const [name, setName] = useState("");
  const startArea = o.sharing ? (
    <div className="text-[15px]">
      <div className="font-medium text-err">● Recording “{name || "workflow"}”</div>
      <p className="mt-1 text-[14px] text-[#475467]">Switch to your work. Stop recording in the floating Torchbearer when you&apos;re done.</p>
    </div>
  ) : (
    <div className="flex flex-col gap-2">
      <label htmlFor="page-wf-name" className="text-[12px] font-bold uppercase tracking-[.14em] text-crimson">Name this workflow</label>
      <input
        id="page-wf-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Meal expense report"
        className="h-11 rounded-full border border-line px-4 text-[16px] outline-none transition-[border-color,box-shadow] focus:border-crimson focus:ring-2 focus:ring-crimson/15"
      />
      <button
        onClick={() => o.start(name)}
        disabled={!name.trim()}
        className="tb-btn-amber h-12 w-full text-[16px] disabled:cursor-not-allowed disabled:opacity-40"
      >
        ● Start recording
      </button>
      <p className="text-[13px] text-[#667085]">Chrome will ask what to share: choose <b>Entire screen</b>.</p>
      {o.error && <p className="rounded-sm bg-err-soft px-3 py-2 text-[13.5px] text-[#8E1B1B]">{o.error}</p>}
    </div>
  );

  return (
    <>
      <Launcher
        eyebrow="Teaching · record a workflow"
        title={<>Do the task. <span className="font-serif italic text-amber">Explain as you go.</span></>}
        text="TorchBearer floats on your screen while you work in any browser. It writes down each step from the screen and asks you why whenever something isn't clear. When you stop, you check what it wrote."
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
        
        demo={{ href: "/ledgerline/index.html?user=paul", label: "Demo app: open Ledgerline as the expert" }}
      />
      {pip.container && createPortal(bot, pip.container)}
    </>
  );
}
