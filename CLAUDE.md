# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A dashboard of Jira activity for the product design team. Four pages (hash routes): **Dashboard** (per-designer cards for a chosen date range, summary tiles, open blockers, a table of designers with no activity), **Reports** (opened/closed by week, blocked over time, open by status, closed by designer, velocity) **Capacity** (the Workload view: open Jira work sized by T-shirt against the days each person has in a chosen window; the earlier typed-in quarterly plan was retired from the page) and **Roster** (add/remove tracked designers by searching Jira). The look follows `capacity-planning-app`: Kroger header and logo, DM Sans and Nunito, shadcn tokens, and a KDS message (`kds-message` from MX Web) for the refresh notice.

Owner: the product design lead. Audience: design leadership. **Localhost only, by decision.** Jira access is either an API key in `.env` or, since the key was revoked on 2026-11-18, the owner's own Atlassian sign-in through Claude Code (the MCP route, which is permanent: the owner cannot get API permissions). The app is not to be hosted or shared, and the MCP route depends on one person's Claude sign-in anyway. The owner is using the app as an MVP to win buy-in for capacity and allocation planning.

## Commands

```bash
npm start                                   # dev server and refresh endpoint, http://127.0.0.1:5173
npm test                                    # vitest, runs once (417 tests)
npm run build                               # production build to dist/
npm run data:jira                           # same refresh as the header button, from the terminal (either route)
node --env-file=.env scripts/jira-check.mjs # checks the REST credentials, prints status codes only
```

If `npm` fails, run the binaries from `node_modules/.bin/` (see Packages). `npm run data:merge` exists but belongs to the retired skill route; see "Stale pieces".

## How data flows

```
Refresh from Jira (header) --POST /api/refresh--> server/ (middleware inside the Vite dev server)
  chooseRoute(env)
   |-- rest: Jira REST, one search plus one bulk status-history call, api.atlassian.com gateway --\
   |-- mcp:  headless `claude -p` + Atlassian MCP, incremental (see below) ------------------------+--> public/data/report.json (version 4)

page --fetch--> report.json --> src/lib/windows.js (the range) + src/lib/report.js buildReport() --> components
GET /api/refresh/status --> progress, start time and spend so far --> the refresh banner
```

- **Second route (2026-11-18), used when the Jira API key is unavailable:** `server/run.mjs` `chooseRoute(env)` picks REST when `JIRA_EMAIL` and `JIRA_API_TOKEN` are set, else the Atlassian MCP; `REFRESH_ROUTE=mcp|rest` in `.env` forces one (set `mcp` if a revoked key is still there). The MCP route (`server/mcpRefresh.mjs`, `server/mcpRunner.mjs`) starts headless `claude -p` in an empty temp folder with only the Atlassian server, user settings only, no skills or built-in tools (about $0.03 a run, down from $0.35), only `executeRead` allowed and every write tool and the direct search tool denied, reads rows 40 per run paged by ticket key (`key > "ABC-123" ORDER BY key ASC`, searches slimmed with `responseFields` so emails never reach Claude), checks the total against Jira's count, reuses saved `h` for tickets whose `u` is unchanged, and fetches status history for the rest in batches of 25, three at a time. Claude returns JSON; the server validates it (rejects emails) and writes the file. A total spending cap (default $5, `REFRESH_MAX_USD` in `.env`; each run $2) stops new runs and keeps the old file. History already read is kept after every batch in git-ignored `data-raw/mcp-history-cache.json`, so a retry only pays for the rest; a good refresh deletes it. After the first pull a refresh is incremental (`mode` incremental or reconciled in the summary): it lists key and updated time for everything touched since the last pull (three-day margin, short answers) and reads in full only tickets that are new or whose updated time differs from the saved row, laid over the saved rows (`readChanged`; the same list-then-read step serves added people and the reconcile), the count is checked against Jira, and a mismatch triggers a key-and-updated-time listing to find tickets that left the roster; tickets resolved near the history cutoff are tolerated. `report.json` meta holds `roster`; tickets of someone removed are pruned from the saved rows (and at once when saving the Roster page, `pruneReport` in `server/roster.mjs`), and someone added has every ticket read. `POST /api/refresh?full=1` forces a full read. Roster name search uses `lookupJiraAccountId` through `executeRead` on the MCP route. `.env` options: `REFRESH_ROUTE`, `REFRESH_MAX_USD`, `REFRESH_CONCURRENCY` (1 to 8, default 3), `REFRESH_MODEL` (not recommended). Progress is at `GET /api/refresh/status`. Spec: `docs/superpowers/specs/2026-11-18-mcp-refresh-design.md`. Everything downstream of `report.json` is unchanged.
- `report.json` (version 4) holds, per ticket: `k` key, `t` title (whitespace-normalised), `s` current status, `a` assignee display name, `pair` Pair display names, `c` created, `u` updated, `r` resolved (null while open), and `h`, its status changes `[timestamp, from, to]` oldest first. Version 4 added `y` issue type, `z` T-shirt size label, `sd` start date and `d` due date (both YYYY-MM-DD) and `rk` Jira rank string, each null when Jira has nothing (all for the Workload view). No emails, account IDs, descriptions or comments. Because it holds names and titles it is business-sensitive (see `docs/data-notes.md`). About a year of history (`historyDays`, 366, the maximum). About 350 KB for roughly 700 tickets; a REST refresh took about 6 seconds when checked, an MCP refresh takes minutes the first time. `meta.roster` lists who was tracked at the pull.
- **Which tickets count in the range is decided in the browser.** Changing the range never calls Jira. The page accepts version 3 or 4 (a version 3 file works everywhere except the Workload view, which asks for a refresh) and rejects any other version and tells the user to refresh.
- The server code is plain modules in `server/` so it is unit tested with a mocked Jira. `vite.config.js` mounts it with `configureServer`; `.env` is read once when the dev server starts, so **restart `npm start` after editing `.env`**. The roster endpoints rewrite `config/report.config.json` (roster key only); Vite reloads the page when it changes.
- Credentials never reach the browser. The endpoint's responses and errors never contain them (tested).
- On the REST route a refresh makes about 8 Jira calls for roughly 700 tickets (`ceil(tickets / 100)` search pages plus one bulk history call); reloading the page makes none on either route. The only third-party request from the browser is Google Fonts (DM Sans, Nunito) in `index.html`. Call counts, the stored-data inventory, network exposure and discussion questions for security and architects are in `docs/data-notes.md`; keep it in step when the data, fields or endpoints change.

## Files that matter

| Path | Role |
|---|---|
| `config/report.config.json` | Roster, projects, issue types, Pair field IDs, `historyDays`, `defaultRange`, status-to-bucket map, and the optional `workload` block (size and rank field IDs, size-to-days map, capacity settings). |
| `public/data/report.json` | Generated. Do not hand-edit. |
| `server/api.mjs` | `POST /api/refresh` (`?full=1` forces a full MCP read) and `GET /api/refresh/status`: localhost Host and same-origin checks, 15 s cooldown, shares one refresh between overlapping clicks. |
| `server/guard.mjs`, `config.mjs` | Shared localhost/same-origin check, JSON body reader, and config reader used by every endpoint. |
| `server/capacity.mjs` | GET/PUT `/api/capacity`. Validates and saves the retired quarterly plan to the git-ignored `config/capacity.json` (backup, atomic write). Still mounted, but no page uses it. Never calls Jira. |
| `src/lib/capacity.js`, `capacityApi.js` | Math and browser calls for the retired quarterly plan. Unused by any page; kept with their tests. |
| `src/components/LabelList.jsx`, `PortfolioBars.jsx` | Parts of the retired Plan view. Unused; kept (with `CapacityParts.test.jsx`) because Wave 7b will likely reuse the portfolio bars. |
| `src/lib/workload.js` | Workload maths: counting rules, load per person, queue projection, team totals, color bands. Pure functions, hundredths of a day. |
| `src/lib/workWindow.js` | The Workload capacity window: next 2/4/8/12 weeks, this/next week, this/next fiscal quarter, grouped dropdown choices, work-day counting, saved choice (`dar.workWindow`). |
| `src/lib/workloadConfig.js` | Validation of the optional `workload` config block. Shared by `server/queries.mjs` and `workload.js`. |
| `src/components/WorkloadPage.jsx` | The Capacity page, shown at `#/capacity` (tiles, team members list, coverage banner). Takes `data` and an optional `cfg`. Does not wait on `/api/capacity`. |
| `server/roster.mjs` | Roster page endpoints: GET/PUT `/api/roster`, GET `/api/users/search` (REST, or `lookupJiraAccountId` through the MCP when no key is set). Writes only the `roster` key of the local config, with a backup and an atomic write, and prunes `report.json` of tickets nobody tracked any more (`pruneReport`, backup in `data-raw/`). |
| `server/jira.mjs` | Read-only Jira client: POST `/rest/api/3/search/jql` and POST `/rest/api/3/changelog/bulkfetch` (both only read), follows `nextPageToken`, 30 s timeout, plain-language errors. `created` in the bulk response is epoch milliseconds, not an ISO string. |
| `server/queries.mjs` | Builds the one JQL search and validates config. |
| `server/mcpRunner.mjs` | Headless Claude launcher (lean flags, only `executeRead` allowed, write tools and the direct search tool denied, $2 cap, timeout, empty working folder), the prompts (rows, key listing, history, count, user search) and the validators that reject emails and malformed rows. |
| `server/mcpRefresh.mjs` | The MCP refresh: key-paged rows, incremental reads, count check and reconcile, roster added/removed, incremental history with a resume cache, spending cap, progress reports, merge. Takes an injectable `run` for tests. |
| `server/refresh.mjs`, `run.mjs`, `store.mjs` | Maps issues to rows, calls the merge, writes the file atomically (temp file, then rename). |
| `scripts/merge-lib.mjs` | Pure merge: dedupe, drop non-roster tickets, normalise timestamps, stamp `pulledAt`. |
| `scripts/refresh-jira.mjs`, `jira-check.mjs` | CLI refresh and credential check. |
| `src/lib/report.js` | `buildReport(data, window)`: buckets, counts, active/quiet split, blockers, tiles, notes. |
| `src/lib/windows.js` | Windows: presets (rolling, calendar, fiscal), custom start and end, compare window, clamping to history and the pull, saved choice. |
| `src/lib/designers.js` | Dashboard card sort (last name, A-Z, Z-A, or needs-attention order), name filter, saved layout (`dar.view`). Pure functions. |
| `src/lib/history.js` | Status replay and the activity rule. Pure functions. |
| `src/lib/today.js` | `useToday()`: today's date, refreshed each minute and when the tab becomes visible. |
| `src/lib/fiscal.js` | Kroger fiscal calendar, including quarters by key (`FY2026-Q4`), their weeks, and an `assumed` flag for FY2027. |
| `src/lib/weeks.js` | Reports page maths: Sunday-start weeks, opened and closed per week, velocity, open by status, closed by designer. Pure functions. |
| `src/lib/blocked.js` | Blocked spells from each ticket's status history, per-week blocked counts, days blocked. Pure functions. |
| `src/lib/route.js` | Hash route (`#/reports`, `#/roster`, else dashboard). No router library. |
| `src/lib/rosterApi.js` | Browser calls to the roster endpoints; carries the saved-roster message across the reload. |
| `src/App.jsx` | Loads the data, refresh state, shared alerts, switches page. |
| `src/components/Dashboard.jsx`, `ReportsPage.jsx`, `RosterPage.jsx` | The three pages. Charts are plain SVG (`WeeklyChart`, `StatusDonut`, `ClosedByDesigner`) using theme tokens. |
| `src/components/RefreshBanner.jsx`, `src/lib/refreshProgress.js`, `src/lib/useJiraRefresh.js` | The sticky banner shown while a refresh runs (step in words, bar that fills or slides, elapsed time, spend against the limit), the pure helpers behind it, and the hook that starts a refresh, polls `GET /api/refresh/status`, and picks up one already running after a page reload. |
| `src/components/` | Header, RangeControls, KpiStrip, BlockerAlert, DesignerCard, QuietTable, StatusBadge, KdsNotice. |
| `src/components/ui/` | shadcn-style primitives. `alert`, `badge`, `button`, `label` are copied from the sibling reference app. `card` is new. |
| `src/index.css` | Theme tokens (oklch), copied from the sibling reference app. Light and `.dark`. |

## Definitions (keep code, docs, and the UI footer consistent)

- **Roster:** the names in `config.roster`, by Jira display name.
- **Counts for a designer:** assigned to them, or named in the Pair field. A developer's ticket reaches a designer only through Pair.
- **Window:** `{ start, end }`, start inclusive, end exclusive, and **end never passes the last pull**. Rolling presets (last 7, 14, 30 days) count back from the pull. Calendar and fiscal presets (this/last week, this/last period, this/last quarter, fiscal year to date) are worked out from **today**, via `useToday()`, so they roll over by themselves; their end is held back to the pull, and a window that starts after the pull is disabled with "Refresh from Jira" and the page shows a stale-data note. Custom ranges take a start and an end day. `resolveWindow(range, pull, historyStart, today)` in `src/lib/windows.js`.
- **Compare:** `range.compare` is `'off'`, `'previous'` or the id of any Date range preset. It adds `prev`, `change` and `good` to each KPI tile. `'previous'` = the fiscal period or quarter before a "last" preset (`prev` field), else the same length ending where this window starts. A preset comparison is unavailable (with a reason, in `win.compareChoices`) if it is the viewed range, overlaps it, reaches before `historyStart`, or starts after the pull. `win.compare` carries `days`, `mainDays` and `sameLength`; the Dashboard shows a note when the lengths differ. No same-days-in option yet (a deliberate MVP cut). An unusable saved comparison quietly becomes no comparison.
- **Counts in a window:** a ticket that was **created, resolved, or changed status** in it (`hasActivity` in `src/lib/history.js`). Comment-only edits (`u`) are deliberately not activity. **Statuses are shown as at the end of the window**, replayed from `h` with `statusAt`/`statusAtEnd`; a window ending at the pull uses the current status. A ticket is open at the end if it existed and was not yet resolved. Tickets follow their **current** assignee and Pair, so a reassignment moves past activity to the new owner (stated in the page footer).
- **Active designer:** at least one counted ticket. **No activity:** none, even if they have open tickets; the table says how many.
- **Tiles:** active; no activity; closed (moved and in a Closed status); in progress and PM review (moved tickets currently in that bucket); blocked. **Blocked is every ticket Blocked at the end of the window** (for a window ending now, today's blocked list), with days blocked as of that moment. A ticket shared by two designers counts once in the tiles and appears on both cards.
- **Buckets:** Closed; In Progress; PM Review (also Ready for Review, Ready for Test, Final Acceptance); Blocked; Open (also In Discovery, Selected). An unmapped status falls back to `defaultBucket` (open) and the refresh returns a warning.
- **Card notes** are generated from statuses only ("Activity in the last 7 days: 7 closed, 1 in PM review. Blocked: ABC-123."). No model-written text remains. Keep it that way: never invent causes, effort, or intent.
- **Fiscal calendar:** 13 four-week periods, Sunday to Saturday. Quarters are P1-4 (16 weeks), P5-7, P8-10, P11-13 (12 weeks each). FY2026 starts 2026-02-01 and was checked against Kroger's printed calendar, all 13 periods. FY2027 is assumed to start 2027-01-31 on the same pattern and is **not verified**. After FY2027 `fiscalPosition()` returns null and the fiscal presets hide.

## Rules

- **This repository is public.** Never commit real names, ticket keys or titles, Jira site, cloud ID, project keys, field IDs, or `report.json`. Real values live in git-ignored files: `.env`, `config/report.config.json`, `public/data/*`, `data-raw/`, and `CLAUDE.local.md`. Use fake values (`Doe, Jamie`, `ABC-123`) in docs, tests and examples. Run the leak check in the README before every commit.
- Counting lives in code with tests. If a number looks wrong, fix `report.js` and add a test; do not patch the data.
- Never ask the user to paste a token or password into chat. Never print `.env` values. Checks print status codes and counts only.
- Do not modify the sibling reference app that supplied the look and `node_modules` (a local clone on this machine). It is read-only.
- The app must stay read-only toward Jira. The only Jira calls are the search, the bulk status-history fetch (both POSTs that read) and the user search (a GET). On the MCP route the only allowed tools are the Jira search tool and `executeRead`; the deny list in `server/mcpRunner.mjs` (all write and destructive tools, Bash, file writes) must stay and stay tested. Do not add anything that writes to Jira. The one thing the app writes is a local file: the `roster` key of `config/report.config.json` (with a backup), only from the Roster page, localhost and same-origin only. Never log or return emails or account IDs from the user search.
- Do not copy credentials between `.npmrc` files or anywhere else without asking.
- Before refreshing for real, `public/data/report.json` can be copied to `data-raw/` as a backup. `data-raw/` is git-ignored.
- **Log the cost of every headless Claude run.** While the MCP refresh route is being built (spec `docs/superpowers/specs/2026-11-18-mcp-refresh-design.md`), each test or real run through `claude -p` adds a row to the "Cost of a refresh through the Atlassian MCP" table in `README.md` (date, what it did, time, cost from `total_cost_usd`). Measured figures only; keep estimates labelled as estimates and replace them once measured. Use `onUsage` in `server/mcpRunner.mjs` to read the cost.

## Tests

417 tests in twenty-four files, all without network (`server/mcpRunner.test.js` for the launcher, prompts and row validation, `server/mcpRefresh.test.js` for the incremental refresh and its safety checks, `server/refreshRoute.test.js` for route choice, the endpoint and progress, `server/mcpIncremental.test.js` for incremental refresh, reconcile and roster changes, `src/lib/refreshProgress.test.js`, `src/components/RefreshBanner.test.jsx` and `src/lib/useJiraRefresh.test.js` for the banner): `src/lib/report.test.js` (counting rules on fixed fixtures, sanity checks on the checked-in data, all 13 fiscal periods and the quarter edges, range resolution, compare with a preset), `scripts/merge-lib.test.js`, `server/server.test.js` (Jira client, queries, refresh, endpoint with a mocked Jira), `server/roster.test.js` (roster validation and save, backup, endpoint guards, user search leaks no email or ID), `src/lib/capacity.test.js` (quarter lengths, available and planned weeks, status thresholds, roll-ups, edits), `server/capacity.test.js` (capacity plan validation, atomic save and backup, endpoint guards), `src/components/CapacityParts.test.jsx` (bars, label list), `src/components/StatusDonut.test.jsx` (ring fits its drawing area), `src/lib/designers.test.js` (last-name sort, name filter, saved layout), `src/components/DesignerCard.test.jsx` (hidden card keeps name, counts and badges), `src/lib/history.test.js` (status replay, activity rule, open at end), `src/lib/blocked.test.js` (blocked spells and weekly blocked counts), `src/lib/workload.test.js` (the worked example to the day, counting rules, queue order and float safety, zero states, team sums, color bands), `src/lib/workWindow.test.js` (work days, presets, this/next week and quarter with hand-checked dates, rollover, dropdown groups, clamping, past ranges, saved choice), `src/lib/workloadConfig.test.js` (block validation), `src/components/WorkloadPage.test.jsx` (every roster member listed, coverage banner, refresh and not-set-up states), `src/lib/weeks.test.js` (week boundaries, opened/closed, velocity, status snapshot, designer split, the weeks-shown choice incl. custom; two property checks on the real data that skip on a fresh clone). The checked-in-data tests assert properties (every roster member present, wider ranges never show fewer closed tickets) and not exact totals, so a normal refresh does not break them.

## Stale pieces

- **`.claude/skills/refresh-designer-report/SKILL.md` is retired.** It is now a stub that points to the Refresh button, so it cannot be run by mistake; delete the folder when convenient. It used to produce `moved` lists and written notes, which the page no longer uses. The header button and `npm run data:jira` are the supported route, over REST or, without a Jira key, the app's own MCP route (see "How data flows").
- `scripts/merge-report.mjs` (`npm run data:merge`) was rewritten for the new format but nothing feeds it now; it needs `data-raw/pool.json` rows with `c`, `u`, `r`.
- `data-raw/` holds old-format files (`moved.json`, `notes.json`, `pool.json`) and backups of earlier data. Safe to delete.

## Status

- **Built, in this order:** theme and header; live refresh from Jira; date ranges and factual notes; Wave 4 Reports page; Wave 5a status history (blocked over time, days blocked); Wave 5b Roster page; Wave 6 date range rework (this/last week, period, quarter, fiscal year to date, custom start and end, compare, status-change activity rule, statuses as at the end of the range, 366 days of history); Dashboard card controls (grid/list, show/hide that keeps name, counts and badges, last-name sort, name filter). Filter and sort affect only the cards and the no-activity table, never the tiles or blockers. Hidden cards are not remembered across visits; layout and sort are.
- **MCP refresh route (2026-11-18/19), built and used for real:** the Jira API key was revoked, so the app refreshes through headless Claude Code and the Atlassian MCP. First full pull $5.82 (756 tickets), first incremental $1.32, user search $0.04 (all in the README cost table). Built: lean launch, key paging, incremental reads, count check and reconcile, history resume cache, $5 total cap, roster search/prune/added-only reads, refresh banner. **Seen by the owner on 2026-11-19:** the banner and the Roster name search look right. Dark mode and phone width are still unchecked. The owner mapped status "Final Acceptance" to the PM Review bucket and decided to keep `historyDays` at 366. Decided: no Jira Teams in the app.
- **Seen by the owner:** the owner said everything looks good for now. Claude has never looked at a browser, and tests cover the numbers, not the visuals; phone width, dark mode and every range have not been checked systematically.
- **Workload view, stage 1a built (not yet seen in a browser; no real refresh has been run against it):** Jira-sized open work against days available, data version 4. It is now the whole Capacity page: the typed-in quarterly Plan view was retired on 2026-11-04 (never used, a second source of truth). Design spec: `docs/superpowers/specs/2026-11-04-workload-view-design.md`; maths: `docs/capacity-calculations.md`. **Direction set by the owner (2026-11-04): sized work alone is not enough, tickets need start and end dates in Jira.** Chosen fields: **Start date** and **Due date**. The start date is already read into each ticket (`sd`; due date is `d`); the load maths does not use either yet. Only 6 of 145 open tickets had both when checked, so adoption is a team habit the app cannot fix; coverage must be shown. **Next, in order:** scheduled load (spread each ticket's size over its start-to-due work days, show load week by week, unscheduled tickets keep the projected queue as a labelled estimate; needs its own design); 1b custom calendar picker; 2 person drill-down page; 3 projected timeline chart; 4 history view (delivered work for past ranges); 5 dated time off; 6 story-point fallback. The T-shirt field is almost empty in Jira (1 of 145 open tickets when checked), so most work shows as unsized until the team fills it in.
- **Wave 7a (retired from the page 2026-11-04, never used):** planned % by portfolio per person per fiscal quarter, team and portfolio roll-ups, status at 90/100%. **Next:** Wave 7b (compare the plan with Jira: map parent epics to portfolios, needs data version 4 with each ticket's epic, not started). Story-point velocity, only once the owner names the field (only one of the four candidate story-point fields has any data, set on 72% of closed tickets and 28% of open ones; its ID is in the git-ignored `CLAUDE.local.md`). **Later:** per-designer drill-down, time spent in each status. **Deferred on request:** scheduled digest.
- **Chores still open:** delete the retired skill folder; spot-check one past week's closed count against Jira; confirm FY2027 dates; measure an add-a-person refresh and record it in the README table; spot-check more tickets (rows and history) against Jira, because the MCP route copies values through a model; check the banner and Roster page in dark mode and at phone width; check `/usage` after a refresh to see how much allowance it uses; if the app moves beyond a proof of concept, take `docs/data-notes.md` to security and ask for a service account or scoped token.

## Capacity definitions (retired from the UI 2026-11-04)

The quarterly plan below no longer has a page. `config/capacity.json`, `server/capacity.mjs`, `src/lib/capacity.js` and their tests remain, untouched, in case it returns or Wave 7b reuses the portfolio idea. Nothing reads the file.

- **Method (from the sibling capacity planning app):** weeks per fiscal quarter. Available = quarter weeks minus time off (floor 0). Planned = available x allocation %. Status: under below 90, fully allocated 90 to 100, over above 100, "not planned" at 0. A total above 100% saves and is flagged, never blocked. Story points are not used; Jira is not read.
- **Data:** `config/capacity.json` (git-ignored, real names) `{ portfolios, teams, people: { "<roster name>": { teams: [..], timeOff: { "FY2026-Q4": weeks }, allocations: { "FY2026-Q4": { "<portfolio>": whole % } } } } }`. Percentages are per person per quarter; portfolios and teams are quarter-agnostic labels the owner defines. **A person can be on several teams and split across several portfolios.** Team roll-ups count a multi-team person in full under each team, so team rows do not add up to the total; the page says so. The older single `team` value is still read. Renaming or removing a label updates every person. The example is `config/capacity.example.json` (fake).
- **Writes:** only that file, only from the Capacity page, localhost and same-origin, with a backup and an atomic write. Validation lives in `cleanCapacity` (`server/capacity.mjs`).
- **Calendar caveat:** the sibling app lists FY2027 as 13/13/13/13 weeks; this app assumes 16/12/12/12. Unverified, flagged on the page, and it changes available weeks.
- **Why not Jira:** Product Portfolio is empty on every ticket; due date is on 5 of 145 open tickets; Story Points on 28% of open tickets. Team is on 705 of 711 tickets with 25 values, meaning unconfirmed. 690 tickets have a parent epic (106 epics), the likely basis for 7b.

## Blocked definitions

- A **spell** starts at a change into a status that `statusBuckets` maps to Blocked and ends at the next change out, at the resolved time, or stays open until the pull. A first change that leaves Blocked means blocked since created.
- **Blocked at week end:** tickets in a spell when the week ended (at the pull for the week in progress). **New blocks:** spells that started in the week. **Median days blocked:** spells that ended inside the weeks shown.
- Tickets follow their current assignee and Pair, so a reassigned ticket's past blocks count for its current owner.
- History statuses that are not in `statusBuckets` (the real data has two old workflow steps) do not matter for blocked, since only Blocked is looked at.
- Checked once against Jira: the set of tickets with a change into Blocked matched a Jira `status CHANGED TO Blocked` search exactly.

## Workload definitions

- **Config:** optional `workload` block in `config/report.config.json` (fake example in the example file): `sizeFieldId`, `rankFieldId`, optional `startFieldId`, `sizeDays` (XS 1.5, SM 5, MED 10, LG 20, XL 30), `daysPerWeek` (up to 5, default 5), `focus` (0 to 1, default 1), `overrides` by roster name, `excludedTypes` (Epic, Program Epic). Absent block: refresh still works, sizes are null and the view says it is not set up. Overrides for names no longer on the roster are ignored on purpose, so removing someone on the Roster page cannot break a refresh. The real field IDs are in the git-ignored config and `CLAUDE.local.md`.
- **Counts:** open ticket (no `r` and not in the Closed bucket), not an excluded type, **assignee** on the roster. A pair does not carry load. In Progress, PM Review and Blocked are in progress; Open is queued. **Unsized** (no size, or a label not in `sizeDays`, matched exactly) adds 0 days but is counted and flagged, never treated as free.
- **Maths:** weekly capacity = days per week x focus (default 5: 40 hours a week, Monday to Friday, 100% focus; lower `focus` per person for part-time or split people); window capacity = weekly / 5 x Monday-to-Friday days in the window; % = assigned / window capacity; assigned work does not depend on the window. Time off is **not** subtracted. Queue: in progress then queued, by Jira rank (plain string comparison), filled per work day; "clears" and "late" come from it. Full formulas and a worked example: `docs/capacity-calculations.md`.
- **Precedence of states:** no capacity, then no open work, then no sized work, then the percentage. Zero-capacity people are left out of team sums and the over-capacity count.
- **Bands:** grey up to 50%, green to 85%, orange to 95%, red above. The Plan view keeps 90 and 100; both are labelled on the page.
- **Capacity window choices (grouped like the Dashboard dropdown):** Rolling from today (next 2, 4, 8, 12 weeks); Calendar (this week, next week; weeks are Sunday to Saturday); Fiscal (this quarter, next quarter, from `fiscal.js`). The start is never before today, so "this" choices cover what is left. A choice with no work days left (a Saturday for this week) is disabled with a reason; FY2027 quarters are labelled "(assumed dates)". `src/lib/workWindow.js` `resolveWorkWindow` and `workWindowGroups`.
- **Past ranges are not available yet** (disabled with a note); a later build shows delivered work.

## Reports page definitions

- **Opened:** created date. **Closed:** resolved date (latest, so a reopened ticket moves). Both for roster tickets (assignee or Pair). A ticket opened and closed in the same week counts in both.
- **Weeks shown:** 1, 2, 4, 8, 12, all, or custom (a whole number, kept between 1 and the complete weeks saved). Saved in `dar.weeks` as `{ choice, custom }`; the older plain-text value still loads. The week in progress is always added.
- **Weeks:** Sunday to Saturday, local midnights. The first week is dropped if it starts before `historyStart`. The week in progress ends at the pull and is excluded from velocity.
- **Velocity:** tickets closed, never points. Average of the last four complete weeks, best, lowest, median days created to resolved.
- **Open by status:** snapshot at the pull, ignores the weeks selector. **Closed by designer:** assigned plus paired, shown separately.
- Bulk closes distort counts: one week in the real data had most of its closes on a single day. Don't "fix" it in code; the page footer and README say so.

## Facts worth keeping

- A ticket's resolved date can change if it is reopened and closed again. How often that happens was not measured.
- **Velocity:** the team does not use story points or T-shirt sizes consistently, and the owner cannot require it yet. A Story Points field was set on about 74% of tickets closed in 90 days, but several similarly named fields exist and it is not known which the team uses (the field IDs are in the git-ignored `CLAUDE.local.md`). Tickets closed per week is the dependable measure; points should be optional and shown with their coverage.
- **Charts** are plain SVG with the theme colors. shadcn's chart component needs `recharts`, which is not installed, and package installs have been unreliable here.
- **Status history** comes from Jira's bulk history endpoint, not `expand=changelog`, which truncates long histories.
- Weeks run Sunday to Saturday because the fiscal calendar does.
- **MCP facts (checked 2026-11-18):** the MCP has no bulk changelog call, so history is one `listJiraIssueChangelogs` call per ticket (a closed ticket had 36 entries, 6 of them status; the rest include comment and description text and cannot be filtered). Only `executeRead` can slim a search with `responseFields`; the direct search tool ignores it and returns emails and long descriptions. A `nextPageToken` is about 2 KB and copying it by hand fails, which is why the app pages by `key > "ABC-123" ORDER BY key ASC` instead. Custom fields come back keyed by display name (`Pair`, `Rank`, `T-Shirt Sizing`, `Start date`), not ID; empty ones are a bare `{ id }`. JQL dates are in the Jira user's time zone, hence the two-day look-back. `claude --bare` only accepts an API key, and `--setting-sources ""` loses the login, so neither is used. Asking Claude to page through a whole project and retype it failed ("too large to return within budget"); small runs of 40 rows work. A lean run costs about $0.03, a full-context run about $0.35.
- **Speed and accuracy (measured 2026-11-19):** an ordinary incremental refresh is 31 s and $0.24 (it was 53 s and $0.34 before list-then-read, because it re-read every ticket touched in the look-back window). Time is dominated by Claude retyping output (about 1 s per row, 2+ s per ticket of history, a few seconds fixed per run); six parallel runs gain little (27 s) because the largest project sets the pace. **Haiku is not usable**: on the same 40 rows it was slower (100 s against 38 s) and changed two dates and a rank, and on 25 histories it returned 12 status changes against 14. The default model matched Jira on all fields of six sampled closed tickets and on one ticket's four status changes. The app cannot detect a miscopied value, only missing or malformed rows and a wrong total. A non-numeric concurrency once started no workers and silently read nothing (fixed: it falls back to 3).
- **Teams (checked 2026-11-19):** the Team field is an Atlassian Team object that describes the work, and Jira matches it only by team ID, never by name (a name search returns 0). The MCP cannot list a team's members, so a team cannot fill the roster. The owner decided not to show teams; the roster alone decides whose tickets are pulled. The Team field's ID and the owner's design team ID are in the git-ignored `CLAUDE.local.md`.

## Open questions

- Org approval (answered 2026-11-19): **the owner is permitted to use the Atlassian MCP.** Getting an API key for this use is too much process and security review, so the MCP is the route. The app is a proof of concept for capacity planning, run only on the owner's machine. Ticket content, including comment text the app discards, still passes through Claude on each refresh (see `docs/data-notes.md`); that was not separately reviewed, and the README tells other users to check their own situation.
- Billing (answered 2026-11-19): the owner's Claude account has a **monthly allowance**, so refreshes use up allowance rather than a per-token bill. The cost figures in the README are list price, which is a guide to how much allowance a refresh uses, not a charge. How big the allowance is, and how much a refresh takes from it, has not been checked (Claude Code's `/usage` shows it).
- **Decided 2026-11-19: the owner will not get API permissions** (too much process for a proof of concept). The MCP route is the long-term route, not a stopgap, so its cost, speed and organisational approval matter more than they would for a fallback. The REST route stays in the code for anyone else who has a token (a scoped `read:jira-work`, `read:jira-user` token would make refreshes free and fast again and only changes `.env`).
- Which story-point field does the team use, if any?
- Does FY2027 follow the FY2026 pattern (starts 2027-01-31, quarters 16/12/12/12)?

## Packages

`node_modules` was copied from the sibling reference app because the Artifactory login failed. `package.json` pins those versions, including `mx-web-components` and `react-mx-web-components`. `.npmrc` points this project at public npm; the global `~/.npmrc` is untouched.

- A fresh `npm install` from public npm hit an ERESOLVE peer-dependency conflict around `shadcn` and its Babel packages. For a reinstall, fix the Artifactory login or retry with `--legacy-peer-deps`, then run `npm test` and `npm run build`.
- The MX package registers every KDS component at startup, so the build has a 1.8 MB chunk (`mx-zing-grid`) and a main bundle near 850 KB. Fine on localhost. Loading only `kds-message` would shrink it.

## Atlassian MCP

Registered with `claude mcp add --transport http atlassian https://mcp.atlassian.com/v2/mcp` in this folder (local scope, so it is per project directory); authenticate with `/mcp`. **The app now uses it**: the MCP refresh route and the Roster name search run headless `claude -p` against it, with the allowlist and deny list in `server/mcpRunner.mjs`. The headless runs use `--strict-mcp-config` with their own copy of the server URL, so they do not depend on the local registration, but they do use the sign-in `/mcp` stored. If the sign-in expires, run `/mcp` again.

## Gotchas

- zsh treats `?` in URLs as a glob. Quote URLs.
- `gh api` and `gh repo clone` work for the reference repo.
- JQL on this site accepts the Pair field as `cf[<id>]` and by display name. Search results page at 100; always follow `nextPageToken`.
- Names with `(NonEmp)` are real Jira display names; keep them exactly as in config. Titles are whitespace-normalised on refresh.
- The REST refresh gives up with a plain error past 2,000 tickets (the 366-day history was about 700 when checked), on any failed page (it never saves a partial list), and on an empty answer (it keeps the old file). The MCP refresh keeps the old file on any failure too, and pages at most 100 pages per project.
- Editing `src/` while a refresh is running reloads the browser tab and hides the banner; the refresh itself keeps going, and the banner returns on the next load.
- With an old revoked key still in `.env` the REST route is chosen and fails with a 401; set `REFRESH_ROUTE=mcp`.
- A KDS message removes itself from the DOM when closed. `KdsNotice` is keyed per notice so React replaces the whole wrapper.
