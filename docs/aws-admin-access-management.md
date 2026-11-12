# Torchbearer: set up roles and Access management (AWS admin guide)

**Purpose.** The new Torchbearer release has three roles (Admin, Manager, Employee) and an admin-only **Access management** page where an admin adds people and changes their access. The code is written. It needs four small things from you in AWS. This guide says what each one is, why it is needed, and how to check it. It contains no secrets.

**Time:** about 30 minutes, plus the normal ~5 minute Amplify build.

**Facts used below** (from `docs/aws-deployment.md`; correct them if they have changed):

| Item | Value |
|---|---|
| AWS account / region | `744438387719` / `us-east-1` |
| Cognito user pool | `us-east-1_YyfcIjRiS` (name `torchbearer-users`) |
| Amplify app / branch that serves the site | `torchbearer` (`d32tnuo1sla34`) / `aws` |
| Server role (attached to that branch) | `torchbearer-amplify-compute` |
| Data bucket | `torchbearer-data-744438387719` |
| Company id of our own team | `torchbearer` |

**What changes for users:**

| Role | What they can do |
|---|---|
| **Admin** | Everything a manager can do, plus add people and change anyone's access (Access management) |
| **Manager** | Sees every workflow, reviews practice sessions, assigns work |
| **Employee** | Sees only workflows they recorded and the work assigned to them |

A person's role is a Cognito **group** (`admin` or `manager`; no group means employee). Nothing else about sign-in changes.

**You will:**
1. Create two Cognito groups.
2. Give the app's server role four Cognito permissions.
3. Deploy the new code.
4. Create the first admin.

Do them in this order. Step 4 needs steps 1 to 3.

---

## Step 1. Create the two groups in Cognito

**Why:** The role is read from the person's group. The groups must exist before anyone can be put in one. Until they exist, adding a Manager or Admin fails.

**Console:** Cognito → User pools → `torchbearer-users` → **Groups** → **Create group**. Make two groups, exactly these names (lowercase):

| Group name | Description |
|---|---|
| `manager` | Sees every workflow, reviews and assigns work |
| `admin` | Everything a manager can do, plus Access management |

Leave **IAM role** and **Precedence** empty.

**Or with the CLI:**

```bash
aws cognito-idp create-group --region us-east-1 --user-pool-id us-east-1_YyfcIjRiS \
  --group-name manager --description "Sees every workflow, reviews and assigns work"
aws cognito-idp create-group --region us-east-1 --user-pool-id us-east-1_YyfcIjRiS \
  --group-name admin --description "Everything a manager can do, plus Access management"
```

**Check:**

```bash
aws cognito-idp list-groups --region us-east-1 --user-pool-id us-east-1_YyfcIjRiS \
  --query 'Groups[].GroupName' --output text
```

It prints `admin` and `manager` (in either order).

**Do not:** rename the groups, or add other groups with these names in different capitals. The app matches the exact lowercase names.

---

## Step 2. Let the app's server role manage people in this user pool

**Why:** The Access management page runs on the server. To create an account and to move someone between groups, the server calls Cognito's admin API. Today the server role (`torchbearer-amplify-compute`) can only read and write the S3 bucket. Without this step, the page loads but every "Add member" and every change of access fails with an error.

**Policy.** Add this as a new **inline policy** on the role `torchbearer-amplify-compute`. Do not change the existing S3 policy.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ManagePeopleInThisUserPool",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminAddUserToGroup",
        "cognito-idp:AdminRemoveUserFromGroup"
      ],
      "Resource": "arn:aws:cognito-idp:us-east-1:744438387719:userpool/us-east-1_YyfcIjRiS"
    }
  ]
}
```

**Console:** IAM → Roles → `torchbearer-amplify-compute` → **Add permissions** → **Create inline policy** → **JSON** tab → paste the policy → name it `torchbearer-cognito-people` → **Create policy**.

**Or with the CLI** (save the JSON above as `cognito-people.json` first):

```bash
aws iam put-role-policy --role-name torchbearer-amplify-compute \
  --policy-name torchbearer-cognito-people --policy-document file://cognito-people.json
```

**What these four actions allow, and what they do not:**

| Action | Used for |
|---|---|
| `AdminCreateUser` | Adding a person. Cognito emails them a temporary password. |
| `AdminAddUserToGroup`, `AdminRemoveUserFromGroup` | Changing a person's access (their group). |
| `AdminGetUser` | Checking that the person belongs to the admin's own company before changing them. |

They do **not** allow deleting users, listing all users, resetting passwords, or touching any other user pool. The resource is this one pool only.

**Check:**

```bash
aws iam get-role-policy --role-name torchbearer-amplify-compute --policy-name torchbearer-cognito-people
```

It shows the policy. In the IAM console, the role's **Permissions** tab now lists two policies: the existing S3 one and `torchbearer-cognito-people`.

**If the role is shared:** the project doc says the role is attached to the **branch**, not the whole app (the repo is public). Confirm in Amplify → app `torchbearer` → App settings → IAM roles that branch `aws` uses `torchbearer-amplify-compute`. If another branch you test on uses a different role, add the policy there too.

---

## Step 3. Deploy the new code

**Why:** The groups and permissions do nothing until the site runs the new version.

**What to deploy:** the branch `feat/dashboard-redesign` (PR #11). Merge it into `aws` (the developer will say when it is ready), or have the developer do it. Amplify then builds and deploys by itself in about 5 minutes. There is no deploy command.

**Nothing to change in Amplify settings.** No new environment variables are needed: the app finds its Cognito region from the user pool ID it already has (`COGNITO_USER_POOL_ID`). The build also installs one new package, `@aws-sdk/client-cognito-identity-provider`; that happens on its own.

**Check:** Amplify console → branch `aws` → the latest build is green and says *Deployed*. If the build fails, send the developer the build log (Amplify → the build → *Build logs*). Roll back, if you need to: choose the previous build → **Redeploy this version**.

**What existing users and data will notice** (nothing is deleted):

- Everyone who already has an account becomes an **Employee** until you promote them (Step 4 and the end of this guide).
- Workflows recorded before this release have no recorder on file. Only Managers and Admins can open them, until someone with access decides what to do with them. Employees will not see them in their list.
- The old shared review list and the old shared "New hire" progress record are no longer read. They stay in S3 untouched. New practice sessions are stored per person.

---

## Step 4. Create the first admin

**Why:** Only an admin can add people on the Access management page, so the first admin has to be made from outside the app. After this, admins make everyone else in the app and you never need the command line for people again.

**Command** (from the repo root, with AWS credentials for this account). This creates the account, emails them a temporary password, and puts them in the `admin` group:

```bash
scripts/invite-user.sh <admin-email> "<Full Name>" torchbearer admin
```

Use the company id the person belongs to. `torchbearer` is our own team's. For a customer, use their company id (lowercase letters, digits and dashes).

The role is the fourth argument: `employee` (default), `manager` or `admin`.

**Check:**

```bash
aws cognito-idp admin-list-groups-for-user --region us-east-1 \
  --user-pool-id us-east-1_YyfcIjRiS --username <admin-email> --query 'Groups[].GroupName' --output text
```

It prints `admin`. Then the admin opens the site, signs in with the emailed temporary password, and chooses a new password.

**Expected result:** the sidebar shows **Access management** under **Modules**, next to Training. Clicking it shows the people list and the "Add a member" form.

---

## Final check (about 10 minutes)

Use three test accounts in the same company: an admin (Step 4), and two you create on the Access management page: one Manager and one Employee. Each person must sign out and back in after their access changes.

| Test | Expected |
|---|---|
| Admin: Access management → add a member (name, email, employee ID, level) | Green message; the person appears in the list; they receive an email with a temporary password |
| Admin: try to add the same email again | "That email is already a member." |
| Admin: leave Employee ID empty and press Add | The field turns red with a reason; nothing is added |
| Admin: change the Employee to Manager, then back | Message "applies the next time they sign in, or within an hour" |
| Admin: look at their own row | The access dropdown is locked (an admin cannot remove their own admin access) |
| Manager: sidebar | No Access management item. Opening `/access` shows "You lack access to manage access." |
| Employee: Workflows | Only workflows they recorded. Assign shows "You lack access to assign workflows to other employees." |
| Employee: Reviews | "No reviews are assigned to you." unless someone practised one of their workflows |

**If it fails**

| Symptom | Likely cause |
|---|---|
| "Couldn't create the account" when adding a person | Step 2 is missing, or the policy has a typo in the pool ARN. Look in Amplify → *Monitoring* → *Hosting compute logs* for `AccessDeniedException` on `cognito-idp:AdminCreateUser`. |
| Adding a Manager or Admin says the access level couldn't be set | Step 1 is missing: the group does not exist, or the name is not exactly lowercase `manager` / `admin`. |
| "That email can't be added." | That email already has an account somewhere in the user pool (maybe another company). The message does not say which, on purpose. Use a different email, or ask the developer. |
| The first admin does not see Access management | They are not in the `admin` group (re-run the check in Step 4), or they signed in before the group was set. Sign out and in again. |
| A change of access does not show for the person | It applies when their sign-in is next renewed (within an hour). Signing out and in applies it now. |
| Everyone sees nothing in Workflows after the release | Expected for Employees: they only see what they recorded. Promote the people who supervise to Manager. |
| An admin locked themselves out | They cannot remove their own admin access in the app. If another admin demoted them, add them back: `aws cognito-idp admin-add-user-to-group --region us-east-1 --user-pool-id us-east-1_YyfcIjRiS --username <email> --group-name admin` |

---

## Day-to-day, after setup

- **Add or change people:** in the app, Access management (admins only). No AWS console needed.
- **Promote everyone who was there before:** an admin changes each person's access on the Access management page. They appear in the list after they have signed in once. Or from the command line:

  ```bash
  aws cognito-idp admin-add-user-to-group --region us-east-1 \
    --user-pool-id us-east-1_YyfcIjRiS --username <email> --group-name manager
  ```
  (Use `admin-remove-user-from-group` to take access away.)
- **Remove a person completely:** not available in the app. Disable or delete the account in Cognito (Users → the person → Disable user account), and tell the developer if you want the people list cleaned up.
- **Roll back the permission change:** `aws iam delete-role-policy --role-name torchbearer-amplify-compute --policy-name torchbearer-cognito-people`. The rest of the app keeps working; only Access management stops.
