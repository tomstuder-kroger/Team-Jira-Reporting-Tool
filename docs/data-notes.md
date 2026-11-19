# Data notes: Jira API calls

How many Jira calls the app makes, and whether that is the right design. **This first part describes the REST (API token) route.** The Atlassian MCP route, used when the API key is unavailable, works differently and is described under "Refresh through the Atlassian MCP" further down; its costs are in the README.

## What triggers calls

**Reload** makes no Jira calls. The browser fetches the local `public/data/report.json` from the dev server, and that file only changes when a refresh runs. Changing the date range never calls Jira either.

**Refresh from Jira** (the header button, or `npm run data:jira`) makes a handful of calls. The count depends on ticket volume. For about 700 tickets:

| Step | Endpoint | Calls |
|---|---|---|
| Search | `POST /rest/api/3/search/jql` | About 7 (100 tickets per page, following `nextPageToken`) |
| Status history | `POST /rest/api/3/changelog/bulkfetch` | About 1 (up to 1,000 tickets per request) |

That is about 8 calls. Roughly: `ceil(tickets / 100) + ceil(tickets / 1000)`.

- The history step needs more than one call if a response carries a `nextPageToken`, which happens when the combined history is large.
- Any failed page aborts the refresh and nothing is saved.
- A 15-second cooldown applies. Overlapping clicks share one Jira run, so a double-click does not double the calls.
- The Roster page's user search is separate: one GET per search typed. It is unrelated to refresh.

Constants live in `server/jira.mjs` (`PAGE_SIZE = 100`, `HISTORY_CHUNK = 1000`).

## Is this optimal?

For this use case, yes. Not benchmarked beyond the roughly 6 seconds noted in `CLAUDE.md`.

- **Feasibility:** two read-only endpoints, no new permissions, no writes. It fails safe: a failed page keeps the old file.
- **Cost:** Jira Cloud does not charge per call, so the only cost is rate limits. About 8 calls per click, with the cooldown, is far below any realistic limit.
- **Speed:** about 6 seconds for about 700 tickets. Most of that is the search pages, which run one after another because token pagination cannot be parallelized. The history step is already one call. Everything after the refresh runs in the browser from one local file, so it is instant.

## Alternatives considered

| Option | Effect | Verdict |
|---|---|---|
| Incremental refresh (`updated >= last pull`) | Cuts calls from about 8 to about 2, saves about 4 seconds | **Not worth it on the REST route**: it adds handling for deletions, reassignments, roster changes and merge bugs, and the failure mode is quietly stale numbers, which matters for a leadership audience. **It was built for the MCP route**, where every call costs Claude usage and a full pull cost $5.82. There the risks are handled by a count check against Jira after every refresh, a key-and-updated-time listing when the count disagrees (tickets that left the roster), pruning on roster changes, and a forced full read (`?full=1`). |
| Larger search pages | Fewer pages | Probably not possible. Jira caps page size lower when several fields are requested, and 100 is what was observed. Fetching IDs only and then bulk-fetching issues would mean more calls, not fewer. |
| Parallel history chunks | None at this size | Already one chunk. Only matters past 1,000 tickets. |

## What would change the answer

- Growing past the 2,000-ticket guard.
- Wanting automatic refresh every few minutes.

At either point, incremental refresh becomes worthwhile. At the current scale the simple full pull is the better trade.

## Fields requested

The search asks for up to twelve fields: `summary`, `status`, `assignee`, the Pair field, `created`, `updated`, `resolutiondate`, `issuetype`, `duedate`, and (when the optional `workload` config block is present) the T-shirt size field, the rank field and a start-date field. Every field is used. Page speed gains from trimming further are unlikely. The count was seven before the Workload view was added (data version 4, which also added the start date); refresh is still one search plus one bulk history call.

---

# The data in this app

For discussion with security, developers and architects. No real names, keys, site names or IDs appear here. Real values live only in git-ignored files on the owner's machine.

## Summary

- Localhost only, by decision. The app is not hosted or shared.
- One external system is read: Jira Cloud, through read-only calls, either with a Jira API token (REST route) or through the Atlassian MCP using Claude Code and the owner's own sign-in (MCP route).
- Credentials: on the REST route, a Jira API token in `.env`, used by the local server and never sent to the browser. On the MCP route, none held by the app; the sign-in is stored by Claude Code.
- On the MCP route a second external party sees ticket content: Claude (Anthropic) reads it in transit. See below.
- No database. All state is a few local JSON files.
- Personal data is limited to display names. The app stores no emails and no account IDs.
- Ticket titles are stored, so the data can be business-sensitive.

## Architecture in one picture

```
Browser (127.0.0.1:5173)
   |  GET report.json, GET/PUT /api/roster, GET /api/users/search, GET/PUT /api/capacity, POST /api/refresh, GET /api/refresh/status
   v
Local dev server (Vite + middleware in server/)  --HTTPS, Basic auth-->  api.atlassian.com (Jira Cloud)      [REST route]
   |                                              --starts `claude -p`-->    Claude Code --> Atlassian MCP        [MCP route]
   |  reads .env (credentials, route) and config/*.json
   v
Local files: public/data/report.json, config/report.config.json, config/capacity.json
```

## Where data comes from

| Source | What is read | How |
|---|---|---|
| Jira Cloud: issue search | Up to twelve fields per ticket (see "Fields requested") | `POST /rest/api/3/search/jql`, a read |
| Jira Cloud: status history | Status changes per ticket: time, from, to | `POST /rest/api/3/changelog/bulkfetch`, a read |
| Jira Cloud: user search | Display names, only on the Roster page | `GET /rest/api/3/user/search` |
| Jira through the Atlassian MCP (used instead of the three rows above when the API key is unavailable) | The same ticket fields and status changes | Headless Claude Code (`claude -p`) calling the Atlassian MCP on the owner's own sign-in. See "Refresh through the Atlassian MCP" below. |
| The owner, typed in | Capacity plan (percent by portfolio, time off, teams) | Capacity page, saved locally. Never sent to Jira. |
| The owner, typed in | Roster (who is tracked) | Roster page, saved locally |

Scope of the Jira query:

- Only the configured projects and issue types.
- Only tickets assigned to, or paired with, someone on the roster.
- About one year of history (`historyDays`, 366).
- Capped at 2,000 tickets. Past that the refresh stops with an error instead of saving a partial file.

**Added in data version 4 (Workload view):** issue type, a T-shirt size label (a short label such as SM), start date, due date and Jira rank (an opaque ordering string). None of these identifies a person. The size and rank field IDs live in the git-ignored config.

**Not requested from Jira:** descriptions, comments, attachments, worklogs, labels, email addresses, account IDs, avatars. (This holds for the REST route. The MCP route below cannot avoid receiving some of them in transit.)

### Refresh through the Atlassian MCP

Chosen with `REFRESH_ROUTE=mcp` in `.env`, or automatically when no Jira email and API token are set. Spec: `docs/superpowers/specs/2026-11-18-mcp-refresh-design.md`.

- **What happens:** the server starts `claude -p` with a prompt. Claude calls the Atlassian MCP's search tool (a read) for the ticket fields, then, for tickets that changed since the saved file, the changelog operation (a read, through `executeRead`). It returns JSON; the server validates every row and writes `report.json`. The model never writes the file.
- **Data in transit is wider than what is kept.** Search pages go through `executeRead` with `responseFields` that keep only the few fields used, so **emails, account IDs and descriptions are not sent to Claude on the search step** (a test checks the field list). Each ticket's changelog is the exception: it includes every field change, such as **description and comment text** and labels, and the MCP offers no way to filter it by field. All of that is read by the Claude model, on Anthropic's service, during the history step. The server keeps only status changes, drops anything else and rejects a row that contains an email address (tested), so none of it reaches `report.json`. Whether Claude Code or Anthropic retains run content is governed by the owner's Claude account terms and settings, which have not been checked here. Runs use `--no-session-persistence`.
- **Tools:** only `executeRead` is allowed (the direct search tool is denied so Claude cannot skip the slimming). Every write and destructive MCP tool, Bash and file writes are denied by name (tested). Runs start in an empty temporary folder with only the Atlassian server, user settings only, no skills and no built-in tools, so no project files are loaded or readable. Each run is capped at $2 and a refresh at $5 (`--max-budget-usd`).
- **Cost:** Claude usage, measured in the README table "Cost of a refresh through the Atlassian MCP".
- **Roster search:** with no Jira key the Roster page's name search runs `lookupJiraAccountId` through `executeRead` with `responseFields` of display name and active only, so emails and account IDs are not sent to Claude. Only active people's display names are returned to the page (tested).
- **Roster changes:** `report.json` now records `meta.roster`, the names tracked at the last pull, so a refresh can tell who was added or removed. Removing someone prunes their tickets from the saved file locally and keeps the previous file in `data-raw/report.before-roster-change.json`; adding someone reads only that person's tickets.
- **Accuracy limit:** values pass through a model that retypes them. A test on 2026-11-19 found the default model matched Jira on six sampled tickets (all fields) and on one ticket's status changes, while Haiku changed dates and a rank and dropped status changes, so Haiku is not used. The app checks for missing or malformed rows, emails and a wrong ticket total, but **cannot detect a value that was copied wrongly**. For numbers going to leadership, spot-check a few tickets against Jira. This is a difference from the REST route, where values come straight from the API.
- **Settings:** `REFRESH_ROUTE`, `REFRESH_MAX_USD`, `REFRESH_CONCURRENCY` and `REFRESH_MODEL` in `.env` (none holds a secret).
- **Integrity checks:** the ticket total must match Jira's own count (small drift allowed), a ticket Claude skips in the history answer fails the whole refresh, and a failed refresh keeps the old file.

## What is stored, and where

| File | Contents | Sensitivity | In git? |
|---|---|---|---|
| `.env` | Jira email, API token, optionally cloud ID | **Secret** | No |
| `public/data/report.json` | Per ticket: key, title, current status, assignee name, Pair names, created, updated, resolved, status-change history, issue type, T-shirt size label, start date, due date, rank string. About 350 KB for about 700 tickets. | Internal business data: names and titles | No |
| `config/report.config.json` | Roster (names), Jira site, project keys, field IDs, status-to-bucket map | Internal | No |
| `config/capacity.json` | Planned allocation per person per fiscal quarter, time off, team labels | Possibly HR-adjacent (time off, workload) | No |
| `config/*.backup.json`, `data-raw/` | Previous copies of the above | Same as the originals | No |
| `data-raw/mcp-history-cache.json` | Only while an MCP refresh is unfinished: ticket key, updated time and status changes. No names or titles. Removed after a successful refresh. | Internal | No |
| `config/*.example.json` | Fake sample values | None | Yes |

Notes:

- `report.json` holds more than timestamps. It also holds ticket keys, titles and people's display names. Titles have whitespace normalised and nothing else removed.
- The server writes `config/report.config.json` (roster key only) and `config/capacity.json` with a single backup copy and an atomic write (temp file, then rename). Backups are kept as one file that is overwritten on each save.
- The refresh also writes `report.json` atomically. It keeps the old file if Jira returns an empty answer or any page fails.
- Retention: nothing is deleted or expired automatically. Data lives until the owner deletes the files. I have not checked whether `data-raw/` backups are ever pruned.

## Personal data

- **Stored:** display names (assignee, Pair, roster). Names are stored exactly as Jira shows them.
- **Not stored:** email addresses and account IDs.
- **User search:** the server keeps only active, real Atlassian accounts and drops everything except `displayName` before replying. Emails, account IDs and avatars never leave the server (covered by a test).
- **Capacity data** is the most personal data in the app, because it records workload and time off per named person.
- **Purpose:** activity and workload reporting for design leadership. The app counts tickets and status changes. It never writes inferred causes, effort or intent.

## Credentials and access

- **Credential:** Jira email plus API token, in `.env`. It is read once when the dev server starts, used only by server code, and sent to Atlassian as Basic auth over HTTPS through the `api.atlassian.com` gateway.
- **Exposure:** no response or error from the app's endpoints contains credentials (tested). The browser never sees them.
- **Scope of the token is unknown.** It works through both the scoped gateway and the site URL, which suggests an unscoped key. Unconfirmed. A scoped token with only `read:jira-work` and `read:jira-user` would match what the app does, and swapping it would only change `.env`.
- **Read-only toward Jira:** the app only searches, fetches history and searches users. No create, update or delete calls exist.
- **MCP route credentials:** none held by the app. The Atlassian sign-in (OAuth, the owner's own account) is stored by Claude Code in its own configuration, and the app never reads or copies it. The MCP's access follows the owner's Jira permissions, which are read and write on this site, so the read-only guarantee on this route comes from the allowlist and deny list, not from the sign-in.

## Network exposure

- The dev server binds to `127.0.0.1` only (`vite.config.js`), over plain HTTP. Nothing is reachable from other machines.
- Every `/api` endpoint checks that the `Host` header is `127.0.0.1`, `localhost` or `[::1]`, and that any `Origin` matches the same host. This blocks other websites from calling the endpoints through the user's browser and blocks DNS-rebinding attempts.
- The local endpoints have **no user authentication**. Anyone with access to the logged-in machine and a browser can use the app, including saving the roster and capacity files and triggering a refresh. The control is the machine, not a login.
- The Vite dev server serves `public/` directly, so `report.json` is readable at `http://127.0.0.1:5173/data/report.json` by any local process or page on that host.
- **Third-party request:** `index.html` loads DM Sans and Nunito from Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`). Every page load sends the browser's IP address and user agent to Google. No app data is sent. Self-hosting the fonts would remove this.
- The production build (`npm run build`, to `dist/`) is a static bundle with no server. **The refresh and save endpoints exist only in the dev server.** The `dist/` build is not a supported way to run the app, and `dist/` is git-ignored.

## Data in the browser

- `report.json` is loaded into page memory. It is not cached by the app.
- Preferences only are kept in the browser: theme, date range choice, card layout and sort, weeks shown (`localStorage`), and a one-time "roster saved" message (`sessionStorage`). No Jira data is stored there.

## Repository hygiene

The repository is public. `.gitignore` excludes `.env`, `config/report.config.json`, `config/capacity.json`, `public/data/*`, `data-raw/`, backups, exports, and the local-only Claude file. Tests and docs use fake values (`Doe, Jamie`, `ABC-123`). The README describes a leak check to run before each commit.

## Questions for the discussion

- Is a localhost-only tool that holds an API token and ticket titles acceptable under current policy, or does it need review as an internal tool?
- Should the Jira token be replaced with a scoped, read-only token (`read:jira-work`, `read:jira-user`)? Who issues it, and can it be a service account instead of a personal one? **The owner cannot currently get API permissions (2026-11-19), so the MCP route is the only route in use. A sanctioned service account or scoped token would be the cleaner answer for the longer term.**
- Are ticket titles and per-person capacity data acceptable to hold on a laptop? Is disk encryption required, and are backups included in it?
- What retention should apply to `report.json` and the backups?
- Is it acceptable for ticket content, including comment and description text and people's emails, to pass through Claude (Anthropic) during a refresh? Does the organisation's Claude agreement cover it?
- If the Jira API key was withdrawn on purpose, does refreshing through the owner's MCP sign-in fit the intent of that decision?
- Should the Google Fonts request be removed by self-hosting the fonts?
- If sharing is ever wanted, what is the intended path? Today it needs a real design (authentication, hosted secrets, access control by role), not just deploying the dev server.
