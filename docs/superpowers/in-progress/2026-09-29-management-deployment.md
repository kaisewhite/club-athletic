# Club Athletic Local Readiness and Management Deployment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish and verify every requested app fix locally before configuring CI/CD or deploying; then deploy exclusively to management account `366394957699` through a tested CodePipeline.

**Architecture:** Work in four gates, in order: remediate the local app; verify local behavior and close the outstanding-request checklist; configure CDK and a management-only pipeline with isolated CI end-to-end tests; then bootstrap/deploy management and remove the obsolete production stack after traffic is healthy on management. There are no manual app/CDK deployment scripts. The one-time CDK bootstrap uses the user's exact CDK CLI command from `apps/aws`; later application deploys happen by pushing `main`.

**Tech Stack:** React Router, Bun, Playwright, AWS CDK v2, CodePipeline/CodeBuild, ECS Fargate, ECR, ALB, ACM, Route 53.

---

## File map

- `apps/web/app/components/chat/chat-panel.tsx` and chat routes/server tools — reliable desktop/mobile sending, quick-option auto-send, mobile keyboard dismissal, useful in-flight/error states, database-backed answers, no unwanted response rule.
- `apps/web/app/components/*`, `apps/web/app/routes/*`, responsive styles — mobile navigation, readable tables, requested schedule/FAQ/home presentation, consistent trip details and social links.
- `apps/web/tests/**`, `apps/web/playwright.config.ts`, `apps/web/package.json` — local unit/component/browser acceptance using local app and test fixtures; never target production from a test run.
- `apps/aws/bin/infra.ts`, `apps/aws/properties/index.ts`, `apps/aws/lib/infra-stack.ts` — management-only CDK app stack; account fixed to `366394957699`, cluster `club-athletic`, service `web`.
- `apps/aws/lib/pipeline-stack.ts`, `apps/aws/lib/pipeline-buildspec.ts` — Source, Build, End-to-end, Deploy; CI test environment isolated from production.
- `apps/aws/scripts/deploy.sh`, `apps/web/scripts/deploy.sh`, `apps/aws/package.json`, READMEs — remove manual deployment paths and document pipeline flow and initial CDK bootstrap.
- `docs/audits/2026-09-29-interaction-remediation.md`, `docs/audits/2026-09-29-agent-test-evidence.md` — record actual local/pipeline evidence and unresolved gaps.

## Task 1: Fix the app locally and close the requested-work checklist

**Files:**
- Review/fix: `apps/web/app/components/chat/chat-panel.tsx`, chat API/routes, `apps/web/src/lib/chat/**`, `apps/web/src/lib/managed-agents/**`
- Review/fix: mobile navigation, schedule ticker, FAQ/home, table and detail page components/styles, Instagram links/data
- Update: `docs/audits/2026-09-29-interaction-remediation.md`, `docs/audits/2026-09-29-agent-test-evidence.md`

- [x] **Step 1: Confirm the existing local app, data, and test setup**

Inspect the local chat/API/database wiring and current test fixtures. Keep production credentials and production endpoints out of browser E2E runs. Record the local start command and required local test configuration without printing secret values.

Local configuration and server command recorded in `/tmp/superpowers/club-athletic-local-readiness/evidence.md`: temporary env used loopback-only `DATABASE_URL` and `DATABASE_URL_POOLED` values for disposable PostgreSQL at `127.0.0.1:5432`, with `PORT=47317`; Playwright starts the app using `bun run build && NODE_ENV=production PORT=47317 bash scripts/with-env.sh bun index.ts` and checks `http://127.0.0.1:47317/`.

Rerunnable local-only setup, from `apps/web` (the Playwright config refuses a missing env file and rejects remote database hosts before starting the server):

```sh
set -eu
mkdir -p /tmp/superpowers/club-athletic-local-readiness
db_name="club_athletic_local_readiness_$(date +%s)_$$"
env_file="$(mktemp /tmp/superpowers/club-athletic-local-readiness/env.XXXXXX)"
db_created=0
cleanup() {
  result=$?
  trap - EXIT
  if [ "$db_created" -eq 1 ]; then
    psql -h 127.0.0.1 -d postgres -c "DROP DATABASE \"$db_name\"" || result=1
  fi
  rm -f "$env_file" || result=1
  exit "$result"
}
trap cleanup EXIT
psql -h 127.0.0.1 -d postgres -c "CREATE DATABASE \"$db_name\""
db_created=1
cat > "$env_file" <<EOF
ANTHROPIC_API_KEY=local-mocked-provider-key
DATABASE_URL=postgresql://kaisewhite@127.0.0.1:5432/$db_name?sslmode=disable
DATABASE_URL_POOLED=postgresql://kaisewhite@127.0.0.1:5432/$db_name?sslmode=disable
PORT=47317
EOF
export CLUB_ATHLETIC_WEB_ENV_FILE="$env_file"
bash scripts/with-env.sh bunx prisma migrate deploy
bash scripts/with-env.sh bun prisma/seed.ts
bunx playwright test tests/visual/mobile-layout.spec.ts tests/visual/mobile-tables.spec.ts --project=desktop-1280
```

The app server uses the parsed values from `CLUB_ATHLETIC_WEB_ENV_FILE`, and the Playwright config starts it on `127.0.0.1:47317` with `reuseExistingServer: false`. The EXIT trap removes only this run's env file and drops its unique DB only after CREATE succeeds.

- [ ] **Step 2: Fix chat send and recovery behavior locally**

Verify desktop and mobile sends create one user message, acknowledge promptly, disable duplicate submission while in flight, receive a response, and expose an actionable error/retry state if the request fails. Quick options must send immediately. On mobile, sending closes the keyboard so the conversation is visible. Remove false “Not delivered” states on successful sends and remove the unwanted vertical rule from assistant responses.

- [ ] **Step 3: Fix database-backed agent answers locally**

Trace the question-to-tool/database path for trip facts and correct any missing tool registration, data mapping, or error handling. A question whose answer exists in the database must return that answer. Distinguish an actual missing fact from unavailable infrastructure; do not mask backend errors as “not in trip notes.”

- [ ] **Step 4: Finish requested mobile, navigation, content, and data presentation**

Verify the mobile sidebar has accessible open/close controls; all tables remain readable at narrow widths; schedule ticker is compact and continuous without play/pause controls; FAQ is a separate page; homepage content follows the requested chat-first layout; trip date/address details are not redundantly displayed; FAQ location is “Les 3 Vallées · France”; schedule chef indicators are omitted and unknown items display `TBD`; Instagram links map to the agreed people/rooms/chef rows.

- [ ] **Step 5: Check off local acceptance criteria**

Use this checklist as the gate before any CDK/deployment work:

  - [ ] Desktop free-form chat sends once and receives a database-backed response.
  - [ ] Mobile free-form chat sends once; keyboard closes; response is visible.
  - [ ] Quick options populate and automatically send once on desktop and mobile.
  - [ ] Loading, success, failure, edit/retry behavior is clear and truthful.
  - [ ] Existing database facts are answerable; real missing data is described accurately.
  - [ ] No unwanted assistant quote/left rule appears.
  - [ ] Mobile sidebar opens, navigates, and closes via touch and keyboard.
  - [ ] Schedule ticker and FAQ/home requirements match the requested design/content. (Partial Playwright coverage only: `mobile-layout.spec.ts` checks FAQ answer line count, page overflow, and ticker scroller geometry; it does not verify the full requested content/design criteria.)
  - [ ] Every table and detail surface is readable at supported mobile widths without page overflow. (Partial Playwright coverage only: mobile layout checks route-level overflow, room/chef/task/flights layouts; mobile table checks cover flight recommendations and chef dietary rows/editors at 320, 375, 390, 414, 768 and 859px. Other tables/details remain unverified.)
  - [ ] Instagram links and guest/room/chef mappings match the agreed list.

## Task 2: Prove local readiness before touching deployment infrastructure

**Files:**
- Test: `apps/web/tests/**`, Playwright configuration and test fixtures
- Evidence: `/tmp/superpowers/club-athletic-local-readiness/`

- [x] **Step 1: Run local code checks**

From `apps/web`, run the project's lint, typecheck, and unit/component test commands. Fix failures before moving on. Do not run infrastructure `npm run build` or TypeScript emitting builds.

- [ ] **Step 2: Run the browser acceptance matrix against local app only** (partial: mobile layout/table suites passed locally; chat flows, 412/820px, landscape, 1280×800 and 1440×900 remain untested; see `/tmp/superpowers/club-athletic-local-readiness/evidence.md`)

Run Playwright with a locally started app and local/isolated test data. Cover phone portrait `320×568`, `375×812`, `390×844`, `412×915`; tablet `768×1024`, `820×1180`; one landscape viewport; desktop `1280×800`, `1440×900`. Exercise chat, quick options, mobile keyboard behavior, navigation drawer, schedule/FAQ, tables, and recovery states. Configure the test to fail if its base URL is the production hostname.

- [ ] **Step 3: Check off the acceptance list with evidence** (open: chat journeys and the remaining viewport matrix lack local browser evidence; see `/tmp/superpowers/club-athletic-local-readiness/evidence.md`)

Save command output, Playwright report/screenshots, viewport results, and local chat transcript under `/tmp/superpowers/club-athletic-local-readiness/`. Mark each Task 1 acceptance checkbox complete only after evidence passes. Do not start CDK deployment work until every in-scope local criterion is checked or a specific blocker is documented.

## Task 3: Configure CI/CD to build and test before deployment

**Files:**
- Modify: `apps/aws/lib/pipeline-stack.ts`
- Modify: `apps/aws/lib/pipeline-buildspec.ts`
- Modify: `apps/aws/properties/index.ts`, `apps/aws/bin/infra.ts`
- Delete: `apps/aws/scripts/deploy.sh`, `apps/web/scripts/deploy.sh`
- Modify: `apps/aws/package.json`, `apps/aws/README.md`, repository `README.md`

- [ ] **Step 1: Match the Edge pipeline pattern**

Follow `edge/apps/infrastructure/aws/resources/pipelines/platform/index.ts` and `buildspec.ts`: Source from GitHub `main`; Build creates the app image; an E2E CodeBuild action runs the full local/isolated Playwright acceptance suite; only successful build and E2E stages can enter Deploy. Keep the tests within CI and never direct them to the production hostname or production database. Include `/health` deployment verification in the pipeline deploy action.

- [ ] **Step 2: Give E2E an isolated runtime**

Run a production-mode app build inside CodeBuild with a disposable test database/fixtures and test-only settings. E2E must validate the real browser/app flow without reading or writing the production trip database. Preserve Playwright reports as pipeline artifacts. Fail the pipeline on failed end-to-end checks.

- [ ] **Step 3: Pin all CDK resources to management and remove manual deployment scripts**

Set CDK stack account to `366394957699`, region `us-east-1`; set the service to `web` on cluster `club-athletic`. Remove profile-selecting deployment scripts and their aliases. Do not add cross-account deploy roles, prod/dev stages, logical ID overrides, or hardcoded hosted-zone IDs outside `apps/aws/properties/index.ts`.

- [ ] **Step 4: Synthesize and inspect CDK without deploying**

From `apps/aws`, run:

```sh
cdk synth --profile mostrom_mgmt && cdk diff --profile mostrom_mgmt --all
```

Expected: all stack environments target account `366394957699`; there are Source, Build, E2E, Deploy stages; the E2E stage uses isolated test data; no application browser test points to production; no dev/prod resources or cross-account assumptions appear.

## Task 4: Deploy only after local and pipeline gates pass

**Files:**
- Management infrastructure and pipeline stacks
- DNS in the management hosted zone
- Evidence: `/tmp/superpowers/club-athletic-management-deployment/`

- [ ] **Step 1: Confirm gates and AWS identity**

Verify all Task 1/2 local acceptance boxes are checked, the pipeline diff includes isolated E2E before Deploy, and `aws sts get-caller-identity --profile mostrom_mgmt` returns account `366394957699`. Do not issue deployment commands if any check fails.

- [ ] **Step 2: Bootstrap management stacks with the approved CDK command**

From `apps/aws`, run exactly:

```sh
cdk synth --profile mostrom_mgmt && cdk deploy --profile mostrom_mgmt --all --require-approval never
```

No deployment wrapper script and no `bun`/`bunx` invocation. Confirm every deployed stack is in management. This one-time bootstrap creates the infrastructure and pipeline; subsequent app deployments are triggered only by pushes to `main`.

- [ ] **Step 3: Push the verified code and let CodePipeline deploy**

Commit and push the accepted `main` revision. Verify the management pipeline runs Build and E2E successfully before Deploy, then reports deployment success for cluster `club-athletic`, service `web`. Confirm the deployed task image digest/source revision matches the pushed commit. The pipeline itself performs the service health check; do not run browser tests against production.

- [ ] **Step 4: Switch DNS and remove the obsolete production stack**

After the management deployment is healthy and the pipeline health check succeeds, point the management hosted-zone alias to the management ALB. Verify the pipeline's deployed endpoint check succeeds. Then use production credentials solely to delete the mistakenly created production CloudFormation stack and any stack-owned ECS resources. Never deploy/update/create resources in production or dev. Confirm no Club Athletic prod/dev stack or running service remains.

## Task 5: Final real-user acceptance validation through CI/CD

**Files:**
- Evidence: `/tmp/superpowers/club-athletic-management-deployment/proof.json`
- Evidence: `/tmp/superpowers/club-athletic-management-deployment/validation/`

- [ ] **Step 1: Verify local readiness record**

Confirm the local test report, acceptance checklist, and local chat workflow evidence from Task 2 are complete before the deployment pipeline is considered eligible.

- [ ] **Step 2: Verify the pushed revision's pipeline run**

Confirm CodePipeline source revision equals the pushed `main` SHA; Build and E2E passed; E2E report covers the required viewports and workflows using isolated fixtures/database; Deploy passed the management service health check; ECS is stable with one running service task and the expected image digest.

- [ ] **Step 3: Record evidence and clean up task-owned processes**

Save local and CI test reports, pipeline revision/stage results, AWS management account/cluster/service/image digest, health check result, production stack deletion result, and cleanup verification in `proof.json` and `validation/`. Stop only browsers/servers started for local validation and verify they exited; preserve preexisting user-owned processes.

- [ ] **Step 4: Resolve any failed acceptance gate before handoff**

If local tests, the CI E2E stage, deployment, or management health check fails, fix the cause and rerun the affected full gate before reporting completion. Never substitute a production browser test for a failed CI acceptance run.
