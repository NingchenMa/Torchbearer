"use client";
// Who is signed in, for pages that decide what to show. The server still enforces every rule; this only picks the view.
import { useEffect, useState } from "react";
import { canAssign, canSeeAllWorkflows, isManager, type Role } from "./roles";

export interface Me {
  id: string;
  name: string;
  email: string;
  org: string;
  role: Role;
}

let cached: Promise<Me | null> | null = null;
const fetchMe = () =>
  (cached ??= fetch("/api/auth/me", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
    .catch(() => null));

/** The signed-in person, or null while loading (and if the call fails). */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let live = true;
    fetchMe().then((m) => {
      if (live) setMe(m);
      if (!m) cached = null; // try again next time rather than remember a failure
    });
    return () => {
      live = false;
    };
  }, []);
  return {
    me,
    loading: me === null,
    manager: !!me && isManager(me.role),
    canAssign: !!me && canAssign(me),
    seesAll: !!me && canSeeAllWorkflows(me),
  };
}
