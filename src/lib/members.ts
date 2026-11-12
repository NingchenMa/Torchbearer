// Server-only: the company's people directory, kept in S3 (members/index.json under the company's prefix).
// Cognito can't list people by company (custom attributes aren't searchable) and listing would need extra
// permissions, so each person is written here when they sign in. Managers pick from it to assign work.
// Someone appears once they have signed in for the first time.
import { orgDb } from "./db";
import type { User } from "./auth";
import type { Member } from "./types";

const PATH = "members/index.json";

export async function listMembers(org: string): Promise<Member[]> {
  return (await orgDb(org).readJson<Member[]>(PATH)) ?? [];
}

/** Add the person, or update them if their name, email or role changed. Writes nothing when nothing changed. */
export async function upsertMember(u: User): Promise<void> {
  const db = orgDb(u.org);
  const members = (await db.readJson<Member[]>(PATH)) ?? [];
  const me: Member = { id: u.id, name: u.name, email: u.email, role: u.role };
  const before = members.find((m) => m.id === u.id);
  if (before && before.name === me.name && before.email === me.email && before.role === me.role) return;
  await db.writeJson(PATH, [...members.filter((m) => m.id !== u.id), me].sort((a, b) => a.name.localeCompare(b.name)));
}
