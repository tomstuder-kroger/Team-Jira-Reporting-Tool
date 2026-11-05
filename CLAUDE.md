# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A dashboard of Jira activity for the product design team. Four pages (hash routes): **Dashboard** (per-designer cards for a chosen date range, summary tiles, open blockers, a table of designers with no activity), **Reports** (opened/closed by week, blocked over time, open by status, closed by designer, velocity) **Capacity** (the Workload view: open Jira work sized by T-shirt against the days each person has in a chosen window; the earlier typed-in quarterly plan was retired from the page) and **Roster** (add/remove tracked designers by searching Jira). The look follows `capacity-planning-app`: Kroger header and logo, DM Sans and Nunito, shadcn tokens, and a KDS message (`kds-message` from MX Web) for the refresh notice.

Owner: the product design lead. Audience: design leadership. **Localhost only, by decision.** The Jira key lives in `.env` on this machine and the app is not to be hosted or shared.

## Commands

```bash
npm start                                   # dev server and refresh endpoint, http://127.0.0.1:5173
npm test                                    # vitest, runs once (308 tests)
npm run build                               # production build to dist/
npm run data:jira                           # same refresh as the header button, from the terminal
node --env-file=.env scripts/jira-check.mjs # checks the credentials, prints status codes only
```

If `npm` fails, run the binaries from `node_modules/.bin/` (see Packages). `npm run data:merge` exists but belongs to the retired MCP route; see "Stale pieces".

## How data flows

```
Refresh from Jira (header) --POST /api/refresh--> server/ (middleware inside the Vite dev server)
  --> Jira REST, one search plus one bulk status-history call, api.atlassian.com gateway --> public/data/report.json (version 4)

page --fetch--> report.json --> src/lib/windows.js (the range) + src/lib/report.js buildReport() --> components
```

- `report.json` (version 4) holds, per ticket: `k` key, `t` title (whitespace-normalised), `s` current status, `a` assignee display name, `pair` Pair display names, `c` created, `u` updated, `r` resolved (null while open), and `h`, its status changes `[timestamp, from, to]` oldest first. Version 4 added `y` issue type, `z` T-shirt size label, `sd` start date and `d` due date (both YYYY-MM-DD) and `rk` Jira rank string, each null when Jira has nothing (all for the Workload view). No emails, account IDs, descriptions or comments. Because it holds names and titles it is business-sensitive (see `docs/data-notes.md`). About a year of history (`historyDays`, 366, the maximum). About 350 KB for roughly 700 tickets; a refresh took about 6 seconds when checked.
- **Which tickets count in the range is decided in the browser.** Changing the range never calls Jira. The page accepts version 3 or 4 (a version 3 file works everywhere except the Workload view, which asks for a refresh) and rejects any other version and tells the user to refresh.
- The server code is plain modules in `server/` so it is unit tested with a mocked Jira. `vite.config.js` mounts it with `configureServer`; `.env` is read once when the dev server starts, so **restart `npm start` after editing `.env`**. The roster endpoints rewrite `config/report.config.json` (roster key only); Vite reloads the page when it changes.
- Credentials never reach the browser. The endpoint's responses and errors never contain them (tested).
- A refresh makes about 8 Jira calls for roughly 700 tickets (`ceil(tickets / 100)` search pages plus one bulk history call); reloading the page makes none. The only third-party request from the browser is Google Fonts (DM Sans, Nunito) in `index.html`. Call counts, the stored-data inventory, network exposure and discussion questions for security and architects are in `docs/data-notes.md`; keep it in step when the data, fields or endpoints change.

## Files that matter

| Path | Role |
|---|---|
| `config/report.config.json` | Roster, projects, issue types, Pair field IDs, `historyDays`, `defaultRange`, status-to-bucket map, and the optional `workload` block (size and rank field IDs, size-to-days map, capacity settings). |
| `public/data/report.json` | Generated. Do not hand-edit. |
| `server/api.mjs` | `POST /api/refresh` middleware: localhost Host and same-origin checks, 15 s cooldown, shares one Jira call between overlapping clicks. |
| `server/guard.mjs`, `config.mjs` | Shared localhost/same-origin check, JSON body reader, and config reader used by every endpoint. |
| `server/capacity.mjs` | GET/PUT `/api/capacity`. Validates and saves the retired quarterly plan to the git-ignored `config/capacity.json` (backup, atomic write). Still mounted, but no page uses it. Never calls Jira. |
| `src/lib/capacity.js`, `capacityApi.js` | Math and browser calls for the retired quarterly plan. Unused by any page; kept with their tests. |
| `src/components/LabelList.jsx`, `PortfolioBars.jsx` | Parts of the retired Plan view. Unused; kept (with `CapacityParts.test.jsx`) because Wave 7b will likely reuse the portfolio bars. |
| `src/lib/workload.js` | Workload maths: counting rules, load per person, queue projection, team totals, color bands. Pure functions, hundredths of a day. |
| `src/lib/workWindow.js` | The Workload capacity window: next 2/4/8/12 weeks, this/next week, this/next fiscal quarter, grouped dropdown choices, work-day counting, saved choice (`dar.workWindow`). |
| `src/lib/workloadConfig.js` | Validation of the optional `workload` config block. Shared by `server/queries.mjs` and `workload.js`. |
| `src/components/WorkloadPage.jsx` | The Capacity page, shown at `#/capacity` (tiles, team members list, coverage banner). Takes `data` and an optional `cfg`. Does not wait on `/api/capacity`. |
| `server/roster.mjs` | Roster page endpoints: GET/PUT `/api/roster`, GET `/api/users/search`. Writes only the `roster` key of the local config, with a backup and an atomic write. |
| `server/jira.mjs` | Read-only Jira client: POST `/rest/api/3/search/jql` and POST `/rest/api/3/changelog/bulkfetch` (both only read), follows `nextPageToken`, 30 s timeout, plain-language errors. `created` in the bulk response is epoch milliseconds, not an ISO string. |
| `server/queries.mjs` | Builds the one JQL search and validates config. |
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
- **Buckets:** Closed; In Progress; PM Review (also Ready for Review, Ready for Test); Blocked; Open (also In Discovery, Selected). An unmapped status falls back to `defaultBucket` (open) and the refresh returns a warning.
- **Card notes** are generated from statuses only ("Activity in the last 7 days: 7 closed, 1 in PM review. Blocked: ABC-123."). No model-written text remains. Keep it that way: never invent causes, effort, or intent.
- **Fiscal calendar:** 13 four-week periods, Sunday to Saturday. Quarters are P1-4 (16 weeks), P5-7, P8-10, P11-13 (12 weeks each). FY2026 starts 2026-02-01 and was checked against Kroger's printed calendar, all 13 periods. FY2027 is assumed to start 2027-01-31 on the same pattern and is **not verified**. After FY2027 `fiscalPosition()` returns null and the fiscal presets hide.

## Rules

- **This repository is public.** Never commit real names, ticket keys or titles, Jira site, cloud ID, project keys, field IDs, or `report.json`. Real values live in git-ignored files: `.env`, `config/report.config.json`, `public/data/*`, `data-raw/`, and `CLAUDE.local.md`. Use fake values (`Doe, Jamie`, `ABC-123`) in docs, tests and examples. Run the leak check in the README before every commit.
- Counting lives in code with tests. If a number looks wrong, fix `report.js` and add a test; do not patch the data.
- Never ask the user to paste a token or password into chat. Never print `.env` values. Checks print status codes and counts only.
- Do not modify the sibling reference app that supplied the look and `node_modules` (a local clone on this machine). It is read-only.
- The app must stay read-only toward Jira. The only Jira calls are the search, the bulk status-history fetch (both POSTs that read) and the user search (a GET). Do not add anything that writes to Jira. The one thing the app writes is a local file: the `roster` key of `config/report.config.json` (with a backup), only from the Roster page, localhost and same-origin only. Never log or return emails or account IDs from the user search.
- Do not copy credentials between `.npmrc` files or anywhere else without asking.
- Before refreshing for real, `public/data/report.json` can be copied to `data-raw/` as a backup. `data-raw/` is git-ignored.

## Tests

308 tests in seventeen files, all without network: `src/lib/report.test.js` (counting rules on fixed fixtures, sanity checks on the checked-in data, all 13 fiscal periods and the quarter edges, range resolution, compare with a preset), `scripts/merge-lib.test.js`, `server/server.test.js` (Jira client, queries, refresh, endpoint with a mocked Jira), `server/roster.test.js` (roster validation and save, backup, endpoint guards, user search leaks no email or ID), `src/lib/capacity.test.js` (quarter lengths, available and planned weeks, status thresholds, roll-ups, edits), `server/capacity.test.js` (capacity plan validation, atomic save and backup, endpoint guards), `src/components/CapacityParts.test.jsx` (bars, label list), `src/components/StatusDonut.test.jsx` (ring fits its drawing area), `src/lib/designers.test.js` (last-name sort, name filter, saved layout), `src/components/DesignerCard.test.jsx` (hidden card keeps name, counts and badges), `src/lib/history.test.js` (status replay, activity rule, open at end), `src/lib/blocked.test.js` (blocked spells and weekly blocked counts), `src/lib/workload.test.js` (the worked example to the day, counting rules, queue order and float safety, zero states, team sums, color bands), `src/lib/workWindow.test.js` (work days, presets, this/next week and quarter with hand-checked dates, rollover, dropdown groups, clamping, past ranges, saved choice), `src/lib/workloadConfig.test.js` (block validation), `src/components/WorkloadPage.test.jsx` (every roster member listed, coverage banner, refresh and not-set-up states), `src/lib/weeks.test.js` (week boundaries, opened/closed, velocity, status snapshot, designer split, the weeks-shown choice incl. custom; two property checks on the real data that skip on a fresh clone). The checked-in-data tests assert properties (every roster member present, wider ranges never show fewer closed tickets) and not exact totals, so a normal refresh does not break them.

## Stale pieces

- **`.claude/skills/refresh-designer-report/SKILL.md` and the Atlassian MCP route are out of date.** The skill still produces `moved` lists and written notes, which the page no longer uses. Do not run it until it is rewritten. The header button and `npm run data:jira` are the supported route.
- `scripts/merge-report.mjs` (`npm run data:merge`) was rewritten for the new format but nothing feeds it now; it needs `data-raw/pool.json` rows with `c`, `u`, `r`.
- `data-raw/` holds old-format files (`moved.json`, `notes.json`, `pool.json`) and backups of earlier data. Safe to delete.

## Status

- **Built, in this order:** theme and header; live refresh from Jira; date ranges and factual notes; Wave 4 Reports page; Wave 5a status history (blocked over time, days blocked); Wave 5b Roster page; Wave 6 date range rework (this/last week, period, quarter, fiscal year to date, custom start and end, compare, status-change activity rule, statuses as at the end of the range, 366 days of history); Dashboard card controls (grid/list, show/hide that keeps name, counts and badges, last-name sort, name filter). Filter and sort affect only the cards and the no-activity table, never the tiles or blockers. Hidden cards are not remembered across visits; layout and sort are.
- **Seen by the owner:** the owner said everything looks good for now. Claude has never looked at a browser, and tests cover the numbers, not the visuals; phone width, dark mode and every range have not been checked systematically.
- **Workload view, stage 1a built (not yet seen in a browser; no real refresh has been run against it):** Jira-sized open work against days available, data version 4. It is now the whole Capacity page: the typed-in quarterly Plan view was retired on 2026-11-04 (never used, a second source of truth). Design spec: `docs/superpowers/specs/2026-11-04-workload-view-design.md`; maths: `docs/capacity-calculations.md`. **Direction set by the owner (2026-11-04): sized work alone is not enough, tickets need start and end dates in Jira.** Chosen fields: **Start date** and **Due date**. The start date is already read into each ticket (`sd`; due date is `d`); the load maths does not use either yet. Only 6 of 145 open tickets had both when checked, so adoption is a team habit the app cannot fix; coverage must be shown. **Next, in order:** scheduled load (spread each ticket's size over its start-to-due work days, show load week by week, unscheduled tickets keep the projected queue as a labelled estimate; needs its own design); 1b custom calendar picker; 2 person drill-down page; 3 projected timeline chart; 4 history view (delivered work for past ranges); 5 dated time off; 6 story-point fallback. The T-shirt field is almost empty in Jira (1 of 145 open tickets when checked), so most work shows as unsized until the team fills it in.
- **Wave 7a (retired from the page 2026-11-04, never used):** planned % by portfolio per person per fiscal quarter, team and portfolio roll-ups, status at 90/100%. **Next:** Wave 7b (compare the plan with Jira: map parent epics to portfolios, needs data version 4 with each ticket's epic, not started). Story-point velocity, only once the owner names the field (only one of the four candidate story-point fields has any data, set on 72% of closed tickets and 28% of open ones; its ID is in the git-ignored `CLAUDE.local.md`). **Later:** per-designer drill-down, time spent in each status. **Deferred on request:** scheduled digest.
- **Chores still open:** rewrite or delete the out-of-date skill (see Stale pieces); spot-check one past week's closed count against Jira; confirm FY2027 dates; find out whether the Jira key is read-only.

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

## Open questions

- Is the Jira API key read-only? Unknown. It worked through both the scoped gateway and the site URL, which suggests an unscoped key, but that is an inference. A scoped read-only key (`read:jira-work`, `read:jira-user`) would only change `.env`.
- Which story-point field does the team use, if any?
- Does FY2027 follow the FY2026 pattern (starts 2027-01-31, quarters 16/12/12/12)?

## Packages

`node_modules` was copied from the sibling reference app because the Artifactory login failed. `package.json` pins those versions, including `mx-web-components` and `react-mx-web-components`. `.npmrc` points this project at public npm; the global `~/.npmrc` is untouched.

- A fresh `npm install` from public npm hit an ERESOLVE peer-dependency conflict around `shadcn` and its Babel packages. For a reinstall, fix the Artifactory login or retry with `--legacy-peer-deps`, then run `npm test` and `npm run build`.
- The MX package registers every KDS component at startup, so the build has a 1.8 MB chunk (`mx-zing-grid`) and a main bundle near 850 KB. Fine on localhost. Loading only `kds-message` would shrink it.

## Atlassian MCP

Registered with `claude mcp add --transport http atlassian https://mcp.atlassian.com/v2/mcp`, for one project directory only (the Desktop folder at the time), so a session started in this folder will not see it unless it is re-added here or with `--scope user`. Authenticate with `/mcp`. It was useful for exploring Jira. The app itself does not use it.

## Gotchas

- zsh treats `?` in URLs as a glob. Quote URLs.
- `gh api` and `gh repo clone` work for the reference repo.
- JQL on this site accepts the Pair field as `cf[<id>]` and by display name. Search results page at 100; always follow `nextPageToken`.
- Names with `(NonEmp)` are real Jira display names; keep them exactly as in config. Titles are whitespace-normalised on refresh.
- The refresh gives up with a plain error past 2,000 tickets (the 366-day history was about 700 when checked), on any failed page (it never saves a partial list), and on an empty answer (it keeps the old file).
- A KDS message removes itself from the DOM when closed. `KdsNotice` is keyed per notice so React replaces the whole wrapper.
