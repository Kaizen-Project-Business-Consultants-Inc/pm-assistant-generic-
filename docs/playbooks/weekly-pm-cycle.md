# Playbook: Weekly PM cycle  (approved by the product owner 2026-10-03 — not built yet)

**What it's for:** once a week, do what a good PM does before writing the status report — look at
the whole project, find what needs attention, suggest fixes, and draft the report. The PM reviews,
changes what they like, and decides. Kovarti changes nothing by itself.

---

## When
- Every **Friday morning**, in the company's time zone (with the existing Friday review pack), for
  each active project with a PM.
- Or when the PM clicks **"Run my weekly review"** on the project.
- Not for archived, completed or sample projects.

## Facts to gather (by Kovarti's code — real numbers, never guessed by the AI)
| Area | Facts |
|---|---|
| Schedule | Schedule Review score and its top findings; tasks late or due next week; milestones in the next 4 weeks; project finish date vs. baseline |
| Progress | % done vs. planned % for this week; tasks that slipped since last week |
| People | Who is over their hours next 2 weeks (all projects); work still on generic roles; tasks with no one |
| Time | Timesheets not yet submitted or waiting for approval; tasks over their planned hours |
| Money | Budget, spent (labour + expenses), forecast at completion (EVM: CPI/SPI); change since last week |
| Risks & issues | Open risks by score; risks with no owner or no response; issues past their due date; RAID Review findings |
| Change | Change requests waiting for a decision |
| Last week | Last week's report and which suggestions the PM accepted or dismissed |

## Checks (in this order — what a good PM looks at)
1. **Will we finish on time?** Finish date vs. baseline; critical tasks late; milestones at risk.
2. **Are we on budget?** CPI below 0.95 or forecast over budget.
3. **Is anyone overloaded or idle?** Next 2 weeks, all projects.
4. **Is the plan still sound?** Schedule Review score dropped, or new high findings.
5. **Are risks under control?** High risks without owner/response; risks that should be issues now.
6. **Is the data trustworthy?** Missing timesheets, tasks not updated for 2+ weeks — say so, because
   everything above depends on it.
7. **What changed since last week?** Only new or worse things get the PM's attention first.

## Good practice
- **Lead with what needs a decision**, not everything that's fine.
- **At most 5 suggestions**, most important first. Fewer, better suggestions beat a long list.
- Don't repeat a suggestion the PM dismissed last week unless it got worse.
- Recover inside slack before moving dates; rebalance people before adding new ones; raise a risk
  before telling the sponsor.
- Status colour follows the facts (the existing red/amber/green thresholds), never the AI's mood.
- If the data is poor (point 6), say "this week's picture is uncertain because…" instead of guessing.

## May suggest (each is a ready-made change the PM applies with one click, undoable)
- Run another playbook: *A task is slipping*, *Someone is overloaded*, *Cost running over budget*,
  *New or growing risk*.
- Fix plan problems (Schedule Review's existing **Propose fixes**).
- Move or reassign work (same check as the Team Planner).
- Add, update or assign a RAID item.
- Remind people to submit timesheets.
- **Draft** the weekly status report — the PM edits and sends it; Kovarti never sends it.

## How to say it (what the PM sees on Friday)
> **Your week on DBJ-Loans Management System — needs 2 decisions**
>
> 🔴 **Finish date at risk.** "UAT test scripts" (critical) is 5 days behind; the project would finish
> **27 Nov instead of 20 Nov**. → *Suggestion:* give the remaining work to Parth (20 h free). [Apply] [Other options]
>
> 🟠 **Peter is over his hours** in the weeks of 19 and 26 Oct (48 h, 50 h) across 3 projects.
> → *Suggestion:* move "API code review" 1 week later (inside slack, finish unchanged). [Apply]
>
> ✅ Budget on track (CPI 1.02) · 3 of 4 timesheets approved · Plan score 86 (+4)
>
> **Status report draft is ready** — Amber, because of the finish date. [Review and edit]

## Not this playbook's job
- Sending anything to clients or sponsors (the PM does).
- Changing anything without the PM's click.
- Judging people's performance.

## How we'll know it works
- PMs open it and act on it (accepted vs. dismissed suggestions, tracked).
- Its status colour matches what the PM finally sends.
- Fewer surprises: slips spotted in the weekly review before they hit a milestone.
