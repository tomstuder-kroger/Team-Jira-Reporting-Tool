# Designer Activity Report

A dashboard of what the product design team did in Jira: tickets closed, in progress, awaiting PM review and blocked, per designer, for a date range you choose (including past periods and a comparison with an earlier one), plus a list of designers with no activity.

There are three pages, linked in the header:

- **Dashboard:** summary tiles, active blockers, and one card per designer (grid or list, sortable, filterable, each card can be hidden down to its counts).
- **Reports:** tickets opened and closed by week, blocked over time, open work by status, closed by designer, and velocity.
- **Roster:** add or remove the designers who are tracked, by searching Jira.

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

The **Date range** menu groups its choices:

- **Rolling, from the last refresh:** last 7, 14 or 30 days (7 is the default).
- **Calendar:** this week, and the last full week (Sunday to Saturday).
- **Fiscal:** this period (for example P10), last period, this quarter, last quarter, and fiscal year to date, from the Kroger fiscal calendar.
- **Custom dates:** a start and an end date. Leave the end as the latest date to mean "up to the last refresh".

**Compare with** shows each summary tile next to a second range, so you can see the change ("+3 vs 12 compared"). Green means better, red means worse, and plain grey means the direction is neither (in progress, in review). It offers:

- **Nothing** (the default): no comparison.
- **Previous range:** chosen for you. After "Last period" or "Last quarter" it is the fiscal period or quarter before; for anything else it is the range of the same length that ends where yours starts.
- **Any range from the Date range menu** (last week, last period, last quarter, fiscal year to date, and so on), so you can compare This period with Last period.

A choice is greyed out, with a short reason, when it is the range you are viewing, overlaps it, reaches back past the saved data, or starts after the last refresh. The page shows both ranges and their lengths in days next to the title. **When the two ranges differ in length** (for example 18 days of this period against all 28 of the last), a note under the tiles says so, because totals such as tickets closed are then not like for like.

Changing any of this is instant and doesn't call Jira. Your choice is remembered in the browser.

- **Calendar and fiscal choices follow today's date.** "This period" is whichever period today falls in, and it moves on by itself, even on a page left open overnight. Rolling choices count back from the last refresh instead, so they match the saved data.
- **A range never goes past the last refresh.** If today is newer than the saved data, the page says so. A range that starts after the last refresh is greyed out, "no data yet". Choose Refresh from Jira.
- **A ticket counts in a range when it was created, resolved, or changed status in it.** Comment-only edits do not count, so the numbers are lower than the earlier "updated" rule gave.
- **Statuses are shown as they were at the end of the range.** For a past range, a ticket that has since closed shows as it was then. In progress, in review and blocked are counted as of the range's last day.
- The saved data goes back **366 days** (about a year). A choice that reaches back further is greyed out.
- Fiscal choices work for FY2026 and FY2027 only, and **FY2027 is assumed, not checked** (see Limits).

## Designer cards: layout, sort, filter, show and hide

Above the cards on the Dashboard:

- **Filter by name** matches last or first name, in either order, ignoring case ("doe", "jamie", "doe, ja"). It filters the active cards and the no-activity table. The summary tiles and the blocker list always cover everyone.
- **Sort by:** needs attention first (blockers, then most activity, the original order), or last name A to Z or Z to A.
- **Layout:** **Grid** (cards side by side, as before) or **List** (one full-width card per person). Your layout and sort are remembered in the browser.
- **Hide or show:** each card's name has an arrow. Hiding a card keeps the name, the assigned and paired counts, and the status badges (closed, in progress, PM review, blocked) and hides the ticket lists and the note. **Show all** and **Hide all** do every card at once. Which cards are hidden is not remembered, so every visit starts with all shown.

## Change who is tracked

**Use the Roster page** (header link, address ends in `#/roster`). Type part of a name, pick the person Jira finds, then **Save roster**. Remove someone with **Remove** (**Undo** brings them back before you save). Nothing changes until you save, and **Discard changes** throws away your edits.

- Names come from a read-only Jira user search, so they match Jira exactly, including `(NonEmp)`. Only display names are kept, never emails or IDs.
- Saving rewrites **only** the `roster` part of `config/report.config.json` on this computer and keeps the previous file as `config/report.config.backup.json`. Nothing is changed in Jira. The page reloads so every view uses the new roster.
- A removed designer disappears right away. **A new designer's tickets appear only after Refresh from Jira.** The page offers the button after you save.
- It needs `config/report.config.json` to exist (see Keeping it safe to publish). On the example config the page explains this and Save is disabled.
- Two people can share a name, so check the full name in the results.

You can still edit `config/report.config.json` by hand. Everything else in it:

- **`roster`**: one `{ "jiraName": "Last, First" }` per designer, using the exact Jira display name, including `(NonEmp)` where it appears.
- **`projects`**, **`issueTypes`**: what the search covers.
- **`pairFieldId`**, **`pairJqlField`**: the Pair custom field (for example `customfield_12345` and `cf[12345]`; ask your Jira admin for yours).
- **`historyDays`**: how far back the saved data goes (366, the most allowed, so past fiscal periods can be picked). A longer history makes refresh a little slower and the file bigger.
- **`defaultRange`**: the range used the first time (`last7`).
- **`statusBuckets`**: which Jira status shows as which badge. A status that isn't listed shows as Open, and the refresh notice carries a warning. Add it here.

Then choose Refresh from Jira.

## How the numbers work

- A ticket counts for a designer when they are the assignee or are named in the Pair field. A developer's ticket reaches a designer only through Pair.
- A ticket **counts in a range** when it was created, resolved, or changed status in it (see Choose a date range). A **closed** count is tickets resolved in the range.
- **Active designer:** at least one ticket counted. **No activity:** none, even if they have open tickets. The table says how many.
- **Tiles:** active designers; no activity; closed; in progress; awaiting PM review; blocked. A ticket shared by two designers counts once in the tiles and appears on both cards.
- **Blocked** shows every ticket that was Blocked at the end of the range, with how many days it had been blocked, and marks the ones with no status change in the range.
- **Statuses** group into five badges: Closed; In Progress; PM Review (also Ready for Review and Ready for Test); Blocked; Open (also In Discovery and Selected).
- The one-line note on each card is generated from ticket statuses, for example "Activity in the last 7 days: 7 closed, 1 in PM review. Blocked: ABC-123." It describes counts only, not causes or progress.

## Reports page

Choose **Reports** in the header (the address ends in `#/reports`). Pick how many weeks to show: 1, 2, 4, 8 (default), 12, all saved weeks, or **Custom number of weeks** at the bottom of the menu, which opens a box for any whole number from 1 up to the weeks saved (about 50). A number that is too big is held to the most weeks saved. Choices that need more weeks than are saved are greyed out. Everything is computed from the saved data, so it never calls Jira.

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
config/report.config.json      roster, projects, status mapping, history length (git-ignored; see below)
public/data/report.json        generated data the page loads (git-ignored, do not edit)
server/                        refresh and roster endpoints, read-only Jira client, with tests
scripts/                       merge step, CLI refresh, credential check
src/lib/                       counting (report.js), date ranges (windows.js), fiscal calendar (fiscal.js),
                               status replay (history.js), weekly counts (weeks.js), blocked spells (blocked.js),
                               card sort and filter (designers.js), page route (route.js), today's date (today.js)
src/components/                header, dashboard and its card toolbar, reports page and its charts,
                               roster page, range menu, tiles, cards, table
.env                           your Jira key (git-ignored, you create it)
CLAUDE.md                      background, rules, definitions and status for Claude Code
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

174 tests, none needing the network: the counting rules, the weekly counts, velocity and blocked spells, the date ranges, all 13 FY2026 fiscal periods against Kroger's printed calendar, the merge step, the roster page's save and search endpoints, and the Jira client and refresh endpoint against a fake Jira (paging, bad key, no network, timeouts, an empty answer, rapid clicks).

## Packages

`node_modules` was copied from another local project because the Artifactory login didn't work. `package.json` pins those versions and `.npmrc` points this project at public npm. A fresh `npm install` hit a peer-dependency conflict (ERESOLVE) around `shadcn`. To reinstall, fix the Artifactory login, or retry with `npm install --legacy-peer-deps`, then run `npm test` and `npm run build`.

The MX components make the build heavy (a 1.8 MB chunk). That is fine on localhost.

## Out of date: the Claude Code refresh route

Earlier the data came through Claude Code and the Atlassian MCP, using the `/refresh-designer-report` skill. **That skill is out of date**: it still produces files in the old format, which the page no longer reads. Use the Refresh button instead. The skill needs rewriting or removing. `data-raw/` holds old working files and backups from that route and can be deleted.

## What is not built yet

- Time spent in each status (for example days in PM review).
- A drill-down per designer.
- Story-point velocity, once the team settles on one story-point field.
- A scheduled digest (deferred on request).

## Limits to know

- The data is a snapshot from your last refresh.
- Only tickets in the six configured projects and five issue types are included.
- **Velocity can't rest on story points yet.** The team doesn't use them consistently. Tickets closed per week is the dependable measure.
- **FY2027 dates are assumed**, not checked against a printed calendar. FY2026 was checked. After FY2027 the fiscal presets disappear.
- The Jira key may not be read-only (see setup).
- Phone width and dark mode have not been checked systematically on every page. The tests cover the numbers, not how the pages look.

## After upgrading from an older version

Choose **Refresh from Jira** once. The saved file format changed (version 3: it now holds each ticket's status changes), and until you refresh the page says "report.json is in an older format". The refresh makes two read-only calls (the ticket search, then the status history), pulls about a year of history (about 700 tickets), took about 6 seconds when checked, and saves a file of about 350 KB. Until you refresh, fiscal choices that reach back before the saved data are greyed out.

Statuses that appear in a ticket's history but are not listed in `statusBuckets` (for example old workflow steps) do not affect the blocked numbers, because only Blocked matters there.
