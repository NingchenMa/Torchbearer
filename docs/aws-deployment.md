# Torchbearer on AWS: design and tech decisions

Status: **live for testing**, branch `aws` of `github.com/NingchenMa/Torchbearer`.
Last updated: 2026-11-05.

| | |
|---|---|
| App | https://aws.d32tnuo1sla34.amplifyapp.com (Cognito sign-in, invite-only; opens on the workflow vault) |
| AWS account / region | `744438387719` / `us-east-1` (N. Virginia, same area as the Vercel deployment) |
| Previous hosting | Vercel, https://ai-apprentice-chi.vercel.app (kept running unchanged as the fallback) |

---

## 1. What the app needs from hosting

- A **Next.js 16 app** with pages plus server API routes (`src/app/api/*`). The routes call Gemini and ElevenLabs with secret keys, so they must run on a server, not in the browser.
- **HTTPS**, because the browser only allows the microphone and screen sharing on secure sites.
- A place to **save JSON documents**: workflows (with embedded screenshots), learner progress, and the supervisor's review batch. Today this is about 3 MB in 22 files.
- No user accounts yet, no relational queries, low traffic (team testing and VC demos).

## 2. Architecture

```
Browser (Chrome)
  │  HTTPS, password protected
  ▼
AWS Amplify Hosting ── Next.js pages + API routes (server code)
  │        │                     │
  │        │ IAM compute role    │ API keys (Amplify env vars)
  │        ▼                     ▼
  │   Amazon S3 bucket       Gemini (screen reading, coach, Work Map)
  │   torchbearer-data-…     ElevenLabs (session token for the voice agents)
  │
  └─ The voice itself runs directly between the browser and ElevenLabs (WebRTC), not through AWS.
```

| Piece | AWS service | Resource name |
|---|---|---|
| Hosting + server routes | Amplify Hosting (WEB_COMPUTE) | app `torchbearer` (`d32tnuo1sla34`), branch `aws` |
| Data | S3 | `torchbearer-data-744438387719` |
| Server permissions | IAM role | `torchbearer-amplify-compute` (S3 read/write/delete on that one bucket only) |
| Secrets | Amplify branch environment variables | `ELEVENLABS_*`, `GEMINI_API_KEY`, `S3_BUCKET`, `S3_REGION` |

## 3. Decisions

### D1. Hosting: AWS Amplify Hosting
**Chosen** because it runs Next.js server routes without managing servers, deploys on every `git push`, gives HTTPS and per-branch URLs for free, and has one-click rollback.

| Option | Why not (for now) |
|---|---|
| ECS / Fargate, EC2 | Containers or servers to run and patch; more setup and cost than a 2-person team needs before product-market fit |
| Lambda + API Gateway by hand | Would need a Next.js adapter and more moving parts; Amplify does this for us |
| Stay on Vercel | Works well, but sits outside AWS credits and the AWS architecture we pitch |

**Trade-off to watch:** Amplify cuts a server request off at about **30 seconds**. See D5.

### D2. Data store: S3 now, PostgreSQL later, not DynamoDB
**Chosen now: S3.** The app already stores whole JSON documents by path (`workflows/<id>.json` etc.). S3 maps one-to-one (`get`/`put`/`delete`), so only `src/lib/db.ts` changed and nothing else in the app did. Versioning is on, so any overwritten or deleted file can be restored for 30 days.

**Why not DynamoDB:** a DynamoDB item is limited to **400 KB**. Workflows embed their screenshots as base64 images; a real 10-step workflow is already **421 KB**, and longer ones will be bigger. DynamoDB also requires knowing all query patterns up front, which we don't yet.

**Later (first pilot customer): Aurora PostgreSQL + S3 for images.** Once there are companies, users, and supervisor analytics ("which steps do new hires get wrong most often?"), the data is relational. Plan: screenshots become separate S3 files, everything else moves to Aurora PostgreSQL Serverless v2. Estimated effort: 1–2 days.

**Known limitation of S3 today:** `workflows/index.json` is read, changed and written back. Two saves at the same moment can overwrite each other. Acceptable at demo scale; PostgreSQL removes it.

### D3. Sign-in: Amazon Cognito, one company per account (done 2026-11-06)
**Chosen:** Cognito user pool `torchbearer-users` (`us-east-1_YyfcIjRiS`, Essentials tier, managed login at `torchbearer.auth.us-east-1.amazoncognito.com`). Invite-only: self sign-up is off so strangers can't spend our Gemini and ElevenLabs credits; we invite people with `scripts/invite-user.sh`. (An account without a company ID would get a private workspace, `orgs/user-<id>/`.) Each account carries a company ID (`custom:org`) that users cannot change.

**How it works:** OAuth code flow with PKCE; the server swaps the code for tokens using the client secret and keeps the ID token in an httpOnly cookie for 12 hours. `src/proxy.ts` sends signed-out visitors to the sign-in page, and every API route verifies the token again (`requireUser`), including the Gemini and ElevenLabs routes, so nobody can spend our credits without signing in.

**Data separation:** every stored file lives under `orgs/<company>/` in S3 (`orgDb` in `src/lib/db.ts`). Our own team's workspace is `orgs/torchbearer/`; the old top-level files and `orgs/torchbearer-demo/` are kept as backups.

**Turned down:** the Amplify site password alone (one shared password, no per-company data); Amplify's own auth library (client-side tokens, more code in the browser).

### D3b. Roles: Cognito groups (admin, manager, employee)
**Chosen:** a person's role is their Cognito **group**: `admin`, `manager`, or no group (= employee). Cognito puts the groups in the ID token (`cognito:groups`), so `userFromToken` reads the role with no extra call and no new permission. The rules live in `src/lib/roles.ts` and every API route enforces them; the pages only use the role to decide what to show.

| Role | Sees | Can do |
|---|---|---|
| Admin, Manager | every workflow, review and assignment in their company | open, edit, approve and delete any workflow; review any practice session; assign workflows to employees |
| Employee | only the workflows they recorded, and the work assigned to them | open and approve their own workflows; review practice sessions on them; train on what is assigned to them |

A workflow's owner is the recorder's Cognito user ID (`ownerId`), never their display name. Workflows saved before owners existed have none, so only a manager or admin can open them.

**One-time setup:** create the two groups, then invite people with a role (the script adds them to the group).

```bash
aws cognito-idp create-group --region us-east-1 --user-pool-id us-east-1_YyfcIjRiS --group-name manager
aws cognito-idp create-group --region us-east-1 --user-pool-id us-east-1_YyfcIjRiS --group-name admin
scripts/invite-user.sh <email> "<Full Name>" <company-id> manager
```

To change an existing person's role: `aws cognito-idp admin-add-user-to-group` or `admin-remove-user-from-group`. It takes effect the next time their sign-in token is renewed (within an hour).

**Company directory:** Cognito cannot list people by company, so each person is written to `orgs/<company>/members/index.json` when they sign in (`src/lib/members.ts`). Managers pick people from it on the Assign page, so someone appears there after their first sign-in.

### D4. Secrets: Amplify environment variables
API keys are set on the Amplify branch and written to `.env.production` during the build (`amplify.yml`), which is how Amplify makes them visible to server routes. They never reach the browser. Move to AWS Secrets Manager when there is more than one environment or more people with console access.

**Server code reaches S3 through an IAM role, not access keys.** The role is attached to the branch, not the whole app, because the repo is public (AWS's recommendation for public repos).

### D5. Gemini call time limit (code change)
Locally, two screen-reading calls took 58–60 s because `src/lib/gemini.ts` tried several models one after another with no time limit. On Amplify those requests would be cut off at ~30 s with an unclear error.
**Change:** all model attempts in one request now share a **25 s budget** (`GEMINI_BUDGET_MS` to override). If time runs out, the route returns a clean error and the client tries again with the next screen frame.

### D6. Region: us-east-1
The Vercel deployment runs in Washington DC (`iad1`), so `us-east-1` keeps latency the same. It also has the widest service availability and the lowest prices.

## 4. Cost (us-east-1 list prices, estimates)

| Phase | AWS cost / month |
|---|---|
| Now (team testing + demo) | **~$3–10**: Amplify builds and server time, S3, logs |
| Sign-in + vault + demo video | **+$0–1**: Cognito is free up to 10,000 monthly active users; the video adds $0.15 per GB served (about 1,000 plays per $0.85) |
| Pilot (adds Aurora PostgreSQL) | **~$20–80** |

AWS is not the main cost. **ElevenLabs** (per voice minute) and **Gemini** (per screenshot / call) are, and they cost the same on any host. AWS Activate Founders credits (~$1,000) would cover AWS for a long time.

## 5. How to work with it

**Run locally**
```bash
cp .env.example .env.local     # fill in keys; add S3_BUCKET, S3_REGION, AWS_PROFILE
npm run dev                    # UI work
npm run build && npm start     # anything involving the voice agents
```
Use the production build to test voice. In `npm run dev`, React's development mode starts, stops and restarts the voice session, and the agent's audio can get lost.

**Deploy:** push to the `aws` branch. Amplify builds and deploys automatically (~5 min). There is no deploy command.

**Roll back:** Amplify console → app `torchbearer` → branch `aws` → pick an earlier build → *Redeploy this version*.

**Restore data:** S3 console → bucket → *Show versions* → restore the earlier version of the file.

**Logs:** Amplify console → *Monitoring* → *Hosting compute logs* (CloudWatch).

**Login troubleshooting:** after several wrong-password attempts in a short time, Amplify blocks that network with `401` / `429` errors for several minutes, even with the right password. Wait about 10 minutes and try again. When changing the site password, allow a few minutes for it to apply everywhere. Pages can also be served from cache without a login check, so test the login with an API route such as `/api/workflows`.

**Test checklist after each deploy** (Chrome, one Torchbearer tab, microphone set explicitly in site settings):
1. Capture: screen share starts; the agent greets you and you can talk to it; steps appear while you work.
2. Stop → Map: steps with screenshots; save; reload, and it's still there.
3. Teach: tutor talks; a wrong decision is blocked at Save; report shows.
4. Review: flagged items with screenshots.

## 6. Open items

| Item | Owner | When |
|---|---|---|
| Decide whose accounts own the ElevenLabs and Gemini keys (the ElevenLabs key is on a personal account); move to company accounts | Team | Before VC demo |
| Rotate all API keys (they have been shared in chat and copied between machines) | Team | After VC demo |
| Merge uncommitted voice start-up fixes from local work (`useObserver.ts`, `useVoiceAgent.ts`) | Marissa | Before VC demo |
| Replace the 2023 IAM access key of user `admin`; stop using root | Marissa | This month |
| Aurora PostgreSQL | Team | First pilot customer |
| Brand the Cognito sign-in page (logo, colours) | Marissa | Before VC demo |
| Infrastructure as code (AWS CDK) for everything above | Team | With the pilot work |
