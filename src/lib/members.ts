// Server-only: the company's people directory, kept in S3 (members/index.json under the company's prefix).
// Cognito can't list people by company (custom attributes aren't searchable) and listing would need extra
// permissions, so people are written here: when an admin adds them (Access management), and when they sign in.
// Managers pick from it to assign work; admins manage it.
import { orgDb } from "./db";
import type { User } from "./auth";
import type { Member } from "./types";

const PATH = "members/index.json";

export async function listMembers(org: string): Promise<Member[]> {
  return (await orgDb(org).readJson<Member[]>(PATH)) ?? [];
}

export async function saveMembers(org: string, members: Member[]): Promise<void> {
  await orgDb(org).writeJson(PATH, [...members].sort((a, b) => a.name.localeCompare(b.name)));
}

/** Add the person, or update them if their name, email or role changed. Keeps anything else on file, like their employee ID. */
export async function upsertMember(u: User): Promise<void> {
  const members = await listMembers(u.org);
  const before = members.find((m) => m.id === u.id);
  if (before && before.name === u.name && before.email === u.email && before.role === u.role) return;
  await saveMembers(u.org, [...members.filter((m) => m.id !== u.id), { ...before, id: u.id, name: u.name, email: u.email, role: u.role }]);
}
