# How the Workload numbers are calculated

This explains every number on the **Workload** view of the Capacity page. The maths lives in `src/lib/workload.js` (load, queue, team totals) and `src/lib/workWindow.js` (the capacity window). The settings live in the `workload` block of `config/report.config.json`; the validation is in `src/lib/workloadConfig.js`. All of it runs in the browser from `public/data/report.json`, so changing the window never calls Jira.

The design was based on a similar Jira capacity app. This file describes **this** app. The reasoning is in `docs/superpowers/specs/2026-11-04-workload-view-design.md`.

The earlier typed-in **Plan** view (percent by portfolio per fiscal quarter) was retired from the page on 2026-11-04. Its saved file and endpoint are still in place, but nothing reads them; see "Capacity definitions" in `CLAUDE.md`.

All names, keys and dates below are made up.

## 1. Sizing work

Each ticket's effort comes from its **T-shirt size** field in Jira, in working days of one person (`workload.sizeDays`):

| Size | Days | Meaning |
|---|---|---|
| XS | 1.5 | 1 to 2 days (midpoint) |
| SM | 5 | 1 week |
| MED | 10 | 2 weeks |
| LG | 20 | 4 weeks |
| XL | 30 | 6 weeks |

- The size is the Jira select's label, matched **exactly and case-sensitively**. Anything else, including a label that is not in the table, is **unsized**.
- **Unsized tickets add 0 days but are counted, listed and flagged.** They never make someone look free. The refresh warns about a label that is not in `sizeDays`.
- Story points are not used. Using them as a fallback is a planned later build.

## 2. Which tickets count

A ticket counts toward a person's load when **all** of these are true:

| Rule | Why |
|---|---|
| It is open: no resolved date **and** its status is not in the Closed bucket | If the two disagree it is treated as not open |
| Its issue type is not in `workload.excludedTypes` (default Epic, Program Epic) | Epics are containers, so counting them would double-count |
| The person is its **assignee** and is on the roster | Paired designers do not carry the load; nobody's work is counted twice |

Counted tickets are split by status bucket (the same buckets the rest of the app uses):

- **In progress:** In Progress, PM Review (including Ready for Review and Ready for Test) and Blocked.
- **Queued:** Open (including In Discovery and Selected).

In-progress tickets count at their **full size**, because Jira does not record how much is done.

**Left out:** open tickets that name a roster member in Pair but have no roster assignee (for example a developer's ticket). They add load to nobody. The page footer says how many there are.

**Countable tickets** means the tickets that pass the three rules, sized or not. Coverage is always *sized countable tickets of all countable tickets*, for example "1 of 145 sized".

## 3. Capacity per person

```
weekly capacity = days per week x focus
```

- Default: **40 hours a week, Monday to Friday**, which is 5 days of 8 hours at 100% focus, so **5 days of planned work a week**. Sizes are in days, so a day is 8 hours.
- `focus` is the share of a day available for planned work. Lower it for someone part-time or split across projects (see overrides).
- `daysPerWeek` is above 0 and at most 5, because capacity is spread over Monday to Friday and a work day cannot hold more than one day of effort. `focus` is from 0 to 1.
- Per-person overrides go in `workload.overrides`, keyed by roster name, and may set `focus` or `daysPerWeek`:
  ```json
  "overrides": { "Doe, Jamie": { "focus": 0.4 } }
  ```
  Edited in the config file only; there is no screen for it. A name that is no longer on the roster is ignored.
- Each work day provides **weekly capacity / 5**: a full day at the default, 0.4 for someone at 40% focus.
- **Time off and holidays are not subtracted.** Capacity is overstated for anyone out during the window. Dated time off is a planned later build.

## 4. The capacity window

The window dropdown is grouped like the Dashboard's date range. Weeks run Sunday to Saturday, as in the fiscal calendar. **A window never starts before today**, so "this" choices cover what is left of the week or quarter, not days already gone.

| Group | Choice | Start | End |
|---|---|---|---|
| Rolling, from today | Next 2, 4, 8 or 12 weeks | today | today + N weeks - 1 day |
| Calendar | This week | today | the Saturday that ends this week |
| Calendar | Next week | the coming Sunday | the Saturday after it |
| Fiscal | This quarter (Qn) | today | last day of the current fiscal quarter |
| Fiscal | Next quarter (Qn) | first day of the next fiscal quarter | its last day |

- **No days left:** on a Saturday "This week" has no work days, and on the last Saturday of a quarter neither does "This quarter". Those choices are greyed out in the dropdown with the reason. After the fiscal calendar ends there is no quarter to show.
- **Assumed dates:** quarters in FY2027 are assumed (16, 12, 12, 12 weeks) and not checked against Kroger's printed calendar, so those choices are labelled "(assumed dates)".
- **Rolls over by itself:** the week and quarter choices are worked out from today each time, so a saved "This week" always means the current week.
- **Small windows give big percentages:** assigned work is all open work, so "This week" on a Wednesday compares it with 3 work days of capacity. That is the honest answer to "does this fit in what is left", not an error.

```
work days in window = Monday to Friday days from start to end, both inclusive
window capacity     = weekly capacity / 5 x work days in window
```

A custom range with a calendar picker, and past ranges that show delivered work, are planned later builds. The choice is saved in `dar.workWindow`, and one that cannot be used today (a stale or unknown value) falls back to next 4 weeks.

## 5. Load and percentage

For one person:

```
assigned work   = in-progress days + queued days            (sized tickets only)
% of capacity   = assigned work / window capacity x 100     (rounded for display and colors)
free            = window capacity - assigned work           (when at or under 100%)
over by         = assigned work - window capacity           (when over 100%)
weeks of work   = assigned work / weekly capacity
```

- **Assigned work does not depend on the window.** It is all of the person's open, sized, countable work. The window only changes the capacity it is compared against.
- A few special states take precedence over a percentage, in this order:
  1. capacity is zero: **No capacity set**
  2. no countable tickets: **No open work** (0%)
  3. countable tickets but none sized: **No sized work** (never 0%)
  4. otherwise the percentage
- Colors, on the rounded percentage:

  | % of capacity | Color | Meaning |
  |---|---|---|
  | 0 to 50 | grey | under-used |
  | 51 to 85 | green | healthy |
  | 86 to 95 | orange | nearly full |
  | 96 and above | red | at or over capacity |


**Team totals** sum the people who have capacity above zero; the team percentage is the ratio. **Over capacity** counts people with capacity above zero whose assigned work is more than their window capacity, out of the same group. People with zero capacity are left out of those sums so they cannot inflate the percentage. Coverage and the Unsized tile include everyone. Everyone on the roster is listed, so a person with nothing assigned appears at 0%.

When fewer than half of countable tickets are sized (and there is at least one), a banner says the loads are understated.

## 6. Projected queue

Each person's work is laid end to end:

1. Order: in-progress tickets first, then queued. Within a group, by **Jira rank** (a plain string comparison); tickets with no rank go last; ties break by ticket key.
2. Start on the first work day from today (today itself if it is a work day).
3. Fill each work day with up to weekly capacity / 5 days of effort, moving to the next ticket when one is used up. Weekends are skipped.
4. A ticket's **projected start** is the day work on it begins; its **projected finish** is the day its last effort is used.

Derived values:

- **Clears:** the projected finish of the last ticket.
- **Late:** the projected finish day is later than the ticket's Jira due date (day against day; finishing on the due day is not late).
- **Unsized tickets have no effort, so they are skipped:** no projected dates and no late flag.

The maths is done in whole hundredths of a day. Adding 0.8 repeatedly in floating point drifts (4.8, then 0.2000000000000002) and flips day boundaries.

Because the queue never fills a day beyond capacity, over-allocation shows up as a percentage above 100 and as late tickets.

## 7. Worked example

Made-up data, today **Fri 2026-10-30**. This example sets `focus` to 80% (4 days a week, so 0.8 of a work day) on purpose: the fractions show how the queue and the rounding behave. The app's default is 5 days a week, and the tests cover both.

| Ticket | Bucket | Size | Days | Due |
|---|---|---|---|---|
| ABC-1 | In progress | SM | 5 | none |
| ABC-4 | In progress | MED | 10 | Oct 30 |
| ABC-2 | In progress | none | 0, flagged unsized | none |

**Window: next 4 weeks** = Fri Oct 30 to Thu Nov 26 = **20 work days**.

```
window capacity = 4 / 5 x 20      = 16d
assigned work   = 5 + 10          = 15d
% of capacity   = 15 / 16         = 94%   (orange)
free            = 16 - 15         = 1d
weeks of work   = 15 / 4          = 3.8
```

**Window: next 2 weeks** = 10 work days, capacity 8d, so 15 / 8 = **188%**, 7d over, red.

**Queue at 0.8 a work day:**

- **ABC-1 (5d):** starts Oct 30. Six work days give 4.8d and the last 0.2d is used on Nov 9, so it **finishes Nov 9**.
- **ABC-4 (10d):** starts Nov 9 with the 0.6d left that day, and its last effort is used on Nov 25. It **finishes Nov 25**. Its due date is Oct 30, so it is **late**.
- **Clears Nov 25.** ABC-2 is unsized, so it has no dates.

The tests in `src/lib/workload.test.js` assert exactly these numbers.

## 8. Known simplifications

- Time off, holidays and changes in availability are not modeled (dated time off is planned).
- In-progress work counts at full size, not remaining effort.
- The assignee carries the whole ticket; a pair does not share it.
- Part-time capacity is spread across all five weekdays rather than specific days.
- People moving between projects are not modeled, beyond setting a lower `focus`.
- Only the T-shirt size is used. Until the team fills it in, most work is unsized (1 of 145 open tickets when first checked), so loads are understated. That is why coverage is shown next to every figure.
- Percentages are rounded to whole numbers, and days are shown to one decimal place.
- Start and due dates are not used for load yet. Spreading each ticket's size across its start and due dates (so load is shown week by week) is the next build. Only 6 open tickets had both when first checked.
- Past ranges (delivered work), the person drill-down, the timeline chart, dated time off and a story-point fallback are planned later builds.
