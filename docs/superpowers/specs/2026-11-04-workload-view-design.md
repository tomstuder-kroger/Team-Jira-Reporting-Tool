# Workload view (Capacity page), design

**Date:** 2026-11-04
**Status:** approved in conversation; written spec awaiting owner review.
**Scope of this spec:** build 1 only (team view). Builds 2 to 6 are listed under "Roadmap" and each gets its own spec.

This file holds no real names, ticket keys, project keys, site names or field IDs. Real field IDs live in the git-ignored `config/report.config.json` and `CLAUDE.local.md`. Examples use fake values.

## 1. Goal

Add a **Workload** view to the Capacity page that answers "how much open work does each team member have, compared with the time they have in a chosen window?" It is based on the reference capacity app's Team page (`docs/capacity-calculations.md`), adapted to this app.

The existing typed-in quarterly **Plan** stays exactly as it is. The Capacity page gets a **Plan | Workload** switch.

## 2. Decisions made

| Question | Decision |
|---|---|
| Relationship to the quarterly plan | Add alongside. Plan is untouched. |
| How work is sized | The Jira T-shirt size field. |
| That field is almost empty (1 of 145 open tickets when checked 2026-11-04) | Build now. Show coverage on every figure. Unsized work is counted and listed, never treated as zero days. |
| Pair work | Assignee only carries the full size. Paired people see it later as "paired on". |
| A person's supply | Flat days per week (default 5 x 80% = 4), editable per person. Time off is not subtracted, and the page says so. |
| Who is listed | Every roster member, so a person with nothing assigned shows at 0%. |
| Color bands | The reference bands (section 6), labelled on the page. The Plan view keeps its own 90 and 100 thresholds. |
| First build | Team view only. Drill-down, timeline, history, dated time off and story-point fallback follow as separate builds. |
| Computation | In the browser from `report.json` version 4. Changing the window never calls Jira. |

## 3. Data (report.json version 4)

Each ticket row gains four fields. Everything else is as in version 3.

| Key | Meaning | Source |
|---|---|---|
| `y` | Issue type name | `issuetype` |
| `z` | T-shirt size label, or null | the size field named in config |
| `d` | Due date (`YYYY-MM-DD`), or null | `duedate` |
| `k2` | Jira rank string, or null | the rank field named in config |

(`k2` is a working name. Use a short key that does not clash with the existing `k` ticket key; pick it in the plan.)

- Status needs no new field. The existing status-to-bucket map decides in progress, queued and done.
- Config gains a `workload` block (in the git-ignored real config, with fake IDs in `config/report.config.example.json`):
  - `sizeFieldId`, `rankFieldId`
  - `sizeDays`: `{ XS: 1.5, SM: 5, MED: 10, LG: 20, XL: 30 }`
  - `daysPerWeek` (5), `focus` (0.8), `overrides` by roster name, for example `{ "Doe, Jamie": { focus: 0.4 } }`
  - `excludedTypes`: issue types that are containers and do not count (`Epic`, `Program Epic`)
- The page rejects a file whose `version` is not 4 and tells the user to refresh, as it does today for any other version. The refresh writes version 4. Page code that reads older fields keeps working because they are unchanged.
- The search requests two more fields than today's seven (size and rank) plus issue type and due date, so about eleven in total. Still one search and one bulk history call.
- A refresh warns when a ticket carries a size label that is not in `sizeDays`, the same way it warns about an unmapped status.

## 4. Which tickets count

A ticket counts toward a person's load when all are true:

1. It is open (not resolved, and its status maps to a bucket other than Closed).
2. Its issue type is not in `excludedTypes`.
3. The person is its **assignee** and is on the roster.

Then:

- **In progress:** bucket In Progress, PM Review or Blocked.
- **Queued:** bucket Open.
- **Sized:** `z` is present in `sizeDays`. **Unsized:** anything else. Unsized tickets count 0 days but are listed and counted separately.
- Pair names do not add load. A ticket whose assignee is not on the roster, or has none, adds load to nobody. The page says how many roster-paired tickets that leaves out.

In-progress tickets count at full size, because Jira does not record how much is done.

## 5. The maths (pure functions, tested)

```
weekly capacity     = daysPerWeek x focus                (per person, with overrides)
work days in window = Monday to Friday days from start to end, inclusive
window capacity     = weekly capacity / 5 x work days in window
assigned work       = in-progress days + queued days
% of capacity       = assigned work / window capacity x 100   (rounded for display and bands)
free                = window capacity - assigned work        (when at or under 100%)
over by             = assigned work - window capacity        (when over 100%)
weeks of work       = assigned work / weekly capacity
```

Assigned work does not depend on the window. The window changes only what it is compared against.

**Team:** assigned and capacity are summed over every listed person; team % is the ratio. **Over capacity** counts people whose assigned work exceeds their window capacity.

**Queue projection (per person):**
1. Order: in-progress tickets first, then queued, each by Jira rank string ascending. Tickets with no rank go last.
2. Start on the first work day from today.
3. Fill each work day with up to weekly capacity / 5 days of effort, moving to the next ticket when one is used up. Skip weekends.
4. A ticket's projected start is the day work on it begins; projected finish is the day its last effort is used.
5. **Queue clears:** the last projected finish. **Late:** projected finish after the ticket's due date.

A person with zero capacity (focus 0) shows "no capacity set" and no projection, never a divide by zero. A person with no sized work shows "no sized work", never 0%.

## 6. Color bands

Applied to the rounded percentage, for people and the team:

| % of capacity | Color | Meaning |
|---|---|---|
| 0 to 50 | light gray | under-used |
| 51 to 85 | green | healthy |
| 86 to 95 | orange | nearly full |
| 96 and above | red | at or over capacity |

Theme tokens only, light and dark, no new palette. The page notes that Plan uses different thresholds.

## 7. Capacity window

- Presets: next 2, 4, 8 and 12 weeks. Start is today; end is today plus N weeks minus one day.
- A custom range from a two-month calendar picker (plain React, no new package), with a presets row, a selected-range highlight, and an Apply button, after the reference screen.
- A start before today is clamped to today. A range entirely before today is disabled, with the note "Past ranges (delivered work) are not available yet".
- Calendar days are local midnights, as elsewhere in the app. `useToday()` supplies today.
- The saved choice lives in `localStorage` (`dar.workWindow`), read and written in try/catch. An unusable saved value falls back to next 4 weeks.
- The page shows "as of last refresh" with the pull time.

## 8. Page layout

The Capacity page header gets a **Plan | Workload** switch; the choice is remembered in `localStorage` (`dar.capacityView`).

**Workload view:**
- A header row with the title, a one-line definition ("Open, assigned work sized by T-shirt, default 4 days a week per person. Time off is not included."), and the window button ("Next 4 weeks, 20 work days").
- **Four tiles:**
  - *Assigned work:* team % of capacity, days, in progress vs queued days.
  - *Capacity in the window:* % booked, days free.
  - *Over capacity:* N of M people.
  - *Unsized tickets:* count, with "not counted in load".
- **Team members list.** One row per roster member: name and days per week, a bar (blue in progress, amber queued, a black tick at the window's capacity), the %, days, weeks of work, "clears <date>", and flags "N late" and "N unsized".
- Rows are not clickable in this build, so no arrow is shown. The drill-down arrives in build 2.
- **Coverage banner:** when fewer than half of countable open tickets are sized, a plain banner at the top says so ("Only 1 of 145 open tickets has a T-shirt size, so loads shown here are understated"). Every headline figure also shows its coverage ("1 of 145 sized").

Charts and bars are plain SVG or CSS with theme tokens, like the Reports page. The page works at phone width (the list collapses to name, bar and percent) and in dark mode.

## 9. Error and edge states

| Situation | Behaviour |
|---|---|
| `report.json` is not version 4 | Existing "refresh from Jira" message. |
| `workload.sizeFieldId` missing in config | The Workload view says so and points to setup. Plan keeps working. |
| Size label not in `sizeDays` | Treated as unsized; refresh returns a warning. |
| Window start before today | Clamped to today. |
| Window entirely in the past | Disabled with a note. |
| Window ends after the last refresh | Allowed; the page shows "as of last refresh". |
| Roster member with no open tickets | Listed at 0%, with "no open work". |
| Person with focus 0 | "No capacity set"; excluded from the over-capacity count. |
| Ticket with no assignee, or assignee off the roster | Counts for nobody; the page shows the number left out. |

## 10. Code units

| Unit | Purpose | Depends on |
|---|---|---|
| `src/lib/workload.js` | Pure maths: sizes, counting rules, per-person load, queue projection, team totals, bands | `history.js` bucket lookup, config |
| `src/lib/workWindow.js` | Window presets, work-day counting, clamping, saved choice | `today.js` |
| `src/components/WorkloadPage.jsx` | The Workload view | the two libs |
| `src/components/WindowPicker.jsx` | Preset row and two-month range calendar with Apply | `workWindow.js` |
| `src/components/CapacityPage.jsx` | Gains the Plan / Workload switch only | |
| `server/refresh.mjs`, `server/queries.mjs` | Request the extra fields, map `y`, `z`, `d`, rank, validate the `workload` config block, warn on unknown sizes | |
| `scripts/merge-lib.mjs` | Pass the new fields through, bump version to 4 | |

`CapacityPage.jsx` is already large (about 240 lines). The Workload code goes in its own files so that file does not grow.

## 11. Tests (vitest, no network)

- **Worked example from the reference doc:** two in-progress tickets (SM 5d, MED 10d) and one unsized, window of 20 work days at 4 days a week. Expect 15d assigned, 16d capacity, 94%, 1d free, 3.8 weeks, queue clearing 2026-11-25, and the MED ticket late against an Oct 30 due date. Also 10 work days gives 188% and 7d over.
- Counting rules: Epics excluded, pair does not add load, off-roster assignee adds load to nobody, resolved and Closed-bucket tickets excluded, unsized counted but 0 days.
- Window: weekends skipped, start clamped to today, past range rejected, preset ends.
- Bands at 50, 51, 85, 86, 95, 96.
- Zero-capacity and zero-ticket people.
- Refresh mapping with a mocked Jira: new fields mapped, unknown size warned, version 4 written, request still one search and one history call, credentials never in responses.
- A component test that the list shows every roster member and that the coverage banner appears below 50% sized.

## 12. Docs to update with the build

- Rewrite `docs/capacity-calculations.md` for this app: status buckets instead of Jira status categories, assignee only, browser-side maths, flat capacity, no history view yet, and this app's file names.
- `CLAUDE.md`: add the Workload definitions, the data version 4 shape, the new files and tests.
- `docs/data-notes.md`: the stored-data table gains the four fields; the "fields requested" section changes from seven to the new list.
- `config/report.config.example.json`: fake `workload` block.
- Run the README leak check before any commit.

## 13. Roadmap (separate specs, in this order)

Each build is reviewed before the next begins.

| Build | What | Notes and dependencies |
|---|---|---|
| **2. Person drill-down page** | Click a row to see: tiles (assigned, capacity, queue clears, past due), a "Working on now" table (key, summary, status, size, projected dates, due), "Up next", an "Unsized issues" list, and "paired on" tickets. | Reuses build 1's maths. Enables the row arrow. Needs ticket summaries, which `report.json` already holds. Deep link by hash route. |
| **3. Projected timeline chart** | A per-person timeline of queued tickets as bars across the window, shaded capacity window, due-date markers, late flags. | Uses the queue projection from build 1. Plain SVG with theme tokens. |
| **4. History view** | A range entirely in the past shows delivered work (size of tickets resolved in the range, credited to the current assignee) against the same window capacity. The window picker enables past ranges. | `r` already exists. Reuse the Dashboard's rule that tickets follow their current assignee. Reference app limits history to 180 days; here it is the 366 days already pulled. Resolved-after-due flag. |
| **5. Dated time off** | Time off entries with a start and end day per person, subtracted exactly from the work days in the window. | Must be reconciled with the Plan's time off, which is weeks per fiscal quarter with no dates. Decide which is authoritative, or derive one from the other, before building. Capacity file schema change, with backup and validation as today. |
| **6. Story-point fallback** | A ticket with no T-shirt size but with Story Points uses a points-to-days setting. | Mixes two measures, so every figure must show how many tickets used each. Story Points is 0 on many tickets (16 of 40 open when checked), so decide whether 0 means unsized. Coverage display from build 1 is the base. |

## 14. Out of scope for build 1

Drill-down page, timeline chart, history view, dated time off, story-point fallback (all listed above), holidays, remaining-effort for partly done work, per-day views, and any write to Jira.

## 15. Risks

- **Adoption.** With 1 of 145 tickets sized, the first view is mostly warnings. That is the honest state, and the coverage display and a pilot team are how it improves.
- **Full size for in-progress work** overstates load for work that is mostly done.
- **Assignee-only counting** hides load carried by a pair.
- **Two banding systems** on one page can confuse. Labelled on the page.
- **Time off is not subtracted** until build 5, so capacity is overstated for anyone out in the window.
- **A single, large ticket** can dominate one person's load. The tile shows days, not counts, so this is visible, but sizes are only as honest as people make them.
