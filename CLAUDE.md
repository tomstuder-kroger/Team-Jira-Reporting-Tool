# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A dashboard of Jira activity for the product design team. Three pages (hash routes): **Dashboard** (per-designer cards for a chosen date range, summary tiles, open blockers, a table of designers with no activity), **Reports** (opened/closed by week, blocked over time, open by status, closed by designer, velocity) and **Roster** (add/remove tracked designers by searching Jira). The look follows `capacity-planning-app`: Kroger header and logo, DM Sans and Nunito, shadcn tokens, and a KDS message (`kds-message` from MX Web) for the refresh notice.

Owner: the product design lead. Audience: design leadership. **Localhost only, by decision.** The Jira key lives in `.env` on this machine and the app is not to be hosted or shared.

## Commands

```bash
npm start                                   # dev server and refresh endpoint, http://127.0.0.1:5173
npm test                                    # vitest, runs once (152 tests)
npm run build                               # production build to dist/
npm run data:jira                           # same refresh as the header button, from the terminal
node --env-file=.env scripts/jira-check.mjs # checks the credentials, prints status codes only
```

If `npm` fails, run the binaries from `node_modules/.bin/` (see Packages). `npm run data:merge` exists but belongs to the retired MCP route; see "Stale pieces".

## How data flows

```
Refresh from Jira (header) --POST /api/refresh--> server/ (middleware inside the Vite dev server)
  --> Jira REST, one search plus one bulk status-history call, api.atlassian.com gateway --> public/data/report.json (version 3)

page --fetch--> report.json --> src/lib/windows.js (the range) + src/lib/report.js buildReport() --> components
```

- `report.json` (version 3) holds **timestamps and status changes only**: each ticket has `c` created, `u` updated, `r` resolved (null while open), and `h`, its status changes `[timestamp, from, to]` oldest first. About a year of history (`historyDays`, 366, the maximum). About 350 KB for roughly 700 tickets; a refresh took about 6 seconds when checked.
- **Which tickets count in the range is decided in the browser.** Changing the range never calls Jira. The page rejects any file whose `version` is not 3 and tells the user to refresh.
- The server code is plain modules in `server/` so it is unit tested with a mocked Jira. `vite.config.js` mounts it with `configureServer`; `.env` is read once when the dev server starts, so **restart `npm start` after editing `.env`**. The roster endpoints rewrite `config/report.config.json` (roster key only); Vite reloads the page when it changes.
- Credentials never reach the browser. The endpoint's responses and errors never contain them (tested).

## Files that matter

| Path | Role |
|---|---|
| `config/report.config.json` | Roster, projects, issue types, Pair field IDs, `historyDays`, `defaultRange`, status-to-bucket map. |
| `public/data/report.json` | Generated. Do not hand-edit. |
| `server/api.mjs` | `POST /api/refresh` middleware: localhost Host and same-origin checks, 15 s cooldown, shares one Jira call between overlapping clicks. |
| `server/guard.mjs`, `config.mjs` | Shared localhost/same-origin check, JSON body reader, and config reader used by every endpoint. |
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
| `src/lib/fiscal.js` | Kroger fiscal calendar. |
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
- **Compare:** `range.compare === 'previous'` adds `prev`, `change` and `good` to each KPI tile. Previous = the fiscal period or quarter before a "last" preset (`prev` field), else the same length ending where this window starts. Unavailable (with a reason) if it reaches before `historyStart`.
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

152 tests in nine files, all without network: `src/lib/report.test.js` (counting rules on fixed fixtures, sanity checks on the checked-in data, all 13 fiscal periods and the quarter edges, range resolution), `scripts/merge-lib.test.js`, `server/server.test.js` (Jira client, queries, refresh, endpoint with a mocked Jira), `server/roster.test.js` (roster validation and save, backup, endpoint guards, user search leaks no email or ID), `src/lib/designers.test.js` (last-name sort, name filter, saved layout), `src/components/DesignerCard.test.jsx` (hidden card keeps name, counts and badges), `src/lib/history.test.js` (status replay, activity rule, open at end), `src/lib/blocked.test.js` (blocked spells and weekly blocked counts), `src/lib/weeks.test.js` (week boundaries, opened/closed, velocity, status snapshot, designer split; two property checks on the real data that skip on a fresh clone). The checked-in-data tests assert properties (every roster member present, wider ranges never show fewer closed tickets) and not exact totals, so a normal refresh does not break them.

## Stale pieces

- **`.claude/skills/refresh-designer-report/SKILL.md` and the Atlassian MCP route are out of date.** The skill still produces `moved` lists and written notes, which the page no longer uses. Do not run it until it is rewritten. The header button and `npm run data:jira` are the supported route.
- `scripts/merge-report.mjs` (`npm run data:merge`) was rewritten for the new format but nothing feeds it now; it needs `data-raw/pool.json` rows with `c`, `u`, `r`.
- `data-raw/` holds old-format files (`moved.json`, `notes.json`, `pool.json`) and backups of earlier data. Safe to delete.

## Status

- **Built, in this order:** theme and header; live refresh from Jira; date ranges and factual notes; Wave 4 Reports page; Wave 5a status history (blocked over time, days blocked); Wave 5b Roster page; Wave 6 date range rework (this/last week, period, quarter, fiscal year to date, custom start and end, compare, status-change activity rule, statuses as at the end of the range, 366 days of history); Dashboard card controls (grid/list, show/hide that keeps name, counts and badges, last-name sort, name filter). Filter and sort affect only the cards and the no-activity table, never the tiles or blockers. Hidden cards are not remembered across visits; layout and sort are.
- **Seen by the owner:** the owner said everything looks good for now. Claude has never looked at a browser, and tests cover the numbers, not the visuals; phone width, dark mode and every range have not been checked systematically.
- **Next:** story-point velocity, only once the owner names the field. **Later:** per-designer drill-down, time spent in each status. **Deferred on request:** scheduled digest.
- **Chores still open:** rewrite or delete the out-of-date skill (see Stale pieces); spot-check one past week's closed count against Jira; confirm FY2027 dates; find out whether the Jira key is read-only.

## Blocked definitions

- A **spell** starts at a change into a status that `statusBuckets` maps to Blocked and ends at the next change out, at the resolved time, or stays open until the pull. A first change that leaves Blocked means blocked since created.
- **Blocked at week end:** tickets in a spell when the week ended (at the pull for the week in progress). **New blocks:** spells that started in the week. **Median days blocked:** spells that ended inside the weeks shown.
- Tickets follow their current assignee and Pair, so a reassigned ticket's past blocks count for its current owner.
- History statuses that are not in `statusBuckets` (the real data has two old workflow steps) do not matter for blocked, since only Blocked is looked at.
- Checked once against Jira: the set of tickets with a change into Blocked matched a Jira `status CHANGED TO Blocked` search exactly.

## Reports page definitions

- **Opened:** created date. **Closed:** resolved date (latest, so a reopened ticket moves). Both for roster tickets (assignee or Pair). A ticket opened and closed in the same week counts in both.
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
