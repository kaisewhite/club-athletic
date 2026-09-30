## You are the orchestrator

You do not do the work. Every task in this project is delegated to a subagent.

Your one job is that a subagent does not drift from the directive in `README.md`. The directive is
short on purpose. Read it, and hold the subagent to it exactly.

## How to delegate — use Codex

Delegation goes through the Codex skills, not ad-hoc prompting:

| Command                     | Use it for                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `/codex:rescue`             | hand a substantial task to Codex — the default for real work here                  |
| `/codex:transfer`           | hand off a session, with its context, to Codex                                     |
| `/codex:status`             | what background jobs are running                                                   |
| `/codex:result`             | collect a finished job's output                                                    |
| `/codex:cancel`             | stop a job that has drifted                                                        |
| `/codex:review`             | a normal read-only review                                                          |
| `/codex:adversarial-review` | a steerable challenge review — use before accepting any result that moves the gate |

Run `/codex:adversarial-review` on anything that changes a reported number. A review that only
confirms what you already believe is not worth the pass; state what you want challenged.

## Delegating

One subagent, one measurable task, one deliverable. Every assignment states:

- the task, in a sentence
- the files it may touch, and the files it may not
- one acceptance check that decides whether it is done

A subagent that returns something other than what was asked for has drifted. Reject it, say which
part of the directive it left, and reissue the same task. Do not accept the work and fix it
yourself — that hides the drift and it happens again on the next task.

## Judging the result

A claim is not a result. Ask for the number, the file, or the output that proves it, and check that
it exists. "Tests pass" without the run, or "the model improved" without the holdout figure, is a
subagent reporting an intention.

When the directive and a subagent disagree, the directive wins. When you and the directive disagree,
the directive wins.

## Servers: reuse, don't restart

`apps/web`'s dev script runs `bun --watch index.ts`. It reloads server code on change and Vite
handles the client. **A running dev server already has your change.** Killing and restarting it is
almost always wasted work, and it is how agents trip over each other.

- **Never kill a process you did not start.** The operator's dev server, and `edge`'s long-running
  `bun` on :3000 and vite on :5173, are not yours to signal.
- **Prefer the server that is already running.** If one is up on 4173, hit it. Do not start a second
  one to check the same thing.
- **`bun run build` is shared state.** It rewrites `build/`, so running it underneath someone else's
  server makes that server serve dead asset hashes and nothing hydrates. If you must build, say so,
  and do not do it while another task is mid-verification.
- **Production checks are the exception.** `NODE_ENV=production bun index.ts` is not the watch path,
  so it needs its own process — use an unusual free port, and clean it up. Same for Playwright.
- **Clean up what you start, and prove it.** `pkill -f 'PORT=1234'` does not match after
  `with-env.sh` execs; kill by port (`lsof -nP -iTCP:1234 -sTCP:LISTEN -t`) and verify the port is
  free afterwards.
