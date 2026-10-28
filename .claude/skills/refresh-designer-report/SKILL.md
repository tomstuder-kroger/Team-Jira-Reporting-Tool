---
name: refresh-designer-report
description: Refresh the Designer Activity Report data from Jira through the Atlassian MCP. Use when the user asks to refresh, update, or re-pull the designer report data. Writes public/data/report.json.
---

# Refresh the designer report

Pull current Jira data for the roster in `config/report.config.json`, merge it, and write `public/data/report.json`. The page loads that file, so nothing needs rebuilding.

## Rules

- Fetch and save data only. Do not bucket statuses, count tickets, or decide who is active. `src/lib/report.js` does that, and it has tests.
- Never hand-edit `public/data/report.json`. Always produce it with `npm run data:merge`.
- Never ask for, print, or store an API token. This flow uses the Atlassian MCP login only.
- If a query fails or returns nothing, stop and say so. Do not write a partial `report.json`.

## Steps

1. **Check the MCP.** The `atlassian` MCP server must be connected. If its tools are missing, tell the user to run `/mcp`, or see "Atlassian MCP" in README.md (the server is registered per project directory). Stop until it is available.

2. **Read the config.** Load `config/report.config.json`. You need `cloudId`, `projects`, `issueTypes`, `pairJqlField`, `pairFieldId`, `windowDays`, and `roster[].jiraName`.

3. **Build the roster list** for JQL: each `jiraName` in double quotes, comma separated, for example `"Doe, Jamie","Roe, Alex"`. Call it `NAMES`.

4. **Pool query.** Every ticket that is open, or resolved inside the window, where a roster member is the assignee or is in the Pair field. Use `searchJiraIssuesUsingJql` with the config `cloudId`:

   ```
   project IN (<projects>) AND issuetype IN (<issueTypes>)
   AND (assignee IN (NAMES) OR <pairJqlField> IN (NAMES))
   AND (statusCategory != Done OR resolved >= -<windowDays>d)
   ORDER BY assignee, status
   ```

   - `fields`: `["summary","status","assignee","<pairFieldId>"]`, `maxResults`: 100.
   - Page with `nextPageToken` until `isLast` is true. The pool is usually over 100 tickets, so expect at least two pages.
   - Save a JSON array to `data-raw/pool.json`. One entry per ticket: `{ "k": key, "t": summary, "s": status name, "a": assignee displayName or null, "pair": [displayNames from the Pair field, empty array if none] }`.

5. **Moved query.** Same filter, but only tickets updated inside the window:

   ```
   project IN (<projects>) AND issuetype IN (<issueTypes>)
   AND (assignee IN (NAMES) OR <pairJqlField> IN (NAMES))
   AND updated >= -<windowDays>d
   ```

   - `fields`: `["status"]`, same paging.
   - Save a JSON array of issue keys to `data-raw/moved.json`.
   - Every key here should also be in `pool.json`. If one is not (for example a ticket closed before the window and touched since), leave it out. The merge step warns about it.

6. **Notes.** For each roster member who has at least one key in `moved.json` (as assignee or paired), write one or two plain sentences saying what moved: what closed, what is in progress or in review, what is blocked. Rules for notes:
   - Use only ticket titles and statuses from the data you just pulled. Do not guess at causes, effort, or intent.
   - Name the paired developer when the work is paired.
   - Do not write notes for designers with no moved tickets. The page generates their line.
   - Save an object keyed by `jiraName` to `data-raw/notes.json`.

7. **Merge.** Run `npm run data:merge`. It reads `data-raw/`, writes `public/data/report.json`, and prints a summary and any warnings.

8. **Check and report.**
   - Run `npm test`. Fix nothing silently; report any failure.
   - Tell the user: ticket count, how many were updated in the window, the window dates, and every warning verbatim (unmapped statuses, dropped tickets, duplicates).
   - If a warning names an unmapped status, point to `statusBuckets` in `config/report.config.json` and ask which bucket it belongs in. Do not choose.
   - Tell the user to reload the browser tab.

## Notes on the data

- "Moved" means Jira's `updated` changed inside the window, for any reason, including comments and field edits. A ticket can look active without real progress.
- A ticket assigned to a developer counts for a designer only through the Pair field. Unassigned paired tickets are kept, and the page shows "Unassigned".
- `data-raw/` is working input and can be deleted after a merge.
