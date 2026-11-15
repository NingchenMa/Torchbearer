// GET  /api/members  the people at the signed-in user's company. Managers and admins (it feeds Assign).
// POST /api/members  { name, email, employeeId, role }: add someone (Cognito emails them a temporary password).
//                    Admins only. They are always added to the admin's own company.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { EmailTaken, createUser, setRole } from "@/lib/cognitoAdmin";
import { listMembers, saveMembers } from "@/lib/members";
import { canAssign, canManageAccess, type Role } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  if (!canAssign(u)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await listMembers(u.org));
}

const ROLES: Role[] = ["employee", "manager", "admin"];
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  if (!canManageAccess(u)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = (await req.json()) as { name?: string; email?: string; employeeId?: string; role?: string };
  const name = (b.name ?? "").trim();
  const email = (b.email ?? "").trim().toLowerCase();
  const employeeId = (b.employeeId ?? "").trim();
  const role = b.role as Role;
  if (name.length < 2 || name.length > 80) return bad("Enter the person's full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("Enter a valid work email.");
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(employeeId)) return bad("Enter an employee ID: letters, numbers, dots, dashes and underscores, up to 32.");
  if (!ROLES.includes(role)) return bad("Choose an access level.");

  const members = await listMembers(u.org);
  if (members.some((m) => m.email.toLowerCase() === email)) return bad("That email is already a member.", 409);
  if (members.some((m) => m.employeeId?.toLowerCase() === employeeId.toLowerCase())) return bad("That employee ID is already used.", 409);

  let id: string;
  try {
    id = await createUser({ email, name, org: u.org });
  } catch (e) {
    // Don't say which company an existing account belongs to.
    if (e instanceof EmailTaken) return bad("That email can't be added.", 409);
    return bad("Couldn't create the account. Try again.", 502);
  }
  try {
    await setRole(email, role);
  } catch {
    return bad("The account was created, but its access level couldn't be set. Set it in the list below.", 502);
  } finally {
    // The account exists either way, so the person belongs in the list.
    await saveMembers(u.org, [...members, { id, name, email, role, employeeId }]);
  }
  return NextResponse.json({ id, name, email, role, employeeId }, { status: 201 });
}
