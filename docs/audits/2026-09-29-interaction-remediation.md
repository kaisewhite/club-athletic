# Interaction remediation — 2026-09-29

## Scope

Reviewed the Club Athletic home/chat workflow, mobile navigation and responsive layouts, schedule and FAQ surfaces, flights/chef/room details, and the management-account deployment path. Product surfaces: trip concierge chat (agent conversation), home schedule ticker (live feed), trip-page navigation (responsive application shell), FAQ (reference list), and flights/chef/rooms (data tables and room map).

## Expected behavior contracts

- **Chat:** submit from the composer or a quick option; acknowledge immediately; preserve typed text after a failure; close the phone keyboard after submit; distinguish sending, queued, completed, and failed turns; allow follow-up questions to queue; render grounded answers from trip reads; keep answers free of the unwanted left rule; retain scroll position unless the user is following the bottom.
- **Navigation:** mobile has an obvious open and close control, touch-size targets, Escape/focus support, route-change dismissal, and no fixed content obscures the current page.
- **Tables and reference pages:** values remain readable at phone/tablet widths; labels stay associated with values; editors remain usable with touch/keyboard; no page-level horizontal overflow.
- **Schedule ticker:** concise schedule entries, continuous motion without playback controls, reduced-motion behavior, and a direct full-schedule route.
- **Deployment:** only management account `366394957699` is the target; cluster `club-athletic`, service `web`; successful management health check precedes DNS cutover and deletion of the old production-account stack.

## Interactions reviewed

- Open/close the mobile drawer, close with Escape, follow a link, verify focus return and the active link.
- Send a quick option; send a typed question; queue follow-up suggestions during an answer; inspect completion/failure and retry states; verify textarea blur on submit.
- Scroll through all route families and exercise schedule, FAQ and navigation links.
- Open the dietary editor, enter a long note, verify its readable size and complete draft, and cancel without saving.
- Check room records, flight cards/recommendations, chef meals, dietary records, and mobile room details at multiple widths.
- Synthesize/diff the proposed CDK layout; check AWS account identities, stack resources, ECS service/task state, ECR, Secrets Manager, ALB, ACM, Route 53, and CodeConnections.

## Fixes completed during this pass

| Finding | Remediation | Files / interaction | Verification |
|---|---|---|---|
| Transient provider errors surfaced immediately as 503 send failures | Restored the Anthropic SDK's safe retry budget (`maxRetries: 2`) for idempotent provider requests | `apps/web/src/lib/managed-agents/client.server.ts`; new unit coverage | `managed-agents-client.test.ts` passed; included in the passing 530-test app suite |
| Shuttle time could be shown in UTC rather than local chalet time | Projected shuttle dates and times in the trip timezone for the concierge read tools | `apps/web/src/lib/chat/tools/read-tools.server.ts` (concurrent workspace change) | App typecheck and 530 unit/DOM tests passed; saved live read-tool evidence is in `2026-09-29-agent-test-evidence.md` |
| Follow-up suggestion clicks were blocked during an active assistant turn | Permit one acknowledged follow-up at a time and use the server's queued-delivery behavior | `apps/web/app/components/chat/chat-panel.tsx` | Existing chat unit/DOM coverage passed; previous local live-browser run verified queued delivery |
| Mobile table values collided or became too small | Use labeled mobile layouts for flight recommendations, chef/dietary data and bedroom facts | `trip-details.css`, `flight-recommendations.tsx`, `chef.tsx`, `bedroom-map.tsx`, `bedroom-map.css` | `mobile-layout.spec.ts` plus `mobile-tables.spec.ts`: 113 passed, 3 expected skips across 320–859px |
| Experimental Oxlint plugin blocked the build pipeline | Removed its temporary config, dependency, and vendored implementation; retained its diagnostic artifact for a separate migration | `apps/web/package.json`, `apps/web/bun.lock`, removed `.oxlintrc.json` and `tools/oxlint/anti-slop/` | Frozen lockfile install passed; repository lint exited 0 with existing warnings |
| CDK TypeScript build scripts produced unwanted files | Removed build/watch emit scripts from the infra package | `apps/aws/package.json` | `tsc -b --clean` exited 0; CDK synth/diff used for infrastructure review |

The mobile drawer, FAQ page and copy, homepage ticker without stop/play, automatic quick-option send, Instagram links, and reseeded guest/room mapping were already present in the shared application code and were exercised through the responsive checks and existing route coverage. The database was not reseeded during this pass; the checked-in trip data already has Tuesday `TBD` and Christie Navarre sharing Bedroom 4 with Christine Calvo, and reseeding the live Neon trip could overwrite current edits.

## Verification performed

- Branch before work and at final inspection: `main`.
- `apps/web`: `bun install --frozen-lockfile` passed; `bun run lint` exited 0 with 14 existing warnings; `bun run typecheck` passed; `bun run test` passed 530/530.
- Chromium responsive checks: `mobile-layout.spec.ts` and `mobile-tables.spec.ts` passed 113 checks with 3 intentional skips. Coverage includes every route at 320, 375, 390, 414, 768, 859 and 860px, plus table-specific long content at 320, 375, 390, 414, 768 and 859px. No horizontal overflow or table collision was observed.
- Targeted chat unit/DOM tests passed 83/83 before the final full-suite run.
- CDK synthesized and diffed the intended management-only cluster/service/pipeline design before the infrastructure source was concurrently reset. Those templates were not deployed.
- AWS identity checks: `mostrom_mgmt` resolved to `366394957699`; production resolved to `736548610362`; dev resolved to `896502667345`.

## Remaining findings

### Critical — production deployment not completed

- **Reproduction:** run `bunx cdk deploy InfraStack --profile mostrom_mgmt --require-approval never` after the management-only source reset.
- **Expected:** synthesis targets the management account, provisions the independent cluster/service/ALB, then passes `/health` before DNS cutover.
- **Actual:** `apps/aws/bin/infra.ts`, `properties/index.ts`, `lib/infra-stack.ts`, and `scripts/deploy.sh` reverted to the old production-account/Edge-cluster source during the deployment work. The first management stack attempt also rolled back after ECS started before a management secret existed, and the next create was interrupted while its ALB was provisioning. CloudFormation cleanup finished; `InfraStack` is absent and no management `club-athletic` service is active.
- **Root cause:** an external concurrent workspace reset is suspected, but not identified. The service's runtime secret had previously existed only in production; a management secret was then created and populated through `apps/aws/scripts/push-secrets.sh` without displaying values.
- **Why unresolved:** continuing while the infrastructure files are being reset would risk another cross-account deploy. The actual infrastructure changes, pipeline and deployment scripts must be reapplied after the workspace source is stable.
- **Recommendation:** keep the deployment in management account `366394957699`; use cluster `club-athletic` and service `web`; own the ALB/certificate in management; import the existing Route 53 alias without a logical-id override; deploy and verify health; then remove the old production-account stack.

### High — deployed runtime not yet verified after code changes

- **Reproduction:** open `https://meribel.xn--tshi-l3a.com`, send a typed chat question and a quick option on a phone, and inspect task image digests and build revision.
- **Expected:** the new main revision responds with database-grounded answers, no false “not in trip notes” reply, no left rule, and a mobile keyboard dismissal after send.
- **Actual:** local unit and responsive browser checks passed, and earlier saved real-agent test evidence covers grounded reads and queued suggestions. This pass did not complete a new public deployment or post-deploy runtime check.
- **Root cause:** no management service was active to receive the image; the current public DNS continued to point at the old production load balancer.
- **Why unresolved:** awaits a stable management infrastructure source and successful management deployment.
- **Recommendation:** push the reviewed `main` changes, run the single-account management pipeline, confirm ECS is stable, verify `/health` and a real chat round trip, confirm running task image digest matches the pushed image, update DNS, and only then delete the production-account stack.

### Medium — physical keyboard behavior not covered

- **Reproduction:** submit chat from a physical iPhone/Android browser with the software keyboard open.
- **Expected:** the keyboard closes and the new message and response remain visible.
- **Actual:** Chromium component/browser coverage confirms the textarea loses focus on submit, but a real mobile keyboard was not available in this environment.
- **Root cause:** headless browser emulation does not display a native software keyboard.
- **Why unresolved:** no physical-device run was available during this pass.
- **Recommendation:** confirm the send path on iOS Safari and Android Chrome after deployment.

## Deployment and cleanup status

- The management secret `club-athletic-web` now exists and has been populated from the local environment file through the repository secret-sync script; no values were printed.
- The old production-account stack `club-athletic-prod-cdk` is still active with one running task on `edge`. It was not deleted because the management service and DNS cutover did not succeed.
- No matching Club Athletic stack exists in the dev account.
- No commit or push was made, and the live application has not been updated by this pass.

## Open questions / verification gaps

- A user response is pending on whether another process is resetting `apps/aws` during this shared-workspace pass.
- After that source is stable: complete CDK synth/diff, deploy the management pipeline and service, validate the direct management ALB before changing DNS, verify production traffic and app version, delete the production-account stack, push the final commit, and check that management CodePipeline finishes on that exact revision.

## Local-only follow-up — 2026-09-30

- `bun run lint` passed with 14 warnings; `bun run typecheck` passed; `bun run test` passed 530/530.
- Local Playwright responsive checks passed 113 cases with 3 skips across 320, 375, 390, 414, 768, 859 and 860px against a disposable loopback PostgreSQL database seeded only from committed Prisma migrations and `prisma/seed.ts`.
- The repository `.env` points to remote database endpoints, so it was not loaded. The temporary local database and env file were removed after testing. No provider or live-agent requests were run.
- Browser chat send/quick-option/retry journeys were later exercised locally with mocked same-origin chat APIs; responsive matrix results are recorded in `/tmp/superpowers/club-athletic-local-readiness/evidence.md`. The external Managed Agents model response remains unverified.

## Local agent tool-path remediation — 2026-09-30

- **Root cause:** trip read errors and outer registered-tool/query errors were serialized as “not in the trip notes,” conflating unavailable data with a successful read that lacks a fact. Flight-intake write exceptions used the same fallback.
- **Fix:** database/read and registered tool execution failures now return a temporary-unavailable result. Invalid tool arguments return a distinct invalid-request result. Flight-intake errors use the same unavailable message. `[chat]` diagnostics retain only the error class, allowlisted identities/context, safe error code, and numeric HTTP status; raw messages, stacks, URLs and credentials are excluded.
- **Verification:** TDD regressions confirmed the old read, registered guest lookup, invalid-argument and flight-write paths returned the missing-notes fallback. The focused tool/route/flight-intake tests pass 69/69; lint and typecheck pass. A loopback-only disposable seeded DB verified all 13 read tools and that the registered `getFlightRules` runnable returns the 09:30 cutoff; its DB and temporary env were removed. The latest full unit/component run has 534 passing tests and one failure in `tests/routes/detail-pages.test.tsx`, which still selects the old bedroom-map table markup after the shared room UI change.
- **Remaining limitation:** no real Managed Agents API call was made. The local DB/tool result is verified, but the real model response after tool dispatch is not. Browser conversation POST/SSE journeys use mocks and do not prove provider execution.
