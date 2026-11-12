"use client";
// Access management: admins only. Change what each person can do, and add new members.
// Anyone else is told they lack access, and nothing is requested for them (the server refuses it too).
//   Employee  sees only their own workflows and the work assigned to them
//   Manager   sees every workflow, reviews and assigns work
//   Admin     everything a manager can do, plus this page
// Adding someone makes their account and emails them a temporary password. A change of access applies the next
// time their sign-in is renewed (within an hour).

import { useEffect, useMemo, useState } from "react";
import NoAccess from "@/features/nav/NoAccess";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import type { Member } from "@/lib/types";
import { useMe } from "@/lib/useMe";

const ROLES: Role[] = ["employee", "manager", "admin"];
const DESCRIPTION: Record<Role, string> = {
  employee: "Sees their own workflows and the work assigned to them.",
  manager: "Sees every workflow, reviews practice sessions and assigns work.",
  admin: "Everything a manager can do, plus managing access.",
};
const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

export default function AccessPage() {
  const { me, loading } = useMe();
  if (loading) return <div className="grid min-h-full place-items-center bg-[#f6f8fc] text-[15px] text-[#667085]">Loading…</div>;
  if (me?.role !== "admin") {
    return (
      <div className="min-h-full bg-[#f6f8fc]">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-7">
          <h1 className="pb-1 pt-6 text-[26px] font-medium leading-tight text-[#1f2d3d]">Access management</h1>
          <NoAccess message="You lack access to manage access." />
        </div>
      </div>
    );
  }
  return <Access myId={me.id} />;
}

function Access({ myId }: { myId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Role>("all");
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  // The add form: every field is required.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/members", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m: Member[]) => setMembers(m))
      .catch(() => {
        setMembers([]);
        setFlash({ ok: false, text: "Couldn't load the people list. Check the connection and refresh." });
      });
  }, []);

  const all = useMemo(() => members ?? [], [members]);
  const count = (r: Role) => all.filter((m) => m.role === r).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((m) => (filter === "all" || m.role === filter) && (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || (m.employeeId ?? "").toLowerCase().includes(q)));
  }, [all, query, filter]);

  const problems = {
    name: name.trim().length < 2 ? "Enter the person's full name." : "",
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "" : "Enter a valid work email.",
    employeeId: /^[A-Za-z0-9._-]{1,32}$/.test(employeeId.trim()) ? "" : "Enter an employee ID (letters, numbers, . - _).",
  };
  const valid = !problems.name && !problems.email && !problems.employeeId;

  async function add() {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    setFlash(null);
    try {
      const r = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), employeeId: employeeId.trim(), role }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setMembers((l) => [...(l ?? []), data as Member].sort((a, b) => a.name.localeCompare(b.name)));
      setFlash({ ok: true, text: `${name.trim()} was added as ${ROLE_LABEL[role]}. They get an email with a temporary password.` });
      setName("");
      setEmail("");
      setEmployeeId("");
      setRole("employee");
      setTouched(false);
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error && e.message ? e.message : "Couldn't add them. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  async function change(m: Member, next: Role) {
    const before = m.role;
    setMembers((l) => (l ?? []).map((x) => (x.id === m.id ? { ...x, role: next } : x)));
    try {
      const r = await fetch(`/api/members/${encodeURIComponent(m.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: next }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setFlash({ ok: true, text: `${m.name} is now ${ROLE_LABEL[next]}. It applies the next time they sign in, or within an hour.` });
    } catch (e) {
      setMembers((l) => (l ?? []).map((x) => (x.id === m.id ? { ...x, role: before } : x)));
      setFlash({ ok: false, text: e instanceof Error && e.message ? e.message : "Couldn't change their access. Please try again." });
    }
  }

  const panel = "rounded-md border border-line bg-white shadow-[0_4px_14px_rgba(16,24,40,.04)]";
  const panelHead = "flex items-center gap-2.5 rounded-t-md border-b border-line bg-panel-2 px-4 py-3 text-[13px] font-bold uppercase tracking-[.05em] text-[#444]";
  const label = "mb-1.5 block text-[12px] font-bold uppercase tracking-[.06em] text-[#667085]";
  const input = (bad: string) => `h-10 w-full rounded-sm border bg-white px-3 focus:border-indigo focus:outline-none ${touched && bad ? "border-err" : "border-[#9aa0a6]"}`;
  const err = (m: string) => (touched && m ? <p className="mt-1 text-[13px] text-err">{m}</p> : null);

  return (
    <div className="min-h-full bg-[#f6f8fc]">
      <div className="mx-auto max-w-[1240px] px-4 pb-10 sm:px-7">
        <h1 className="pb-5 pt-6 text-[26px] font-medium leading-tight text-[#1f2d3d]">Access management</h1>

        <section className="mb-5 grid gap-4 sm:grid-cols-3" aria-label="Summary">
          {ROLES.slice().reverse().map((r) => (
            <div key={r} className="rounded-md border border-line bg-white px-4 py-3">
              <span className="block text-[12px] font-bold uppercase tracking-[.06em] text-[#667085]">{ROLE_LABEL[r]}s</span>
              <b className="text-[26px] font-medium leading-[1.3] text-[#1f2d3d]">{count(r)}</b>
            </div>
          ))}
        </section>

        {flash && (
          <p role="status" className={`mb-4 rounded-md border px-4 py-3 text-[14.5px] ${flash.ok ? "border-[#bfe3cc] bg-ok-soft text-ok" : "border-[#f3c2c2] bg-err-soft text-[#8e1b1b]"}`}>{flash.text}</p>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
          <form className={panel} onSubmit={(e) => { e.preventDefault(); add(); }} noValidate>
            <h2 className={panelHead}>Add a member</h2>
            <div className="flex flex-col gap-4 p-4">
              <div>
                <label htmlFor="m-name" className={label}>Full name <span className="text-err">*</span></label>
                <input id="m-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="e.g. Alex Kim" className={input(problems.name)} />
                {err(problems.name)}
              </div>
              <div>
                <label htmlFor="m-email" className={label}>Work email <span className="text-err">*</span></label>
                <input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" placeholder="name@company.com" className={input(problems.email)} />
                {err(problems.email)}
              </div>
              <div>
                <label htmlFor="m-id" className={label}>Employee ID <span className="text-err">*</span></label>
                <input id="m-id" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} autoComplete="off" placeholder="e.g. E-1042" className={input(problems.employeeId)} />
                {err(problems.employeeId)}
              </div>
              <div>
                <label htmlFor="m-role" className={label}>Access level <span className="text-err">*</span></label>
                <select id="m-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-10 w-full rounded-sm border border-[#9aa0a6] bg-white px-3">
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <p className="mt-1.5 text-[13px] text-[#667085]">{DESCRIPTION[role]}</p>
              </div>
              <p className="rounded-md bg-panel-2 px-3 py-2.5 text-[13.5px] text-[#667085]">They get an email with a temporary password and choose their own when they first sign in.</p>
              <button type="submit" disabled={saving} className="h-10 rounded-sm border border-indigo bg-indigo px-4 text-[15px] text-white hover:bg-indigo-dark disabled:opacity-50">
                {saving ? "Adding…" : "Add member"}
              </button>
            </div>
          </form>

          <div className={panel}>
            <h2 className={panelHead}>
              People
              <span className="ml-auto text-[13px] font-normal normal-case tracking-normal text-[#667085]">{shown.length === all.length ? `${all.length} ${all.length === 1 ? "person" : "people"}` : `${shown.length} of ${all.length}`}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, email or ID" aria-label="Search people" className="h-[38px] min-w-44 flex-1 rounded-sm border border-line px-3 text-[14px] focus:border-indigo focus:outline-none" />
              <div className="flex flex-wrap rounded-sm border border-line bg-white text-[14px]" role="group" aria-label="Access level">
                {(["all", ...ROLES] as const).map((k) => (
                  <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`h-[38px] px-3 ${filter === k ? "bg-indigo-soft font-medium text-indigo" : "text-[#475467]"}`}>
                    {k === "all" ? "All" : ROLE_LABEL[k]}
                    <i className="ml-1.5 text-[12.5px] not-italic text-[#98a2b3]">{k === "all" ? all.length : count(k)}</i>
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] font-bold uppercase tracking-[.06em] text-[#667085]">
                    <th className="px-4 py-2.5">Person</th><th className="px-3 py-2.5">Employee ID</th><th className="px-3 py-2.5">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-soft text-[11.5px] font-medium text-indigo">{initials(m.name)}</span>
                          <span className="min-w-0">
                            <b className="font-medium">{m.name}</b>
                            {m.id === myId && <span className="ml-2 rounded-full bg-[#eef0f3] px-2 text-[12px] text-[#475467]">You</span>}
                            <span className="block truncate text-[12.5px] text-[#667085]">{m.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-middle font-mono text-[13px] text-[#475467]">{m.employeeId ?? "–"}</td>
                      <td className="px-3 py-3 align-middle">
                        <select
                          value={m.role}
                          onChange={(e) => change(m, e.target.value as Role)}
                          disabled={m.id === myId}
                          title={m.id === myId ? "You can't remove your own admin access" : undefined}
                          aria-label={`Access for ${m.name}`}
                          className="h-9 rounded-sm border border-[#9aa0a6] bg-white px-2.5 text-[14px] disabled:bg-panel disabled:text-[#98a2b3]"
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {members === null && <p className="p-8 text-center text-[#667085]">Loading…</p>}
            {members !== null && shown.length === 0 && <p className="p-8 text-center text-[#475467]">{all.length ? "Nobody matches this filter." : "No one yet. Add the first member on the left."}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
