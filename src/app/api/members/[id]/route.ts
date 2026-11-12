// PATCH /api/members/<id> { role } — change someone's access. Admins only.
// The change is made on their Cognito group and applies the next time their sign-in token is renewed (within an hour).
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { orgOf, setRole } from "@/lib/cognitoAdmin";
import { listMembers, saveMembers } from "@/lib/members";
import { canManageAccess, type Role } from "@/lib/roles";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const ROLES: Role[] = ["employee", "manager", "admin"];

export async function PATCH(req: Request, { params }: Ctx) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  if (!canManageAccess(u)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { role } = (await req.json()) as { role?: Role };
  if (!role || !ROLES.includes(role)) return NextResponse.json({ error: "Choose an access level." }, { status: 400 });
  // An admin can't take their own admin access away. That keeps at least one admin, so nobody is locked out.
  if (id === u.id && role !== "admin") return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });

  const members = await listMembers(u.org);
  const person = members.find((m) => m.id === id);
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The company is checked on the account itself too, so an admin can never change someone at another company.
  if ((await orgOf(person.email)) !== u.org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await setRole(person.email, role);
  } catch {
    return NextResponse.json({ error: "Couldn't change their access. Try again." }, { status: 502 });
  }
  await saveMembers(u.org, members.map((m) => (m.id === id ? { ...m, role } : m)));
  return NextResponse.json({ ok: true });
}
