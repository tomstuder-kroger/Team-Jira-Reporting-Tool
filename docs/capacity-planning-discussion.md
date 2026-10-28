# Capacity planning: discussion notes

**Status:** draft for discussion. Nothing described in sections 5 and 6 is built.
**Written:** 2026-10-28, from a working session between the product design lead and Claude.
**Purpose:** decide how a team member's capacity should be planned and shown in the Designer Activity Report, so we can agree before building anything more.

This file holds counts from Jira, never names, ticket keys, project keys or field IDs. Keep it that way when you edit it: the repository is readable across Kroger.

How to use this file: read sections 1 to 4 for context, then work through the open decisions in section 7. Write answers under each decision, or change the recommendation in section 5 if you disagree.

---

## 1. The question

How should a team member's capacity be planned? Two things are being asked, and they are different measures:

1. **Quarterly plan (the capacity planning app's way).** Each person records time off, then the work they plan to do in the fiscal quarter. The result is planned weeks against available weeks, per person.
2. **"Do you have room for something this week?"** What the person is working on right now, and whether they are free or too busy.

The idea under discussion: **should a team member enter their planned work in Jira first, and this app pull it in to calculate capacity?** Start and end dates and a projected story point would be added to the work.

## 2. How the capacity planning app works today

Source: the capacity planning app and its notes (`CAPACITY-CALCULATION-NOTES.md`), plus a screenshot of the member planning screen. Read only.

Each team member enters:

- **OKR planning time**, in days or weeks.
- **Dev / L&D days.**
- **Holiday days.**
- **Scheduled PTO**, as one or more entries with a type, a start date and an end date.
- **Domains and planned work.** Each domain holds projects, and each project has a title, start date, duration (weeks), allocation %, story points (optional) and support needed.

How it adds up, in **weeks, per Kroger fiscal quarter**:

| Step | Rule |
|---|---|
| Time off | OKR + Dev/L&D + holiday days divided by 5, plus scheduled PTO days divided by 5 |
| Available weeks | Weeks in the quarter minus time off |
| A project's weeks | Duration x allocation % (a project outside the quarter counts 0) |
| Planned weeks | Sum of every project's weeks |
| Utilization | Planned divided by available |
| Status | Under 90%, fully allocated 90 to 100%, over above 100% |

Things to know about it:

- It has **no Jira connection**. Everything is typed in and kept in each person's own browser. Sharing is by pasting exported data.
- **Story points are reference only.** They never enter the calculation.
- It flags overlapping work that adds to more than 100%, but does not block it.
- Its own notes list two open problems: a project that spans two quarters is counted in full against the quarter being planned, and there is no agreed way to show split focus across projects that run at the same time.
- Its FY2027 calendar is 13 weeks per quarter. This app assumes 16, 12, 12 and 12 (the FY2026 pattern). **They disagree and neither is confirmed.** It changes available weeks, so it needs settling before FY2027 planning.

A separate resource-management app was also reviewed for inspiration only. It plans in hours per year, allocates to product teams inside portfolios, and adds level, employment status and run rate. The decision was **not** to copy that structure, and **not** to add level, employment status or cost here.

## 3. What this app has now

Built and working, not yet committed:

- A **Capacity page**: pick a fiscal quarter, then for each designer set teams (one or several), time off (one number of weeks) and a percent for each portfolio. It shows available weeks, planned weeks, a total with a status, and roll-ups by portfolio and team.
- Portfolios and teams are lists you define on the page. A person can be on several teams and split across several portfolios.
- It does **not** read Jira, and it does not use story points.

Gaps against how you plan today:

- Time off is **one number**, not the four inputs above (OKR, Dev/L&D, holiday, scheduled PTO).
- There is **no list of planned work with dates**. The percent goes straight onto a portfolio, with no start or end date.
- There is **no hours view**. Weeks only.

## 4. What Jira can supply (counts, checked 2026-10-28)

About 710 tickets on the roster, 145 of them open. "Epic" below means the parent of a ticket, which is the likely "project" level.

**Dates and points on work**

| Item | Where it exists | Coverage |
|---|---|---|
| Story points | Open tickets | 41 of 145 (28%) |
| Story points | Closed in last 90 days | 179 of 247 (72%), and 70 of those values are 0 |
| Story points | Epics with open work | 0 of 41 (0%) |
| Due date | Open tickets | 5 of 145 |
| Target start / target end | Open tickets | about 6 or 7 of 145 |
| Sprint | Open tickets | 62 of 145 (43%) |

**The epic ("project") level**

| Item | Count |
|---|---|
| Epics that are the parent of any roster ticket | 106 |
| Epics that are the parent of an **open** roster ticket | 41 (32 Epic, 9 Program Epic) |
| Of those 41: have a start date | 10 (24%) |
| Of those 41: have an end or due date | 6 (15%) |
| Of those 41: have both | 6 (15%) |
| Of those 41: assigned to someone on the roster | 8 (20%) |
| Epics per designer with open work (11 designers) | 1 to 9 each |

All six epics with both dates fall inside the current quarter, so a date means something when it is there.

**Other fields**

- **Time off / PTO:** Jira has **no field** for it.
- **Portfolio:** the Jira field named Product Portfolio is empty on every ticket.
- **Team:** set on almost every ticket, with 25 different values. We have **not confirmed** whether it means the designer's team or the team the work is for.

**Load right now (open tickets assigned to a designer, 15 designers)**

- Open assigned tickets per designer run from 0 to 24. Three designers have none.
- In progress per designer: minimum 0, median 1, maximum 5.
- Only 5 of the 15 designers have a ticket in an active sprint, so sprint membership misses most people.

## 5. Recommendation

**Yes: enter planned work in Jira first, and pull it into this app. Keep time off in this app.** Planning at the epic level, with dates required and points optional.

1. **Work comes from Jira.** Jira is where work already lives and where the team updates it every day. A typed-in second copy would drift out of date. One source means the plan and the ticket are the same thing.
2. **Time off stays in this app.** OKR time, Dev/L&D days, holidays and scheduled PTO have no home in Jira. Type them here, per person per quarter, as the capacity planning app does. Show the total in weeks, and in hours beside it.
3. **Plan at the epic level.** An epic is the "project". Tickets are too small and too many to date.
4. **Make dates required and points optional.** Dates drive the math (weeks in the quarter times allocation %). Points are 0% filled on epics and unreliable on tickets. Show points where present, with how many are filled, and never use them in the total.
5. **Show the gaps plainly.** An epic with no dates should appear as "no dates", counted as unplanned, not dropped or guessed.

What each side would do:

- **The team member:** for each epic they work on, set Target start, Target end (the two least-used fields today), and confirm their allocation %.
- **This app:** pull each ticket's epic, its dates and who is working on it, then show per person: epics with weeks in the quarter, times allocation %, plus time off, against available weeks, and flag over 100%.

## 6. Proposed build, in order (not started)

1. **Time off inputs.** Replace the single time-off number with OKR time (days or weeks), Dev/L&D days, holiday days and scheduled PTO with start and end dates. Show weeks and hours (hours = weeks x hours per week, starting at 40, editable). This needs no Jira change.
2. **Pull epics from Jira.** Add each ticket's epic, dates and assignees to the saved data (data version 4). Show per person the epics they work on, with dates, with a clear "no dates" state.
3. **Allocation % per person per epic**, saved in the capacity file. Planned weeks = weeks of the epic inside the quarter x %.
4. **A "this week" view** (see decision 6). Separate from the quarterly plan.

Each step is reviewed before the next begins.

## 7. Open decisions

Write the answer under each one.

**D1. Where does the allocation % live?**
Options: (a) a new Jira field, which needs a Jira admin change and a team habit; (b) typed into this app, keeping Jira untouched but leaving one number to keep up to date; (c) inferred as equal shares across a person's epics, which needs no entry but is only a rough guess.
Recommendation: (b) to start, since it needs no Jira change.
Answer:

**D2. Who owns an epic's dates, and who is "on" an epic?**
Only 20% of active epics are assigned to someone on the roster, so the epic's owner is usually not the designer. One epic can have several designers working under it. We cannot tell who works on an epic from the epic alone. Recommendation: treat the people with open tickets under the epic as the people on it, and keep the percent per person per epic.
Answer:

**D3. Is requiring Target start and end realistic?**
Coverage today is 15% of active epics. If it stays that low, this approach would show mostly "no dates". Is the team willing to set them, and who would chase gaps?
Answer:

**D4. What does a quarter-spanning epic count?**
The capacity planning app counts the full duration against the quarter and notes this as a known problem. Options: count only the weeks that fall inside the quarter (more accurate, a little more math), or match the current behaviour. Recommendation: count only weeks inside the quarter.
Answer:

**D5. Hours per week.**
40 is the assumed figure for converting weeks to hours. Is that right for the team, and should it vary by person (part-time, contractors)?
Answer:

**D6. "Do you have capacity this week?"**
This is a different measure from the quarter plan. Proposed signal: tickets in progress and in PM review, plus an "out this week" entry for time off, with a label such as Light, Busy or Heavy and the counts shown beside it. Caveats: a ticket count is not hours, and one large ticket can be busier than four small ones; ticket size is not reliable because points are so patchy. Questions: does "this week" mean the current Sunday to Saturday week? Is in-progress count a fair stand-in for busy on this team? Is typing in who is out this week acceptable?
Answer:

**D7. Which FY2027 calendar is right?**
16, 12, 12, 12 (assumed here) or 13, 13, 13, 13 (in the capacity planning app). Needs the printed Kroger calendar. This changes available weeks.
Answer:

**D8. What does the Jira "Team" field mean?**
The designer's team, or the team the work is for? It could drive team roll-ups without anyone typing them.
Answer:

## 8. Risks and limits

- **Adoption.** The plan is only as good as the dates and percents people enter. At 15% date coverage today, early views will look sparse. Plan for a clear "no dates" state and a way to chase gaps.
- **Counts are not effort.** Neither a ticket count nor an epic count measures hours of work.
- **Story points can mislead.** Zero is a valid value on 39% of closed tickets with points, and some people never use them.
- **Epic dates are coarse.** An epic with a six-month window does not say what a person does this week.
- **Reassignment.** Work follows the current assignee, so a ticket reassigned mid-quarter moves its past activity to the new owner.
- **Two sources of truth.** If time off is typed here and also in the capacity planning app, they can disagree. Decide which one is authoritative before asking people to enter it twice.

## 9. Not covered here

Story-point velocity, per-designer drill-down, time spent in each status, and a scheduled digest. These were discussed earlier and are separate from capacity.
