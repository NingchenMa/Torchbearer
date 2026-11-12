"use client";
// One-click launcher: the page only exists to pop Torchbearer bot out into its own
// always-on-top window. Everything else (start/stop recording, questions, steps) happens
// in the floating bot, over whatever browser tab or app the user works in.

import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, MicOff } from "lucide-react";
import { Torch } from "@/features/ui/fx";

interface Props {
  eyebrow: string;
  title: ReactNode;
  text: string;
  launched: boolean;
  canPip: boolean;
  /** The floating window was refused: the bot floats in this page's corner instead. */
  failed?: boolean;
  /** Mic permission problem from the Launch click. */
  micError?: string | null;
  /** Start controls shown on this page once launched (Chrome only starts screen recording from a click here). */
  startArea?: ReactNode;
  onLaunch: () => void;
  /** The bot itself, shown inline only when floating windows aren't available. */
  panel: ReactNode;
  demo: { href: string; label: string };
  /** Small links to the other modules (there is no header bar). */
  links?: { href: string; label: string }[];
  notice?: ReactNode;
}

export default function Launcher({ eyebrow, title, text, launched, canPip, failed = false, micError, onLaunch, panel, demo, links, notice, startArea }: Props) {
  const steps: [string, string][] = [
    ["Launch", "TorchBearer pops out and floats on top of your screen."],
    ["Start recording", "Press it in TorchBearer and choose Entire screen."],
    ["Work as usual", "In any browser tab. It watches, and asks only at a pause."],
  ];
  return (
    <section className="relative min-h-full bg-cream">
      <div className="tb-hero relative overflow-hidden">
        <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-6 py-12 md:grid-cols-[1fr_auto] md:py-16">
          <div className="tb-rise">
            <p className="text-[12px] font-bold uppercase tracking-[.16em] text-amber">{eyebrow}</p>
            <h1 className="mt-4 font-display text-[40px] leading-[1.05] text-blush md:text-[58px]">{title}</h1>
            <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-blush-2">{text}</p>

            {notice ? (
              <div className="mt-8 w-full max-w-xl">{notice}</div>
            ) : (
              <>
                {canPip && !launched && !failed && (
                  <button onClick={onLaunch} className="tb-btn-amber tb-cta mt-8 h-14 px-8 text-[18px]">
                    Launch TorchBearer <ArrowRight size={20} aria-hidden="true" />
                  </button>
                )}
                {(launched || failed || !canPip) && startArea && (
                  <div className="tb-rise mt-8 w-full max-w-md rounded-lg bg-white p-5 text-left text-ink shadow-[0_24px_60px_rgba(0,0,0,.35)]">{startArea}</div>
                )}
                {launched && (
                  <p className="mt-4 flex max-w-md items-start gap-2 text-[15px] text-[#9fe0b9]">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                    TorchBearer is floating on your screen. Start recording here (allow the microphone if Chrome asks), then switch to your work.
                  </p>
                )}
                {micError && (
                  <p className="mt-4 flex max-w-md items-start gap-2 rounded-md bg-err-soft px-4 py-3 text-[15px] text-[#8E1B1B]">
                    <MicOff size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {micError}
                  </p>
                )}
                {(!canPip || failed) && (
                  <p className="mt-5 max-w-md text-[14px] text-blush-2">
                    This browser can&apos;t open a floating window (desktop Chrome or Edge can), so TorchBearer floats in the corner of this page.
                  </p>
                )}
              </>
            )}
          </div>
          <div className="hidden justify-self-center md:block">
            <Torch size={300} />
          </div>
        </div>
      </div>

      {!notice && (
        <div className="mx-auto max-w-6xl px-6 py-12">
          <p className="tb-eyebrow">How it works</p>
          <ol className="relative mt-5 grid gap-4 sm:grid-cols-3">
            {/* Drawn after the three cards have landed (the last one finishes at about 1 second), so it never shows over empty space */}
            <span className="tb-draw absolute left-[16%] right-[16%] top-[38px] hidden h-[2px] bg-[linear-gradient(90deg,#a4161a,#f2a007)] sm:block" style={{ animationDelay: "1.05s" }} aria-hidden="true" />
            {steps.map(([t, d], i) => (
              <li key={t} className="tb-rise relative rounded-lg border border-line bg-white p-5" style={{ animationDelay: `${200 + i * 120}ms` }}>
                <span className="relative grid h-9 w-9 place-items-center rounded-full bg-maroon font-display text-[17px] text-amber shadow-[0_0_0_6px_#f8f2f3]">{i + 1}</span>
                <h2 className="mt-4 font-display text-[22px] text-ink">{t}</h2>
                <p className="mt-1 text-[15px] leading-relaxed text-muted">{d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-[14.5px]">
            <a href={demo.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-bold text-crimson hover:underline">
              {demo.label} <ExternalLink size={14} aria-hidden="true" />
            </a>
            {links?.map((l) => (
              <a key={l.href} href={l.href} className="text-muted hover:text-crimson">{l.label}</a>
            ))}
          </div>
        </div>
      )}
      {(!canPip || failed) && !notice && (
        <div className="rise fixed bottom-5 right-5 z-40 h-[600px] max-h-[calc(100vh-90px)] w-[380px] overflow-hidden rounded-md border border-[#cfd2d8] shadow-[0_18px_48px_rgba(20,28,38,.28)]">
          {panel}
        </div>
      )}
    </section>
  );
}

export function BotFace({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="10" y="16" width="44" height="34" rx="12" fill="#fff" />
      <circle cx="24" cy="33" r="5" fill="#5a1220" />
      <circle cx="40" cy="33" r="5" fill="#5a1220" />
      <path d="M25 43c4 3 10 3 14 0" stroke="#5a1220" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M32 16V9" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="7" r="3.5" fill="#f2a007" />
    </svg>
  );
}
