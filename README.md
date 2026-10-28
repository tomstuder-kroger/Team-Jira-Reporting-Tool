# Designer Activity Report

A dashboard of what the product design team did in Jira: tickets closed, in progress, awaiting PM review and blocked, per designer, for a date range you choose, plus a list of designers with no activity. A second page, **Reports**, shows tickets opened and closed by week, open work by status, closed by designer, and velocity.

It runs on your machine at `http://127.0.0.1:5173` and is meant to stay there. The Jira key it uses never leaves this computer.

## Run it

```bash
cd ~/Desktop/designer-activity-report
npm start
```

Open http://127.0.0.1:5173. If `npm start` fails, run `./node_modules/.bin/vite` instead (see Packages below).

## First-time setup: the Jira key

The **Refresh from Jira** button needs an Atlassian API token.

1. Create a token at https://id.atlassian.com/manage-profile/security/api-tokens. A scoped token with only `read:jira-work` and `read:jira-user` is best, because the app only reads.
2. In a terminal, create the file `.env` in this folder:
   ```
   cd ~/Desktop/designer-activity-report
   cat > .env <<'EOF'
   JIRA_EMAIL=you@kroger.com
   JIRA_API_TOKEN=paste-your-token-here
   JIRA_CLOUD_ID=your-site-cloud-id
   EOF
   chmod 600 .env
   ```
   `.env.example` shows the same three lines. Your cloud ID is the `cloudId` value at `https://YOUR-SITE.atlassian.net/_edge/tenant_info`. `.env` is git-ignored. Don't paste the token into chat or commit it.
3. **Restart `npm start`.** The key is read once when the server starts.
4. Optional check: `node --env-file=.env scripts/jira-check.mjs` prints whether Jira accepts the key. It never prints the key.

You may not know whether your key is read-only. Atlassian doesn't report that through the API. Check the token list at id.atlassian.com (a scoped token shows its scopes), or ask whoever issued it. The app itself only runs one search and never writes to Jira.

## Refresh the data

Choose **Refresh from Jira** in the header. It takes a few seconds (two read-only calls: the ticket search, then the status history), saves the result, and shows a notice with the time and ticket counts. A few details:

- **Data pulled** (top right of the page) is the real time Jira was last queried. The page does not re-query Jira on its own.
- Clicking twice within 15 seconds reuses the first result.
- If Jira can't be reached or rejects the key, a red message says why and the saved data stays as it was.
- From a terminal, `npm run data:jira` does the same thing.

Refresh weekly, or whenever you want current numbers.

## Choose a date range

The **Date range** menu offers:

- Last 7, 14 or 30 days (7 is the default)
- This period (for example P10) and this quarter (for example Q3), from the Kroger fiscal calendar
- A custom start date

Changing it is instant and doesn't call Jira. Your choice is remembered in the browser.

- **Every range ends at the last refresh.** Jira keeps only each ticket's most recent update time, so a range that ended earlier would miss tickets touched since. For past weeks, use the Reports page.
- The page keeps about 4 months of history. A preset or start date that reaches back further than that is disabled or adjusted, and the page says so.
- Fiscal presets work for FY2026 and FY2027 only, and **FY2027 is assumed, not checked** (see Limits).

## Change who is tracked

Edit `config/report.config.json`:

- **`roster`**: one `{ "jiraName": "Last, First" }` per designer, using the exact Jira display name, including `(NonEmp)` where it appears.
- **`projects`**, **`issueTypes`**: what the search covers.
- **`pairFieldId`**, **`pairJqlField`**: the Pair custom field (for example `customfield_12345` and `cf[12345]`; ask your Jira admin for yours).
- **`historyDays`**: how far back the saved data goes (120).
- **`defaultRange`**: the range used the first time (`last7`).
- **`statusBuckets`**: which Jira status shows as which badge. A status that isn't listed shows as Open, and the refresh notice carries a warning. Add it here.

Then choose Refresh from Jira. A new designer's tickets appear only after a refresh. A settings page for this is planned.

## How the numbers work

- A ticket counts for a designer when they are the assignee or are named in the Pair field. A developer's ticket reaches a designer only through Pair.
- A **closed** ticket counts in the range when it was resolved in it. An **open** ticket counts when it was updated in it. "Updated" includes any edit, comments included, so a ticket can look active without real progress.
- **Active designer:** at least one ticket counted. **No activity:** none, even if they have open tickets. The table says how many.
- **Tiles:** active designers; no activity; closed; in progress; awaiting PM review; blocked. A ticket shared by two designers counts once in the tiles and appears on both cards.
- **Blocked** shows every open Blocked ticket on the roster, whatever the range, and marks the ones with no recent update.
- **Statuses** group into five badges: Closed; In Progress; PM Review (also Ready for Review and Ready for Test); Blocked; Open (also In Discovery and Selected).
- The one-line note on each card is generated from ticket statuses, for example "Updated in the last 7 days: 7 closed, 1 in PM review. Blocked: ABC-123." It describes counts only, not causes or progress.

## Reports page

Choose **Reports** in the header (the address ends in `#/reports`). Pick how many weeks to show: 4, 8 (default), 12, or all saved weeks. Everything is computed from the saved data, so it never calls Jira.

- **Opened and closed by week:** a bar chart and a table. Opened counts by created date, closed by resolved date. Weeks run Sunday to Saturday. The week in progress is marked "to date" and ends at the last refresh.
- **Open work by status:** a donut of open tickets right now. It is a snapshot and ignores the weeks shown.
- **Closed by designer:** tickets resolved in the weeks shown, split into assigned to them and paired.
- **Velocity, without story points:** average tickets closed per week over the last four complete weeks, best and lowest week, and median days from created to resolved. The week in progress is left out of the average.
- A ticket opened and closed in the same week counts in both columns. A reopened ticket uses its latest resolved date.
- **Watch for bulk closes.** A cleanup that closes dozens of tickets at once raises that week's count and the average. The median time to close is steadier.
- **Blocked over time:** a chart of tickets blocked at the end of each week, plus "New blocks" and "Blocked at end" columns in the weekly table. Three tiles show tickets blocked now, the longest current block in days, and the median days of blocks that ended in the weeks shown.
- A block runs from the change into a Blocked status to the change out of it, or to the resolved time, or to the last refresh if it is still blocked. If a ticket's first recorded change leaves Blocked, it counts as blocked since it was created.
- On the Dashboard, each active blocker also shows how many days it has been blocked.
- Not shown yet: story-point velocity.

## What the page is made of

- Header with the Kroger logo, **Refresh from Jira** and a light/dark toggle, styled after a sibling Kroger app's header.
- Refresh result in a KDS message (the MX Web component). Errors and the blocker banner use shadcn-style alerts.
- Fonts and colors from that app's theme: DM Sans, Nunito, shadcn tokens, light and dark.

## Files

```
config/report.config.json      roster, projects, status mapping, history length
public/data/report.json        generated data the page loads (do not edit)
server/                        refresh endpoint and Jira client (read-only), with tests
scripts/                       merge step, CLI refresh, credential check
src/lib/                       counting (report.js), ranges (windows.js), fiscal calendar (fiscal.js), weekly counts (weeks.js), blocked spells (blocked.js), page route (route.js)
src/components/                header, dashboard, reports page and its charts, range menu, tiles, cards, table
.env                           your Jira key (git-ignored, you create it)
CLAUDE.md                      background, rules, and Wave 4 notes for Claude Code
```

## Keeping it safe to publish

This repository is public, so only synthetic data goes into it. `.gitignore` keeps these on your machine: `.env` (the key), `config/report.config.json` (your roster, Jira site, project keys and field IDs), `public/data/*` (pulled tickets), `data-raw/` (backups), and `CLAUDE.local.md`. The committed `config/report.config.example.json` has made-up values, and a fresh clone shows a banner until you copy it to `report.config.json` and fill it in.

Before every commit, check what is staged and look for leaks:

```bash
git status --short                 # nothing from the list above should appear
git diff --cached --name-only | xargs grep -InE "atlassian\.net|customfield_1[0-9]{4}|ATATT|[A-Z]{3,6}-[0-9]{3,6}" || echo "clean"
```

If a key is ever committed, treat it as exposed: revoke it at https://id.atlassian.com/manage-profile/security/api-tokens and create a new one. Deleting the commit isn't enough, because it may already be copied.

## Tests

```bash
npm test
```

97 tests, none needing the network: the counting rules, the weekly counts, velocity and blocked spells, the date ranges, all 13 FY2026 fiscal periods against Kroger's printed calendar, the merge step, and the Jira client and refresh endpoint against a fake Jira (paging, bad key, no network, timeouts, an empty answer, rapid clicks).

## Packages

`node_modules` was copied from another local project because the Artifactory login didn't work. `package.json` pins those versions and `.npmrc` points this project at public npm. A fresh `npm install` hit a peer-dependency conflict (ERESOLVE) around `shadcn`. To reinstall, fix the Artifactory login, or retry with `npm install --legacy-peer-deps`, then run `npm test` and `npm run build`.

The MX components make the build heavy (a 1.8 MB chunk). That is fine on localhost.

## Out of date: the Claude Code refresh route

Earlier the data came through Claude Code and the Atlassian MCP, using the `/refresh-designer-report` skill. **That skill is out of date**: it still produces files in the old format, which the page no longer reads. Use the Refresh button instead. The skill needs rewriting or removing. `data-raw/` holds old working files and backups from that route and can be deleted.

## What is not built yet

- Time spent in each status (for example days in PM review).
- A settings page for the roster, and a drill-down per designer.
- A scheduled digest (deferred on request).

## Limits to know

- The data is a snapshot from your last refresh.
- Only tickets in the six configured projects and five issue types are included.
- **Velocity can't rest on story points yet.** The team doesn't use them consistently. Tickets closed per week is the dependable measure.
- **FY2027 dates are assumed**, not checked against a printed calendar. FY2026 was checked. After FY2027 the fiscal presets disappear.
- The Jira key may not be read-only (see setup).
- Layout at phone width and in dark mode hasn't been checked in a browser.

## After upgrading to the status-history version

The saved file format changed (version 3). The page shows "report.json is in an older format" until you choose **Refresh from Jira** once. The refresh now makes a second read-only call for each ticket's status changes, and the file is about 60 KB larger. Statuses that appear in a ticket's history but are not listed in `statusBuckets` (for example old workflow steps) do not affect the blocked numbers, because only Blocked matters there.
