# Designer Activity Report

A dashboard of what the product design team did in Jira: tickets closed, in progress, awaiting PM review and blocked, per designer, for a date range you choose (including past periods and a comparison with an earlier one), plus a list of designers with no activity.

There are four pages, linked in the header:

- **Dashboard:** summary tiles, active blockers, and one card per designer (grid or list, sortable, filterable, each card can be hidden down to its counts).
- **Reports:** tickets opened and closed by week, blocked over time, open work by status, closed by designer, and velocity.
- **Capacity:** each designer's open Jira work (sized by T-shirt, queued by Jira rank) against the working days they have in a window you choose, with a team total.
- **Roster:** add or remove the designers who are tracked, by searching Jira or typing their exact Jira name.

It runs on your machine at `http://127.0.0.1:5173` and is meant to stay there. Your Jira key or sign-in stays on this computer and is never sent to the browser. If you refresh through the Atlassian MCP (see below), ticket content also passes through Claude while the refresh runs.

## Run it

```bash
cd ~/Desktop/designer-activity-report
npm start
```

Open http://127.0.0.1:5173. If `npm start` fails, run `./node_modules/.bin/vite` instead (see Packages below).

## First-time setup

**Before either route**, copy `config/report.config.example.json` to `config/report.config.json` and fill it in. `config/report.config.json` is git-ignored because it holds real names and IDs.

- `roster`: the designers, by exact Jira display name (the Roster page can do this for you later).
- `siteUrl`, `cloudId`: your Jira site (`cloudId` is the value at `https://YOUR-SITE.atlassian.net/_edge/tenant_info`).
- `projects`, `issueTypes`: what to track.
- `pairFieldId`, `pairJqlField`: the Pair custom field. Ask your Jira admin.
- Optional `workload` block (field IDs for T-shirt size, rank and start date) for the Capacity page. Without it everything else works and Capacity says it is not set up.
- Optional `fieldNames`: the on-screen names of the Pair, Rank, T-shirt size and Start date fields, used only by the MCP route. They default to `Pair`, `Rank`, `T-Shirt Sizing` and `Start date`; override them if your site names them differently.

Then choose how the app gets data from Jira.

### Route 1: the Atlassian MCP (no API key needed)

Runs headless Claude Code on your own Atlassian sign-in. Use this if you have no API token.

1. Install Claude Code and sign in, so `claude` runs in your terminal.
2. In this folder, register the Atlassian server once:
   ```
   claude mcp add --transport http atlassian https://mcp.atlassian.com/v2/mcp
   ```
3. Start `claude` in this folder, type `/mcp`, choose **atlassian** and **Authenticate**. A browser window signs you in. Quit Claude Code afterwards.
4. Tell the app to use this route. In a terminal in this folder:
   ```
   printf '\nREFRESH_ROUTE=mcp\n' >> .env
   ```
   This line is required if an old, revoked key is still in `.env`. Check you now have exactly one such line: `grep -c '^REFRESH_ROUTE=' .env` should print `1`.
5. **Restart `npm start`.** `.env` is read once, when the server starts.
6. Choose **Refresh from Jira**. The first refresh reads every ticket and can take several minutes and a few dollars of Claude usage (see "Cost of a refresh" below). Later refreshes are much smaller.

Before the first refresh, find out how Claude usage is billed on your account. The app caps a refresh at $5 by default.

### Route 2: an Atlassian API token

1. Create a token at https://id.atlassian.com/manage-profile/security/api-tokens. A scoped token with only `read:jira-work` and `read:jira-user` is best, because the app only reads.
2. In a terminal, create the file `.env` in this folder:
   ```
   cd ~/Desktop/designer-activity-report
   cat > .env <<'EOF'
   JIRA_EMAIL=you@your-company.com
   JIRA_API_TOKEN=paste-your-token-here
   JIRA_CLOUD_ID=your-site-cloud-id
   EOF
   chmod 600 .env
   ```
   `.env.example` shows the same three lines. `.env` is git-ignored. Don't paste the token into chat or commit it.
3. **Restart `npm start`.** The key is read once when the server starts.
4. Optional check: `node --env-file=.env scripts/jira-check.mjs` prints whether Jira accepts the key. It never prints the key.

You may not know whether your key is read-only. Atlassian doesn't report that through the API. Check the token list at id.atlassian.com (a scoped token shows its scopes), or ask whoever issued it. The app itself only runs searches and never writes to Jira.

If both are set up, the app uses the API token unless `.env` says `REFRESH_ROUTE=mcp`.

### Settings you can put in `.env`

All optional. `.env` is read once when the server starts, so restart `npm start` after editing it.

| Setting | What it does |
|---|---|
| `REFRESH_ROUTE=mcp` or `rest` | Force a route. Use `mcp` if a revoked key is still in `.env`. |
| `REFRESH_MAX_USD=5` | Most a single MCP refresh may spend before it stops starting new Claude runs (default 5; runs already started finish, so it can overshoot a little). |
| `REFRESH_CONCURRENCY=3` | How many Claude runs go at once, 1 to 8 (default 3). Measured: 6 gave 27 s against 31 s, a small gain. |
| `REFRESH_MODEL=haiku` | Use a different Claude model for the copying. **Not recommended.** Haiku was cheaper but copied wrongly in a test (see the cost section). Leave unset. |

## Refresh the data

Choose **Refresh from Jira** in the header. On the API-token route it takes a few seconds (two read-only calls: the ticket search, then the status history). On the MCP route it takes longer (see below). Either way it saves the result and shows a notice with the time and ticket counts. A few details:

- **Data pulled** (top right of the page) is the real time Jira was last queried. The page does not re-query Jira on its own.
- Clicking twice within 15 seconds reuses the first result.
- If Jira can't be reached or rejects the key, a red message says why and the saved data stays as it was.
- From a terminal, `npm run data:jira` does the same thing.
- **Two routes** (set up above). With `JIRA_EMAIL` and `JIRA_API_TOKEN` in `.env` the refresh calls the Jira REST API (fast, free). Without them, or with `REFRESH_ROUTE=mcp` in `.env`, it runs headless Claude Code against the Atlassian MCP on your own sign-in. Restart `npm start` after editing `.env`.
- **MCP route behaviour:** the first refresh reads status history for every ticket and can take several minutes. A banner under the header shows what step it is on, a progress bar, the time elapsed and what it has spent against the limit. If you reload the page while a refresh runs, the banner comes back. Later refreshes read in full only the tickets updated since the last pull, check the total against Jira, and re-read status history only for tickets that changed. If a refresh fails the saved data is kept. **Reloading the page does not stop a refresh**; the server keeps going. Copy `public/data/report.json` to `data-raw/` first if you want a backup.
- **Spending limit:** a refresh on the MCP route stops starting new Claude runs once its reported cost reaches $5 (each run is also capped at $2). Change the total with `REFRESH_MAX_USD` in `.env`, for example `REFRESH_MAX_USD=10`. Runs already in flight finish, so the total can overshoot by a run or two.
- **Resuming:** history already read is saved to `data-raw/mcp-history-cache.json` after every batch of 25 tickets. If a refresh fails or hits the limit, choosing Refresh again continues from there, and the file is removed after a successful refresh.
- **Fewer tickets, lower cost:** `historyDays` in `config/report.config.json` limits how many closed tickets are read (open tickets are always read). Raising it later only reads the newly included tickets.
- **Data on the MCP route passes through Claude**, including text the app throws away (comments, descriptions, emails). See `docs/data-notes.md`.

Refresh weekly, or whenever you want current numbers.

### Cost of a refresh through the Atlassian MCP

The REST route above costs nothing per refresh but needs a Jira API key. The MCP route (spec: `docs/superpowers/specs/2026-11-18-mcp-refresh-design.md`) runs headless Claude Code (`claude -p`) on the owner's own sign-in, so each refresh uses Claude. Figures are Claude's own reported cost (`total_cost_usd`, list price). Whether that is billed or counts against a usage allowance depends on how the account is set up and has not been confirmed. Each run is capped at $2 and a whole refresh at $5 (`--max-budget-usd`, `REFRESH_MAX_USD`).

| Measured | What | Time | Cost |
|---|---|---|---|
| 2026-11-18 | Count query, first test of the headless route (full project and plugin context loaded) | 7 s | $0.35 |
| 2026-11-18 | Fetch rows for 37 tickets, search only (full context) | 39 s | $0.43 |
| 2026-11-18 | Status history for 3 new tickets, no status changes (full context) | 8 s | $0.17 |
| 2026-11-18 | Status history for 1 ticket with 36 changelog entries, 6 of them status (full context) | 7 s | $0.16 |
| 2026-11-18 | **Failed:** one whole project (about 300 tickets) in a single run, full-detail pages. Claude stopped and returned no list. | 125 s | $0.84 |
| 2026-11-18 | **Failed twice:** the same project with slimmer pages but still paging inside one run. Claude answered FAILED. | 40 s each | $0.53, $0.38 |
| 2026-11-18 | Count query, lean launch (empty folder, user settings only, no skills or built-in tools) | 3 s | $0.026 |
| 2026-11-18 | One page of 40 ticket rows, lean launch, all rows valid | 38 s | $0.16 |
| 2026-11-18 | One page of 25 rows, lean launch | 25 s | $0.12 |
| 2026-11-18 | Status history for 25 tickets, lean launch (the 25 newest, 18 status changes in total) | 51 s | $0.30 |
| 2026-11-18 | **First real refresh** (366 days): rows for all 756 tickets, history for the 120 whose updated time had changed since the saved file | not timed | **$5.82** |
| 2026-11-18 | **First incremental refresh** (366 days saved): 62 rows read in full, history for 3 tickets, fell back to a key listing because one closed ticket sat on the 366-day cutoff | 3 min 12 s | **$1.32** |
| 2026-11-19 | **Ordinary incremental refresh** (after the cutoff fix): 46 rows read in full, none of them had changed, so 0 histories; 7 runs. Timed by run type: 6 row runs took 125 s of run time in total, the count check 8 s | 53 s | **$0.34** |
| 2026-11-19 | **Ordinary incremental refresh, list first then read** (nothing changed): 6 key-listing runs (59 s of run time in total) and the count check (8 s), 0 rows read in full | 31 s | **$0.24** |
| 2026-11-19 | Same, with `REFRESH_CONCURRENCY=6` | 27 s | $0.22 |
| 2026-11-19 | Same, with `REFRESH_MODEL=haiku` | 35 s | $0.12 |
| 2026-11-19 | **Real refresh from the button, a day after the previous pull** (760 tickets): 5 rows read in full, history for 5 tickets, 9 runs | not timed | **$0.51** |
| 2026-11-19 | One page of 40 rows, default model against Haiku, same tickets: default 38 s and $0.13; **Haiku 100 s and $0.09, and 4 field values differed** (two dates and a rank string) | | |
| 2026-11-19 | Status history for 25 tickets, default model against Haiku: default 68 s, $0.54, 14 status changes; **Haiku 73 s, $0.11, only 12 status changes** (it dropped two) | | |
| 2026-11-18 | Roster user search through the MCP (10 names returned, no email in the answer) | 6 s | $0.04 |

The lean launch (`buildClaudeArgs` in `server/mcpRunner.mjs`) cut the fixed cost of a run from about $0.35 to about $0.03. Rows are fetched 40 per run and history 25 tickets per run, so cost now grows with the number of tickets, not with run overhead.

**What the numbers say.** The first real refresh cost **$5.82** for 756 tickets: it read the rows of every ticket (about 19 pages of 40 at about $0.16 each) and status history for 120 of them (about $0.30 to $0.50 per 25 tickets, depending on how long the changelogs are). It went over the $5 limit because runs already started finish before the total is checked. The first incremental refresh cost $1.32 and took 3 minutes 12 seconds because a ticket on the 366-day cutoff forced a fallback. After the cutoff fix, an ordinary refresh took 53 seconds and $0.34, almost all of it re-reading 46 tickets that had not changed. The refresh now **lists each recently touched ticket by key and updated time first (short answers) and reads in full only tickets whose updated time differs**, which took an ordinary refresh to **31 seconds and $0.24**, with 0 rows read in full. **A real refresh a day after the previous pull cost $0.51** (5 tickets read in full, 5 histories). **Adding a person is about $1 (an estimate, not measured).**

**Why it takes the time it does.** Every step is a separate Claude run, and the slow part is Claude retyping each ticket as JSON: roughly one second per ticket row and two or more per ticket of history, plus a few seconds of fixed time per run (the count check alone took 8 s). The six project listings run three at a time, and the largest project sets the pace, which is why six parallel runs gain only a few seconds. The first full pull and adding a person are still slow because they read many tickets in full.

**Is the copied data accurate?** On 2026-11-19, six closed tickets in the saved data were compared field by field with Jira, and all matched (dates after converting the time zone, status, assignee, type, rank, due date); one ticket's four status changes also matched exactly. That is a small sample. **Haiku failed the same kind of test** (changed dates and a rank, dropped status changes), so the default model is used. The app's checks catch missing or malformed rows and a wrong total, but **not a value that was miscopied**, so spot-check a few tickets against Jira now and then.

Add a row to the table above whenever you measure something.

`--bare` would be leaner still but only works with an `ANTHROPIC_API_KEY`, not the Claude Code sign-in, so it is not used.

## Troubleshooting

| What you see | Why, and what to do |
|---|---|
| **"Jira rejected the email or API token (401)"** | The REST route is being used and the key is wrong or revoked. Add `REFRESH_ROUTE=mcp` to `.env` to use the MCP route, or replace the key. Restart `npm start`. |
| **"Could not find the claude command"** | Claude Code is not on the PATH of the terminal that started `npm start`. Start the app from a terminal where `claude` works. |
| **"Not logged in" or the refresh stops early** | Your Atlassian sign-in expired. Run `claude`, type `/mcp`, choose atlassian and Authenticate again. |
| **"The refresh stopped at its spending limit"** | It reached `REFRESH_MAX_USD` ($5 by default). History already read is kept, so choose Refresh again to continue, or raise the limit in `.env`. |
| **"Claude returned N tickets but Jira reports M"** | Claude's answer was short or Jira changed mid-run. Nothing was saved. Try again; if it repeats, `POST /api/refresh?full=1` forces a full read. |
| **"Claude did not return a list of tickets"** | Claude answered in words. What it said is printed in the terminal running `npm start`. |
| **A name search finds nobody, or the Roster says "Searching too fast"** | Wait a moment; MCP searches are spaced out. Use **Add "name" as typed** with the exact Jira display name. |
| **"report.json is in an older format"** | Choose Refresh from Jira once. |
| **A status shows as Open that should not** | The refresh notice names it. Add it to `statusBuckets` in `config/report.config.json`. |
| **Capacity says it is not set up, or most work is "unsized"** | Add the `workload` block to the config, and note that the team has to fill in T-shirt sizes in Jira. |

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

## Capacity page

Choose **Capacity** in the header (the address ends in `#/capacity`). It shows **how much open Jira work each designer has against the working days they have in a window you choose.** It reads Jira (through the saved data), uses T-shirt sizes and Jira's rank, and does not use story points.

- **Window:** next 2, 4, 8 or 12 weeks, this or next week, or this or next fiscal quarter. The start is never before today, so "this" choices cover what is left. A choice with no working days left is greyed out with a reason. FY2027 quarters are labelled "assumed dates".
- **Counts:** a ticket is open work for its **assignee** when it is open, on the roster and not an Epic or Program Epic. A pair does not carry load. In Progress, PM Review and Blocked are in progress; Open is queued.
- **Sizes:** each T-shirt label has a number of days (XS 1.5, SM 5, MED 10, LG 20, XL 30 by default). **An unsized ticket adds no days but is counted and flagged**, never treated as free. Today most tickets are unsized, so loads are understated until the team fills sizes in.
- **Capacity** is 5 days a week at 100% focus by default (`daysPerWeek`, `focus`, and per-person `overrides` in the `workload` block). Time off is **not** subtracted yet.
- **Colour bands:** grey up to 50%, green to 85%, orange to 95%, red above.
- A coverage banner shows how many tickets are sized and how many have start and due dates.

The worked formulas and an example are in `docs/capacity-calculations.md`; the design is in `docs/superpowers/specs/2026-11-04-workload-view-design.md`.

**The earlier typed-in quarterly plan** (percent by portfolio, time off, teams) was retired from the page on 2026-11-04 because nobody used it and it was a second source of truth. Its files (`config/capacity.json`, `server/capacity.mjs`, `src/lib/capacity.js`) are still in the repository and nothing reads them.

Not built yet: scheduling load across each ticket's start and due dates, a per-person drill-down, a projected timeline, delivered work for past windows, dated time off, and a story-point fallback.

## Change who is tracked

**Use the Roster page** (header link, address ends in `#/roster`). Type part of a name, pick the person Jira finds, then **Save roster**. Remove someone with **Remove** (**Undo** brings them back before you save). Nothing changes until you save, and **Discard changes** throws away your edits.

- Names come from a read-only Jira user search, so they match Jira exactly, including `(NonEmp)`. Only display names are kept, never emails or IDs. With a Jira key the search uses the REST API; without one it goes through the Atlassian MCP (about $0.04 and 6 seconds a search). If someone is not found, **Add “name” as typed** adds the exact Jira display name you type. A name that does not match Jira gets an empty card.
- Saving rewrites **only** the `roster` part of `config/report.config.json` on this computer and keeps the previous file as `config/report.config.backup.json`. Nothing is changed in Jira. The page reloads so every view uses the new roster.
- **Removing someone is free and instant.** Saving also drops from `report.json` any ticket that nobody left on the roster is assigned to or paired on, with no call to Jira. The old file is kept as `data-raw/report.before-roster-change.json`.
- **Adding someone needs a Refresh from Jira**, which on the MCP route reads only the new person's tickets (every ticket they are assigned or paired on, whatever its updated time), plus the usual changes since the last pull. Roughly $1 per person at about 60 tickets each (an estimate, not measured). The page offers the button after you save.
- It needs `config/report.config.json` to exist (see Keeping it safe to publish). On the example config the page explains this and Save is disabled.
- Two people can share a name, so check the full name in the results.

You can still edit `config/report.config.json` by hand. Everything else in it:

- **`roster`**: one `{ "jiraName": "Last, First" }` per designer, using the exact Jira display name, including `(NonEmp)` where it appears.
- **`projects`**, **`issueTypes`**: what the search covers.
- **`pairFieldId`**, **`pairJqlField`**: the Pair custom field (for example `customfield_12345` and `cf[12345]`; ask your Jira admin for yours).
- **`workload`**: the Capacity page settings (`sizeFieldId`, `rankFieldId`, `startFieldId`, `sizeDays`, `daysPerWeek`, `focus`, `overrides`, `excludedTypes`). See the example config.
- **`fieldNames`**: on-screen names of the custom fields for the MCP route (see First-time setup).
- **`historyDays`**: how far back the saved data goes (366, the most allowed, so past fiscal periods can be picked; fiscal year to date needs about 290). **Lowering it drops older closed tickets from the saved file at the next refresh, and raising it later costs a pull to get them back**, so lower it only if you do not need the history.
- **`defaultRange`**: the range used the first time (`last7`).
- **`statusBuckets`**: which Jira status shows as which badge. A status that isn't listed shows as Open, and the refresh notice carries a warning. Add it here.

Then choose Refresh from Jira.

## How the numbers work

- A ticket counts for a designer when they are the assignee or are named in the Pair field. A developer's ticket reaches a designer only through Pair.
- A ticket **counts in a range** when it was created, resolved, or changed status in it (see Choose a date range). A **closed** count is tickets resolved in the range.
- **Active designer:** at least one ticket counted. **No activity:** none, even if they have open tickets. The table says how many.
- **Tiles:** active designers; no activity; closed; in progress; awaiting PM review; blocked. A ticket shared by two designers counts once in the tiles and appears on both cards.
- **Blocked** shows every ticket that was Blocked at the end of the range, with how many days it had been blocked, and marks the ones with no status change in the range.
- **Statuses** group into five badges: Closed; In Progress; PM Review (also Ready for Review, Ready for Test and Final Acceptance); Blocked; Open (also In Discovery and Selected).
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
config/capacity.json           capacity plan: portfolios, teams, time off, percentages (git-ignored)
public/data/report.json        generated data the page loads (git-ignored, do not edit)
server/                        refresh and roster endpoints, the REST Jira client, the MCP refresh
                               (mcpRunner.mjs, mcpRefresh.mjs), with tests
scripts/                       merge step, CLI refresh, credential check
src/lib/                       counting (report.js), date ranges (windows.js), fiscal calendar (fiscal.js),
                               status replay (history.js), weekly counts (weeks.js), blocked spells (blocked.js),
                               card sort and filter (designers.js), page route (route.js), today's date (today.js)
src/components/                header, refresh banner, dashboard and its card toolbar, reports page and its
                               charts, capacity (workload) page, roster page, range menu, tiles, cards, table
.env                           your Jira key (git-ignored, you create it)
CLAUDE.md                      background, rules, definitions and status for Claude Code
docs/data-notes.md             what is stored, what leaves the machine, questions for security and architects
docs/capacity-calculations.md  the Capacity page formulas with a worked example
docs/superpowers/specs/        design specs (Workload view, MCP refresh)
```

## Keeping it safe to publish

This repository is public, so only synthetic data goes into it. `.gitignore` keeps these on your machine: `.env` (the key), `config/report.config.json` (your roster, Jira site, project keys and field IDs), `config/capacity.json` (portfolio and team names with each person's percentages), `public/data/*` (pulled tickets), `data-raw/` (backups), and `CLAUDE.local.md`. The committed `config/report.config.example.json` has made-up values, and a fresh clone shows a banner until you copy it to `report.config.json` and fill it in.

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

417 tests, none needing the network: the counting rules, the weekly counts, velocity and blocked spells, the date ranges, all 13 FY2026 fiscal periods against Kroger's printed calendar, the merge step, the roster endpoints (including the MCP name search and pruning), the Workload maths, the Jira client and refresh endpoint against a fake Jira, the whole MCP refresh against a fake Jira and a fake Claude (paging, incremental reads, reconcile, spending cap, resume, roster changes, every safety check), and the refresh banner and its hook.

## Packages

`node_modules` was copied from another local project because the Artifactory login didn't work. `package.json` pins those versions and `.npmrc` points this project at public npm. A fresh `npm install` hit a peer-dependency conflict (ERESOLVE) around `shadcn`. To reinstall, fix the Artifactory login, or retry with `npm install --legacy-peer-deps`, then run `npm test` and `npm run build`.

The MX components make the build heavy (a 1.8 MB chunk). That is fine on localhost.

## The retired refresh skill

Before the app could refresh itself through the Atlassian MCP, data came through Claude Code and a `/refresh-designer-report` skill. **That skill is retired.** It produced files in an old format the page no longer reads, and its file now only points here. Use the **Refresh from Jira** button (or `npm run data:jira`) instead. `data-raw/` holds old working files and backups and can be deleted.

## What is not built yet

- Time spent in each status (for example days in PM review).
- A drill-down per designer.
- Story-point velocity, once the team settles on one story-point field.
- Capacity compared with Jira work (planned share against tickets closed by portfolio).
- A scheduled digest (deferred on request).
- Showing Jira Teams. The Team field describes the work, not the designer, Jira matches it by team ID rather than name, and the Atlassian MCP has no way to list a team's members, so a team cannot fill the roster. The roster decides whose tickets are pulled.

## Limits to know

- The data is a snapshot from your last refresh.
- Only tickets in the six configured projects and five issue types are included.
- **Velocity can't rest on story points yet.** The team doesn't use them consistently. Tickets closed per week is the dependable measure.
- **FY2027 dates are assumed**, not checked against a printed calendar. FY2026 was checked. After FY2027 the fiscal presets disappear.
- On the API-token route the key may not be read-only (see setup). On the MCP route the sign-in has your full Jira permissions, so read-only comes from the app's tool allowlist, not from the sign-in.
- **The MCP route uses Claude and costs money per refresh**, and ticket content (including comment text the app discards) passes through Claude while it runs. Check this is acceptable where you work. `docs/data-notes.md` has the detail and the questions to ask.
- Phone width and dark mode have not been checked systematically on every page. The tests cover the numbers, not how the pages look.

## After upgrading from an older version

If the page says "report.json is in an older format", choose **Refresh from Jira** once. The saved file's format has changed over time (it now holds each ticket's status changes, issue type, size, dates and rank, and who was on the roster at the pull), and a file from before that is refreshed in full. On the API-token route that takes seconds. On the MCP route it is the long first refresh described above. Until you refresh, fiscal choices that reach back before the saved data are greyed out.

Statuses that appear in a ticket's history but are not listed in `statusBuckets` (for example old workflow steps) do not affect the blocked numbers, because only Blocked matters there.
