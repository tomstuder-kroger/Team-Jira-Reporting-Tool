# Refresh through the Atlassian MCP (hybrid)

Status: **built, 2026-11-18 and 2026-11-19.** The design below is the original plan, kept as written. Where the build differed is under "What changed from this design". Replaces the REST credentials in the refresh path. Nothing downstream of `report.json` changes.

## What changed from this design

Measured costs are in the README table. These are the differences that matter.

- **Rows are read 40 per run, paged by ticket key**, not "one headless call for everything". Asking Claude to read and retype a whole project failed ("too large to return within budget"), and a page token (about 2 KB) cannot be relayed by hand. The app pages with `key > "ABC-123" ORDER BY key ASC` and never lets Claude carry state between calls.
- **Search goes through `executeRead` with `responseFields`, not the direct search tool**, because only `executeRead` can slim a response. That keeps emails, account IDs and descriptions out of Claude's context on the ticket step. The direct search tool is denied, so the allowlist is **only `executeRead`**, not "the search tool and the changelog tool".
- **Lean launch:** `claude -p` runs in an empty temp folder with only the Atlassian server, user settings only, no skills and no built-in tools. This cut a run from about $0.35 to about $0.03.
- **Incremental rows, not just incremental history.** After the first pull only tickets updated since the last pull (two-day look-back) are read in full. The total is checked against Jira's count; a mismatch triggers a key-and-updated-time listing (tickets that left the roster or were missed). Tickets resolved near the history cutoff are tolerated. `?full=1` forces a full read. Without this, every refresh cost $3 to $4.
- **Look first, then read (2026-11-19).** The recent window is listed by key and updated time first (short answers), and only tickets that are new or whose updated time differs are read in full. This took an ordinary refresh from 53 s and $0.34 to 31 s and $0.24. The same step serves added people and the reconcile. A parallelism setting (`REFRESH_CONCURRENCY`, default 3) and a model setting (`REFRESH_MODEL`) were added to test speed; six parallel runs gained little, and **Haiku was rejected** for copying values wrongly (see the README cost section).
- **Spending caps:** $2 per run and $5 per refresh (`REFRESH_MAX_USD`), and a **resume cache** (`data-raw/mcp-history-cache.json`) so a failed or capped refresh continues instead of starting over.
- **Roster:** the name search uses `lookupJiraAccountId` (display name and active only). Removing someone prunes their tickets locally for free; adding someone reads only their tickets. `report.json` meta records the roster at each pull.
- **Page:** a sticky progress banner (step, bar, elapsed time, spend against the limit) driven by `GET /api/refresh/status`, which returns after a page reload too.
- **Outcome of the open questions:** the MCP returns Pair, rank, start date and due date in a usable shape (custom fields keyed by display name; the names can be overridden with `fieldNames` in config). Relaying 25 tickets of history per run is reliable. **Whether the organisation allows this route is still undecided** (see `docs/data-notes.md`).

## Why

The Jira API key was revoked. The Atlassian MCP still works with the owner's own sign-in (checked: site access, a count search, and a headless `claude -p` call limited to one read tool). The header Refresh button must keep working and must stay read-only.

## Goal

Header button -> `POST /api/refresh` -> server starts headless Claude with a read-only tool allowlist -> Claude returns ticket rows -> the server validates them, merges, and writes `public/data/report.json` (version 4, unchanged).

## Not changing

`report.json` shape, `scripts/merge-lib.mjs`, `src/lib/*`, every page, the guard checks (localhost Host, same-origin, 15 s cooldown, shared in-flight call).

## Constraints

- Read-only toward Jira. The allowlist contains only the search tool and the changelog tool (and the user lookup for the Roster page). No write or destructive tool is ever allowed. Tested by asserting the argument list.
- No credentials stored or copied by the app. Claude Code holds the sign-in.
- Localhost only, as before.
- Real names, keys, site and cloud ID stay out of the repo; the cloud ID comes from the git-ignored config.

## Design

### Why Claude cannot just write the file

Claude would have to retype about 350 KB of tickets as output, slow and error-prone. So:

1. **Incremental.** The server reads the current `report.json`. A ticket whose `u` (updated) is unchanged keeps its saved row and its `h` history. Only new or changed tickets are fetched. After the first pull this is usually a few dozen tickets.
2. **Batches.** Claude is asked for at most 25 tickets per run (`BATCH`), returning one JSON array as its final answer. The server validates every row (types, dates, status strings) before use, runs batches one after another, and merges them with `mergeReport`. A bad row fails the refresh and the old file stays, as today.
3. **The server writes the file**, never Claude. Claude gets no Write or Bash permission.

### Steps in one refresh

1. Server runs the existing JQL (`buildQueries`) as one headless call that returns keys, `u`, and the row fields, no history. The expected count is cross-checked against a count-mode search; a mismatch fails the refresh.
2. Diff against the saved file: unchanged keys keep their rows. The rest go to the history step.
3. For each batch, a headless call fetches each ticket's changelog (one tool call per ticket; the MCP has no bulk call) and returns rows with `h`.
4. Merge, write atomically. Return the same summary shape as today plus how many tickets were refetched.

### Failure behaviour

An empty answer keeps the old file. A failed batch fails the whole refresh and keeps the old file. The page shows progress text while the first pull runs (it can take minutes).

### Roster page

The "Add a team member" search uses the MCP user lookup through the same runner, with the same no-email, no-account-ID rule. A typed exact-name field is kept as a fallback.

## Cost and time (to be measured, not assumed)

One trivial headless call cost about $0.35 at list price, mostly project-instruction loading. Real figures are unknown. Step 1 of the build measures a 10-ticket relay and a full first pull before anything is claimed.

## Build order

1. Runner (`server/mcpRunner.mjs`): spawn, allowlist, JSON parse, timeout, row validation. Unit tested with a fake process.
2. Diff and merge: unchanged rows reused by `u`. Unit tested.
3. Wire into `runRefresh`; keep the REST path behind `.env` credentials if present.
4. Measure: 10-ticket relay against known values, then the first full pull. Report real time and cost.
5. Roster search through the runner, plus the typed-name fallback.
6. Update `CLAUDE.md`, `README` and `docs/data-notes.md` (new third-party flow: Claude Code and the Atlassian MCP).

## Open questions

- Does the MCP search return the Pair, size, rank, start-date and due-date fields in a usable shape? Checked in build step 1.
- Is relaying 25 tickets per run reliable, or should the batch be smaller?
- Do the owner's org rules allow routing refreshes through Claude Code and the MCP? Not decided here.
