# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A dashboard of Jira activity for the 12-person product design team. For a chosen date range it shows, per designer, the tickets they were assigned or paired on that moved, plus summary tiles, open blockers, and a table of designers with no activity. The look follows `capacity-planning-app`: Kroger header and logo, DM Sans and Nunito, shadcn tokens, and a KDS message (`kds-message` from MX Web) for the refresh notice.

Owner: the product design lead. Audience: design leadership. **Localhost only, by decision.** The Jira key lives in `.env` on this machine and the app is not to be hosted or shared.

## Commands

```bash
npm start                                   # dev server and refresh endpoint, http://127.0.0.1:5173
npm test                                    # vitest, runs once (55 tests)
npm run build                               # production build to dist/
npm run data:jira                           # same refresh as the header button, from the terminal
node --env-file=.env scripts/jira-check.mjs # checks the credentials, prints status codes only
```

If `npm` fails, run the binaries from `node_modules/.bin/` (see Packages). `npm run data:merge` exists but belongs to the retired MCP route; see "Stale pieces".

## How data flows

```
Refresh from Jira (header) --POST /api/refresh--> server/ (middleware inside the Vite dev server)
  --> Jira REST, one search, api.atlassian.com gateway --> public/data/report.json (version 2)

page --fetch--> report.json --> src/lib/windows.js (the range) + src/lib/report.js buildReport() --> components
```

- `report.json` holds **timestamps only**: each ticket has `c` created, `u` updated, `r` resolved (null while open). About four months of history (`historyDays`, 120). It is about 110 KB for roughly 400 tickets.
- **Which tickets count in the range is decided in the browser.** Changing the range never calls Jira. The page rejects any file whose `version` is not 2 and tells the user to refresh.
- The server code is plain modules in `server/` so it is unit tested with a mocked Jira. `vite.config.js` mounts it with `configureServer`; `.env` is read once when the dev server starts, so **restart `npm start` after editing `.env`**.
- Credentials never reach the browser. The endpoint's responses and errors never contain them (tested).

## Files that matter

| Path | Role |
|---|---|
| `config/report.config.json` | Roster, projects, issue types, Pair field IDs, `historyDays`, `defaultRange`, status-to-bucket map. |
| `public/data/report.json` | Generated. Do not hand-edit. |
| `server/api.mjs` | `POST /api/refresh` middleware: localhost Host and same-origin checks, 15 s cooldown, shares one Jira call between overlapping clicks. |
| `server/jira.mjs` | Read-only Jira client: POST `/rest/api/3/search/jql`, follows `nextPageToken`, 30 s timeout, plain-language errors. |
| `server/queries.mjs` | Builds the one JQL search and validates config. |
| `server/refresh.mjs`, `run.mjs`, `store.mjs` | Maps issues to rows, calls the merge, writes the file atomically (temp file, then rename). |
| `scripts/merge-lib.mjs` | Pure merge: dedupe, drop non-roster tickets, normalise timestamps, stamp `pulledAt`. |
| `scripts/refresh-jira.mjs`, `jira-check.mjs` | CLI refresh and credential check. |
| `src/lib/report.js` | `buildReport(data, window)`: buckets, counts, active/quiet split, blockers, tiles, notes. |
| `src/lib/windows.js` | Presets, custom start date, clamping, saved choice. |
| `src/lib/fiscal.js` | Kroger fiscal calendar. |
| `src/App.jsx` | Loads the data, refresh state, layout. |
| `src/components/` | Header, RangeControls, KpiStrip, BlockerAlert, DesignerCard, QuietTable, StatusBadge, KdsNotice. |
| `src/components/ui/` | shadcn-style primitives. `alert`, `badge`, `button`, `label` are copied from the sibling reference app. `card` is new. |
| `src/index.css` | Theme tokens (oklch), copied from the sibling reference app. Light and `.dark`. |

## Definitions (keep code, docs, and the UI footer consistent)

- **Roster:** the names in `config.roster`, by Jira display name.
- **Counts for a designer:** assigned to them, or named in the Pair field. A developer's ticket reaches a designer only through Pair.
- **Range:** starts at a rolling offset (last 7, 14, 30 days from the pull) or a local midnight (this fiscal period, this fiscal quarter, a custom start date). **It always ends at the last pull.** Jira keeps only a ticket's latest update time, so a range ending earlier would silently miss tickets touched since. Do not add end-date controls without status history.
- **Moved in the range:** a closed ticket when its resolved date is in the range; an open ticket when its updated date is in the range. "Updated" includes any edit, comments included. A closed ticket edited after it closed is not moved.
- **Active designer:** at least one moved ticket. **No activity:** none, even if they have open tickets; the table says how many.
- **Tiles:** active; no activity; closed (moved and in a Closed status); in progress and PM review (moved tickets currently in that bucket); blocked. **Blocked is every open Blocked ticket on the roster, regardless of range.** A ticket shared by two designers counts once in the tiles and appears on both cards.
- **Buckets:** Closed; In Progress; PM Review (also Ready for Review, Ready for Test); Blocked; Open (also In Discovery, Selected). An unmapped status falls back to `defaultBucket` (open) and the refresh returns a warning.
- **Card notes** are generated from statuses only ("Updated in the last 7 days: 7 closed, 1 in PM review. Blocked: ABC-123."). No model-written text remains. Keep it that way: never invent causes, effort, or intent.
- **Fiscal calendar:** 13 four-week periods, Sunday to Saturday. Quarters are P1-4 (16 weeks), P5-7, P8-10, P11-13 (12 weeks each). FY2026 starts 2026-02-01 and was checked against Kroger's printed calendar, all 13 periods. FY2027 is assumed to start 2027-01-31 on the same pattern and is **not verified**. After FY2027 `fiscalPosition()` returns null and the fiscal presets hide.

## Rules

- **This repository is public.** Never commit real names, ticket keys or titles, Jira site, cloud ID, project keys, field IDs, or `report.json`. Real values live in git-ignored files: `.env`, `config/report.config.json`, `public/data/*`, `data-raw/`, and `CLAUDE.local.md`. Use fake values (`Doe, Jamie`, `ABC-123`) in docs, tests and examples. Run the leak check in the README before every commit.
- Counting lives in code with tests. If a number looks wrong, fix `report.js` and add a test; do not patch the data.
- Never ask the user to paste a token or password into chat. Never print `.env` values. Checks print status codes and counts only.
- Do not modify the sibling reference app that supplied the look and `node_modules` (a local clone on this machine). It is read-only.
- The app must stay read-only toward Jira. The only call is the search, which is a POST that reads. Do not add anything that writes.
- Do not copy credentials between `.npmrc` files or anywhere else without asking.
- Before refreshing for real, `public/data/report.json` can be copied to `data-raw/` as a backup. `data-raw/` is git-ignored.

## Tests

55 tests in three files, all without network: `src/lib/report.test.js` (counting rules on fixed fixtures, sanity checks on the checked-in data, all 13 fiscal periods and the quarter edges, range resolution), `scripts/merge-lib.test.js`, `server/server.test.js` (Jira client, queries, refresh, endpoint with a mocked Jira). The checked-in-data tests assert properties (every roster member present, wider ranges never show fewer closed tickets) and not exact totals, so a normal refresh does not break them.

## Stale pieces

- **`.claude/skills/refresh-designer-report/SKILL.md` and the Atlassian MCP route are out of date.** The skill still produces `moved` lists and written notes, which the page no longer uses. Do not run it until it is rewritten. The header button and `npm run data:jira` are the supported route.
- `scripts/merge-report.mjs` (`npm run data:merge`) was rewritten for the new format but nothing feeds it now; it needs `data-raw/pool.json` rows with `c`, `u`, `r`.
- `data-raw/` holds old-format files (`moved.json`, `notes.json`, `pool.json`) and backups of earlier data. Safe to delete.

## Status

- **Done:** theme, header and refresh button; live refresh from Jira; date ranges with fiscal presets; factual notes.
- **Not seen by the owner yet:** the range dropdown and custom date picker. Layout at phone width and in dark mode has not been checked in a browser.
- **Next: Wave 4, the reports page. Start in plan mode**, as the owner asked, and discuss before building. The owner wants a separate page (a header link) with pie and bar charts, a table of issues opened, closed and blocked over time, and some support for velocity.
- **Later:** status history (blocked over time, days blocked, the date a ticket closed), roster settings page, per-designer drill-down. **Deferred on request:** scheduled digest.

## Facts to use when planning Wave 4

- Jira returns created, updated and resolved times for every ticket, so opened and closed by week are available now.
- Blocked over time needs each ticket's status history (the `changelog` expand). A sample of 100 tickets took about 3.5 seconds and showed 203 status changes, 6 into Blocked. Jira truncated the history on 13 of the 100, and those would need another call each; that was not tested.
- A ticket's resolved date can change if it is reopened and closed again. How often that happens was not measured.
- **Velocity:** the team does not use story points or T-shirt sizes consistently, and the owner cannot require it yet. A Story Points field was set on about 74% of tickets closed in 90 days, but several similarly named fields exist and it is not known which the team uses (the field IDs are in the git-ignored `CLAUDE.local.md`). Tickets closed per week is the dependable measure; points should be optional and shown with their coverage.
- Charts: shadcn's chart component needs `recharts`, which is not installed, and package installs have been unreliable here. The reference app has no charting library. Plain SVG with the existing color tokens is the likely route.
- Weeks run Sunday to Saturday because FY2026 starts on a Sunday.

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
- The refresh gives up with a plain error past 2,000 tickets, on any failed page (it never saves a partial list), and on an empty answer (it keeps the old file).
- A KDS message removes itself from the DOM when closed. `KdsNotice` is keyed per notice so React replaces the whole wrapper.
