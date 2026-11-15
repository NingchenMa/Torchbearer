// Server-only: the few Cognito admin calls Access management needs. They run as the app's own IAM role
// (see docs/aws-deployment.md, D3b, for the permissions), never with anything from the browser.
// A person's role is their Cognito group, so changing access means moving them between groups.
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognito } from "./auth";
import type { Role } from "./roles";

// A user pool ID looks like "us-east-1_AbC123": its region is the part before the underscore.
const client = new CognitoIdentityProviderClient({ region: cognito.userPoolId.split("_")[0] || "us-east-1" });
const UserPoolId = cognito.userPoolId;
const GROUPS = ["admin", "manager"] as const;

export class EmailTaken extends Error {}

/** Invite someone: Cognito emails them a temporary password. Returns their user ID (the token's sub). */
export async function createUser(opts: { email: string; name: string; org: string }): Promise<string> {
  try {
    const r = await client.send(
      new AdminCreateUserCommand({
        UserPoolId,
        Username: opts.email,
        UserAttributes: [
          { Name: "email", Value: opts.email },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: opts.name },
          { Name: "custom:org", Value: opts.org }, // always the admin's own company
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      }),
    );
    const sub = r.User?.Attributes?.find((a) => a.Name === "sub")?.Value;
    if (!sub) throw new Error("Cognito did not return a user ID");
    return sub;
  } catch (e) {
    if (e instanceof UsernameExistsException) throw new EmailTaken();
    throw e;
  }
}

/** Which company the account belongs to, or null if there is no such account. */
export async function orgOf(email: string): Promise<string | null> {
  try {
    const r = await client.send(new AdminGetUserCommand({ UserPoolId, Username: email }));
    return r.UserAttributes?.find((a) => a.Name === "custom:org")?.Value ?? null;
  } catch {
    return null;
  }
}

/** Put the person in exactly the group for this role (employee = no group). Takes effect when their token is next renewed. */
export async function setRole(email: string, role: Role): Promise<void> {
  for (const g of GROUPS) {
    if (g === role) continue;
    try {
      await client.send(new AdminRemoveUserFromGroupCommand({ UserPoolId, Username: email, GroupName: g }));
    } catch {
      /* not in that group */
    }
  }
  if (role !== "employee") await client.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: email, GroupName: role }));
}
