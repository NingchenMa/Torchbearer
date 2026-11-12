"use client";
// The app's navigation, on the left of every page (a narrow icon rail on phones).
//   Workflows   the vault, plus a workflow's Work Map and Process map
//   Reviews     practice sessions to decide on, with a count of what is waiting
//   Assign      give a workflow to a new hire (managers and admins only)
//   Training    the work assigned to you
//   Access management   admins only: change people's access and add members
// At the bottom: the company, who is signed in, their role, and Sign out.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BotFace } from "@/features/observe/Launcher";
import { ROLE_LABEL, canAssign } from "@/lib/roles";
import { useMe } from "@/lib/useMe";

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ITEMS = [
  { href: "/vault", label: "Workflows", match: ["/vault", "/map", "/process"], icon: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></> },
  { href: "/review", label: "Reviews", match: ["/review"], icon: <path d="M5 12l5 5L20 7" />, badge: true },
  { href: "/assign", label: "Assign", match: ["/assign"], icon: <path d="M12 5v14M5 12h14" /> },
];
const TRAINING = { href: "/teach", label: "Training", match: ["/teach"], icon: <><path d="M4 6l8-3 8 3-8 3-8-3z" /><path d="M7 10.5V15c0 1.5 2.5 3 5 3s5-1.5 5-3v-4.5" /></> };
const ACCESS = { href: "/access", label: "Access management", match: ["/access"], icon: <><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></> };

/** Pages without the sidebar: the public signed-out page. */
const HIDDEN = ["/signed-out"];

const companyName = (org: string) => (org.startsWith("user-") ? "Your workspace" : org.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

export default function Sidebar() {
  const path = usePathname() ?? "";
  const hidden = HIDDEN.some((p) => path.startsWith(p));
  const { me } = useMe();
  const [waiting, setWaiting] = useState(0);

  // How many review items are still undecided; refreshed when you move between pages.
  useEffect(() => {
    if (hidden) return;
    let live = true;
    fetch("/api/reviews?count=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { open?: number } | null) => live && setWaiting(d?.open ?? 0))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path, hidden]);

  if (hidden) return null;
  // A page the person can't use gets no entry in their sidebar. (Opening its address still says they lack access.)
  const items = ITEMS.filter((t) => t.href !== "/assign" || (!!me && canAssign(me)));
  const active = (match: string[]) => match.some((m) => path === m || path.startsWith(m + "/"));
  const link = (t: { href: string; label: string; match: string[]; icon: React.ReactNode; badge?: boolean }) => {
    const on = active(t.match);
    return (
      <Link
        key={t.href}
        prefetch={false}
        href={t.href}
        aria-current={on ? "page" : undefined}
        title={t.label}
        className={`relative flex h-11 items-center gap-3 rounded-sm px-[13px] md:px-3.5 ${on ? "bg-indigo-soft font-medium text-indigo" : "text-[#475467] hover:bg-panel-2 hover:text-[#1f2d3d]"}`}
      >
        {on && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-indigo" aria-hidden="true" />}
        <Icon>{t.icon}</Icon>
        <span className="hidden md:inline">{t.label}</span>
        {t.badge && waiting > 0 && (
          <b className="ml-auto hidden min-w-[22px] rounded-full border border-[#f0d58a] bg-warn-soft px-[7px] text-center text-[12px] font-medium text-[#7a5a00] md:block">{waiting}</b>
        )}
      </Link>
    );
  };

  return (
    <aside className="flex w-16 shrink-0 flex-col border-r border-line bg-white px-2 pb-4 pt-3 md:w-60 md:px-4 md:pt-4">
      <Link prefetch={false} href="/vault" aria-label="Torchbearer, workflows" className="flex items-center gap-2.5 px-1 pb-5 md:pb-6">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-indigo">
          <BotFace size={22} />
        </span>
        <span className="hidden text-[15px] font-medium text-[#1f2d3d] md:block">Torchbearer</span>
      </Link>

      <div className="mx-2 mb-2 mt-1 hidden text-[11.5px] font-bold uppercase tracking-[.12em] text-[#667085] md:block">Workflows</div>
      <nav className="flex flex-col gap-1" aria-label="Workflows">{items.map(link)}</nav>

      <div className="mx-2 mb-2 mt-6 hidden text-[11.5px] font-bold uppercase tracking-[.12em] text-[#667085] md:block">Modules</div>
      <nav className="mt-4 flex flex-col gap-1 md:mt-0" aria-label="Modules">
        {link(TRAINING)}
        {me?.role === "admin" && link(ACCESS)}
      </nav>

      {me && (
        <div className="mt-auto hidden rounded-md border border-line bg-panel px-3.5 py-3 text-[13px] md:block">
          {me.org !== "torchbearer" && <b className="block truncate font-medium text-[#1f2d3d]">{companyName(me.org)}</b>}
          <div className="truncate text-[#1f2d3d]">{me.name}</div>
          <div className="truncate text-[#667085]">{me.email}</div>
          <span className="mt-1 inline-block rounded-full bg-indigo-soft px-2 text-[12px] font-medium text-indigo">{ROLE_LABEL[me.role]}</span>
          <a href="/api/auth/logout" className="mt-1.5 block text-[#667085] hover:text-indigo">Sign out</a>
        </div>
      )}
    </aside>
  );
}
