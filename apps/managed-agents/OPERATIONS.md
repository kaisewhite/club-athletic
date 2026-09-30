This standalone Bun project owns the persisted Club Athletic agent, cloud
environment and trip memory store baseline. `agents/`, `environments/`,
`memory-store.yaml`, `memory/`, the shell deployment entry points, and the
lint/typecheck/check scripts follow the layout of `edge`.
It contains one dedicated agent, no coordinator or subagents, and no skills.

`apps/web` creates a session per conversation, retrieves the persisted agent's
version, supplies its own `agent_with_overrides` including the shared trip
custom tool registry, and attaches the memory store below as a session resource. The baseline intentionally declares `tools: []`,
`mcp_servers: []`, and `skills: []`; no trip tool schema or handler is duplicated
here. The baseline system prompt matches the web prompt. Effort is persisted as
`high` because the supplied docs say a per-session effort override is ignored.
The 400-token guidance is a prompt instruction, not an enforced API limit;
Managed Agents exposes no per-session token ceiling to set.

The prompt makes answering the job and the fallback sentence the last resort.
The model answers from memory when it can, otherwise calls the trip read tools,
and only says `That's not in the trip notes yet — ask the organizer.` after
looking and genuinely finding nothing. Social turns (a greeting, a thank-you)
get a warm reply with no `Source:` line, because they state no trip fact.
`scripts/validate.ts` fails the deploy if any of those phrases is removed, and
`tests/deploy.test.ts` pins the prompt digest that `apps/web`'s own suite pins,
so the two copies of the prompt cannot drift apart unnoticed.

## Trip memory store

`memory-store.yaml` holds the store's `name` and `description`, and `memory/`
holds the seed tree published as one memory per `.txt` file (path = the file's
path under `memory/`, prefixed with `/`). Both the description and the
per-attachment instructions in `apps/web` are written for the model, not for us:
they are rendered into the session's system prompt.

Only STABLE facts are seeded: the dates, the resort, the chalet and its
amenities, the bedroom and bed-type layout, both shuttle windows, the flight
timing rules and the Friday-arrival option, the chef meal counts, the eight-day
schedule, the price range with its inclusions, and the link list. Anything that
changes is deliberately absent, because a seeded copy would go stale and the
model would state it confidently: how many beds are still available, who is in
which bed, the flight table, anyone's booking or payment status, and guest task
status all stay on `getOpenSpots`, `getRoomsByFloor`, `getFlightTable` and
`getGuestTasks`. `/README.txt` and the store description both say so, and the
prompt tells the model that a tool result always beats a memory file.

Never write a secret, credential, booking reference, email address or phone
number into `memory/`. Memories are returned verbatim into every later session
that mounts the store, so a value written once is replayed indefinitely.
`readMemorySeeds` refuses a seed that looks like an assigned credential or
contact detail, and refuses a seed tree with no `/README.txt` live-data notice.
If something sensitive is ever published, delete the memory and redact the
affected versions (`ant beta:memory-stores:memory-versions redact`).

The mount is attached `read_only`, so a guest conversation cannot rewrite the
shared trip facts; the seed tree in this repo is the only writer.

Refreshing the facts means editing `memory/` and re-deploying: seeds are
reconciled by path, content compared by SHA-256, and unchanged files are left
alone. A changed file is updated under a `content_sha256` precondition, so a
concurrent writer is never clobbered silently. Paths this app does not own are
REPORTED and never deleted — a stale path from a rename still misleads the
agent, so remove it by hand with `ant beta:memory-stores:memories delete`.

The environment has limited networking with no hosts, package managers or MCP
servers allowed. Custom tools execute in the web app, outside that sandbox.
No database credentials belong in the agent prompt, environment, or a skill.

Local checks (no provider calls):

```sh
bun run validate
bun run test
bun run check
bash scripts/deploy.sh
bash scripts/deploy-agents.sh
bash scripts/deploy-skills.sh
```

The package has its own manifest and lockfile. Run `bun install` once to
materialise the pinned development dependencies; lint and typecheck require them.
`bun run check` (lint, typecheck, 31 offline tests) passes against that install.
Validation, deployment scripts and offline tests use Bun's built-in APIs.

Deployment is a separate, explicit operator action. Nothing is applied by the
commands above. After provisioning is authorized, supply authentication through
the operator environment or an `ant` profile. The scripts deliberately do not
source `.env`. Bun can load it explicitly when desired:

```sh
# Initial provisioning: reuse a unique existing resource by name, else create.
bun --env-file .env scripts/deploy.ts all --apply --create
# Later deploy: update existing resources only, preserving IDs.
bun --env-file .env scripts/deploy.ts all --apply
# Or, with credentials/IDs already exported or a configured ant profile:
bash scripts/deploy-agents.sh --apply
```

Deploys save resource IDs under ignored `scripts/.state/` files. If configured
IDs conflict with those files, deployment stops. Keep the state files safe;
without them the scripts try a bounded name lookup and refuse ambiguous or
truncated results. A failed lookup never becomes permission to create a resource.
Agent updates use the retrieved version for optimistic concurrency and reject
coordinators, archived resources, and resources belonging to another named app.
Re-applying an unchanged manifest is a no-op: the provider returns the SAME
version rather than minting a new one, so the deploy treats an equal version as
applied and only rejects a version that moved backwards. This is what makes the
script safe to run repeatedly.
The scripts never archive, delete, replace, create sessions, reconcile skills,
or touch vaults, and never touch a resource belonging to `edge`: adoption
matches this app's exact resource names only, and an ambiguous name stops the
deploy instead of guessing. The environment, memory store and agent operations
are separate API calls; if a later one fails, the earlier ones are not rolled
back. Re-run after resolving the
failure; saved IDs are reused. CLI calls are bounded to 30 seconds each and
provider output is not printed.

Map the saved trip agent to `CLAUDE_TRIP_AGENT_ID`, the saved environment to
`CLAUDE_MANAGED_ENVIRONMENT_ID`, and the saved memory store to
`CLAUDE_TRIP_MEMORY_STORE_ID` through the operator's secret/configuration
workflow. The memory key is the only variable this feature adds: it is the same
class of value as the other two, written by the same script into the same
`scripts/.state/` cache, and it is OPTIONAL in `apps/web` — an unset value means
sessions attach no memory and answer from the read tools, rather than failing
every chat request the way a missing required key would. No IDs are embedded in YAML. `CLAUDE_ADVISOR_AGENT_ID` is still read as
a fallback because `apps/web` currently uses that name, but it is the reference
project's advisor key and does not describe this agent; prefer the trip key and
retire the advisor one in `apps/web` when convenient. Whichever of the two is
set wins, first key first; setting both to different values is rejected.
`CLAUDE_MANAGED_VAULT_ID=${VAULT_ID}` is appended to the local `.env`; Bun expands
that alias without needing to copy the existing value. `.env.example` contains
empty values only. The current web factories send `vault_ids: []`; the alias
satisfies their configuration contract and does not grant sandbox access to
vault credentials.

YAML and CLI shapes were verified against the supplied documentation bundle:

- Agent: `shared/managed-agents-core.md` (CreateAgent fields and model effort),
  `shared/managed-agents-api-reference.md` (CreateAgent body), and
  `shared/anthropic-cli.md` (flat YAML stdin; versioned updates).
- Memory: `shared/managed-agents-memory.md` (store create, `memories.create`
  seeding, the 100 kB per-memory limit and the many-small-files preference, the
  `content_sha256` precondition, and the warning that memories are replayed
  verbatim into later sessions) and `shared/managed-agents-environments.md`
  (Resources) - memory stores attach in the session's `resources[]` at CREATE
  time only; `sessions.resources.add()` does not accept `memory_store`, and a
  session may mount at most 8 stores.
- Environment: `shared/managed-agents-environments.md` (cloud config with
  `networking.type: limited` and nested allow flags) - the nesting was additionally
  confirmed against the live API, which echoes `allow_package_managers` and
  `allow_mcp_servers` back inside `networking`. Placing them at `config` level, as
  the reference project does, is silently dropped by the provider,
  `shared/managed-agents-api-reference.md` (CreateEnvironment body), and
  `shared/anthropic-cli.md` (environment create/update stdin).

The CLI's `beta:` resource prefix sets `managed-agents-2026-04-01` automatically;
the web SDK likewise sets it on the beta resources. No explicit header hack or
Messages API token limit is added here.
