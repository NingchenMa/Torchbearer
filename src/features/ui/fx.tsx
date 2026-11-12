"use client";
// Small visual building blocks shared by the TorchBearer pages:
//   Spotlight  a card whose border and background glow follow the pointer
//   StepTrail  a workflow's steps as a trail of dots; hovering the card lights them one by one
//   CountUp    a number that counts up once when it first appears
//   Segmented  a filter with a sliding highlight under the chosen option
//   Torch      the animated torch with a flickering flame and rising embers
// All motion stops for people who turn on reduced motion (see globals.css).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function Spotlight({ children, className = "", style, as: Tag = "div" }: { children: ReactNode; className?: string; style?: React.CSSProperties; as?: "div" | "li" }) {
  const ref = useRef<HTMLElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <Tag ref={ref as never} onPointerMove={move} style={style} className={`tb-spot group/spot ${className}`}>
      {children}
    </Tag>
  );
}

export function StepTrail({ count, lit, max = 12 }: { count: number; lit: boolean; max?: number }) {
  const shown = Math.min(count, max);
  return (
    <div className="flex items-center" aria-label={`${count} step${count === 1 ? "" : "s"}`}>
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && <span className={`h-[2px] w-3 sm:w-4 ${lit ? "bg-amber/50" : "bg-line"}`} />}
          <span
            className={`tb-trail-dot h-2.5 w-2.5 rounded-full border-2 ${lit ? "border-amber bg-amber" : "border-[#c9b3b7] bg-white"}`}
            style={{ transitionDelay: `${i * 55}ms` }}
          />
        </span>
      ))}
      {count > max && <span className="ml-1.5 text-[12px] text-muted">+{count - max}</span>}
    </div>
  );
}

export function CountUp({ to, ms = 900 }: { to: number; ms?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setN(to));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <span className="tabular-nums">{n}</span>;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>(`[data-v="${value}"]`);
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options]);
  return (
    <div ref={wrap} className="relative flex shrink-0 rounded-full border border-line bg-white p-1" role="group" aria-label={label}>
      <span
        className="absolute bottom-1 top-1 rounded-full bg-maroon shadow-[0_4px_12px_rgba(58,11,20,.25)] transition-[left,width] duration-300 ease-out"
        style={{ left: pill.left, width: pill.width }}
        aria-hidden="true"
      />
      {options.map((o) => (
        <button
          key={o.value}
          data-v={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`relative z-10 inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition-colors duration-300 ${
            value === o.value ? "font-bold text-blush" : "text-ink hover:text-crimson"
          }`}
        >
          {o.label}
          {o.count !== undefined && <span className={`text-[12.5px] tabular-nums ${value === o.value ? "text-amber" : "text-muted"}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The big animated torch: flame flickers, embers rise, a warm glow breathes behind it. */
export function Torch({ size = 220 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size * 0.62, height: size }} aria-hidden="true">
      <div className="tb-glow absolute left-1/2 top-[18%] h-[70%] w-[160%] [transform:translate(-50%,-50%)] rounded-full bg-[radial-gradient(circle,rgba(242,160,7,.45)_0%,rgba(226,56,62,.22)_35%,rgba(58,11,20,0)_68%)]" />
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className="tb-ember absolute rounded-full bg-amber"
          style={{
            left: `${38 + ((i * 37) % 26)}%`,
            top: "26%",
            width: 3 + (i % 3),
            height: 3 + (i % 3),
            animationDelay: `${(i * 0.43) % 3.2}s`,
            animationDuration: `${2.6 + (i % 4) * 0.5}s`,
          }}
        />
      ))}
      <svg viewBox="0 0 62 100" className="relative h-full w-full">
        <defs>
          <linearGradient id="tb-flame-a" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#a4161a" />
            <stop offset=".5" stopColor="#e2383e" />
            <stop offset="1" stopColor="#f2a007" />
          </linearGradient>
          <linearGradient id="tb-metal-a" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#c9a9ae" />
            <stop offset=".45" stopColor="#ffffff" />
            <stop offset="1" stopColor="#b8959b" />
          </linearGradient>
        </defs>
        <g className="tb-flame" style={{ transformOrigin: "31px 44px" }}>
          <path d="M31 2c7 12 19 17 17 31-1.2 8-8 13-17 13S14.8 40.8 14 33C12.8 22 22 18 23 9c3 4.4 4.8 8 4.6 12.8C31.6 17.2 32.8 10 31 2Z" fill="url(#tb-flame-a)" />
        </g>
        <g className="tb-flame-inner" style={{ transformOrigin: "31px 44px" }}>
          <path d="M31 21c4 6 8.6 9.2 7.8 14.8-.6 4-3.8 6.6-7.8 6.6s-7.4-2.6-7.8-6.6c-.6-5.2 3.4-7.2 4.2-12 1.6 1.8 2.6 3.8 2.6 6 2-2.6 2-5.6 1-8.8Z" fill="#f9c74f" />
        </g>
        <path d="M10 47h42l-5.2 13H15.2Z" fill="url(#tb-metal-a)" />
        <path d="M22 61h18l-4.6 37h-8.8Z" fill="url(#tb-metal-a)" />
      </svg>
    </div>
  );
}
