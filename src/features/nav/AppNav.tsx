"use client";
// Top bar on every app page: the three modules as tabs (jump to any of them, in any order),
// plus the signed-in company and Sign out.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TorchMark } from "@/features/nav/TorchMark";

interface Me {
  email: string;
  org: string;
}

const TABS = [
  { href: "/capture", label: "Teaching", hint: "An expert teaches", match: ["/capture"] },
  { href: "/vault", label: "Workflows", hint: "View and approve", match: ["/vault", "/map", "/process", "/review"] },
  { href: "/teach", label: "Training", hint: "A new hire trains", match: ["/teach"] },
];

/** Pages without the bar: the public signed-out page. */
const HIDDEN = ["/signed-out"];

const companyName = (org: string) =>
  org.startsWith("user-") ? "Your workspace" : org.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function AppNav() {
  const path = usePathname() ?? "";
  const [me, setMe] = useState<Me | null>(null);
  const hidden = HIDDEN.some((p) => path.startsWith(p));

  useEffect(() => {
    if (hidden) return;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, [hidden]);

  if (hidden) return null;
  return (
    <header className="tb-hero shrink-0 border-b border-maroon-3">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <Link prefetch={false} href="/vault" className="flex shrink-0 items-center gap-2.5 py-2" aria-label="TorchBearer, workflow vault">
          <TorchMark size={30} />
          <span className="hidden leading-tight md:block">
            <span className="block font-display text-[19px] text-blush">TorchBearer</span>
            {me && me.org !== "torchbearer" && (
              <span className="block max-w-[160px] truncate font-serif text-[12.5px] italic text-amber">{companyName(me.org)}</span>
            )}
          </span>
        </Link>

        <nav className="flex min-w-0 flex-1 justify-center" aria-label="Modules">
          {TABS.map((t) => {
            const active = t.match.some((m) => path === m || path.startsWith(m + "/"));
            return (
              <Link
                key={t.href}
                prefetch={false}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`relative px-2.5 py-2.5 text-center transition-colors sm:px-5 ${active ? "text-white" : "text-blush-2 hover:text-white"}`}
              >
                <span className={`block text-[14.5px] sm:text-[15px] ${active ? "font-bold" : ""}`}>{t.label}</span>
                <span className={`hidden font-serif text-[12px] italic sm:block ${active ? "text-amber" : "text-blush-2/70"}`}>{t.hint}</span>
                {active && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-amber shadow-[0_0_12px_rgba(242,160,7,.7)]" aria-hidden="true" />}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          {me && <span className="hidden max-w-[200px] truncate text-[13px] text-blush-2 lg:inline">{me.email}</span>}
          <a href="/api/auth/logout" className="rounded-full border border-blush-2/50 px-3 py-1 text-[13px] text-blush transition hover:border-blush hover:bg-white/5">Sign out</a>
        </div>
      </div>
    </header>
  );
}
