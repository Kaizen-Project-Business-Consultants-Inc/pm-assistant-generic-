# Kovarti PM — Pre-Launch Test Checklist

**Test Environment:** https://pm.kpbc.ca (staging)
**Test Project:** CloudSync Platform Launch
**Login:** mike_todo@yahoo.com / Test1234!
**Last updated:** August 30, 2026

---

## Test Data Summary

| Item | Count | Details |
|------|-------|---------|
| Project | 1 | CloudSync Platform Launch ($150K, Sep 2026 – Feb 2027) |
| Resources | 5 | Sarah Chen, James Rodriguez, Priya Patel, Marcus Thompson, Lisa Wong |
| Tasks | 24 | 4 phases, 2 completed, 1 in progress, 21 pending |
| RAID items | 5 | 2 risks, 1 issue, 1 action, 1 decision |

---

## 1. Core PM

- [ ] Open **CloudSync Platform Launch** project
- [ ] View **Gantt chart** — tasks should render with bars across the timeline
- [ ] Drag a task bar to reschedule it
- [ ] Click a task to edit inline (name, dates, priority)
- [ ] Set a dependency between two tasks (e.g., "Architecture design" blocks "API gateway development")
- [ ] Assign a resource to a task via the Resource column
- [ ] Add a new task via the empty row at the bottom of the Gantt
- [ ] Indent a task (Tab) to make it a subtask
- [ ] Delete a task

## 2. RAID Log

- [ ] Go to **RAID tab** — verify 2 risks, 1 issue, 1 action, 1 decision appear
- [ ] Open risk "Key developer unavailability" — verify description and mitigation plan
- [ ] Open risk "Third-party API rate limits" — verify risk score is 16 (4x4)
- [ ] Edit a risk — change severity, add notes
- [ ] Close/resolve the action item "Set up staging environment"
- [ ] View the decision record — verify rationale is displayed
- [ ] Create a new risk manually

## 3. Analytics & Intelligence

- [ ] Run **Monte Carlo** simulation on the CloudSync schedule
- [ ] Verify histogram, sensitivity analysis, and criticality index display
- [ ] Check **EVM dashboard** — gauges, S-Curve, forecasts
- [ ] View **Critical Path** — verify it highlights the longest chain
- [ ] Check **Analytics** tab for task distribution charts
- [ ] Try **What-If scenario** on the EVM dashboard

## 4. Sprints

- [ ] Create a sprint (e.g., "Sprint 1", 2-week duration)
- [ ] Add tasks to the sprint
- [ ] View **Sprint Board** (Kanban) — tasks in columns
- [ ] Drag tasks between columns (To Do → In Progress → Done)
- [ ] Check **Sprint Burndown** chart
- [ ] Check **Velocity** chart (may need multiple sprints for data)

## 5. Resource Management

- [ ] Go to **Resources tab** — verify 5 resources appear
- [ ] View resource workload/capacity chart
- [ ] Edit a resource (change role, skills, cost rate)
- [ ] Check resource utilization

## 6. Timesheets

- [ ] Log time against a task (e.g., 4 hours on "UI/UX wireframes")
- [ ] Submit timesheet for approval
- [ ] Switch to approval view — approve or reject the submission
- [ ] Verify locked entries cannot be edited after approval

## 7. Status Reports

- [ ] Generate a **status report** for CloudSync project
- [ ] Verify all sections render (header, RAG table, milestones, achievements)
- [ ] Export to **PDF**
- [ ] Export to **Word**
- [ ] Try **email** export — send to yourself

## 8. AI Features

- [ ] Open **Mjuzi chat** panel — ask "What are the top risks for CloudSync?"
- [ ] Run **AI Risk Scan** on the project — verify it identifies risks
- [ ] Try **AI Task Estimation** on a task — verify it returns a duration estimate
- [ ] Ask Mjuzi "Generate a status update for CloudSync"

## 9. Meeting Minutes

- [ ] Create a new meeting (any type)
- [ ] Upload a transcript file (.txt or .vtt) if available
- [ ] Try **Send Minutes** via email
- [ ] Create action items from a meeting

## 10. Intake Forms

- [ ] Go to **Intake Forms** — verify "New Project Request" form exists
- [ ] Fill out and submit the form
- [ ] Review the submission — approve it
- [ ] Convert approved submission to a project
- [ ] Verify new project appears in project list

## 11. Change Requests

- [ ] Create a change request for CloudSync (e.g., "Add SSO support")
- [ ] Review and approve the change request
- [ ] Verify status updates correctly

## 12. Lessons Learned

- [ ] Add a lesson (e.g., "Cross-train team members on critical components early")
- [ ] Search for similar lessons
- [ ] Verify lesson categories and lifecycle tracking

## 13. Dashboard

- [ ] Go to **Dashboard** — verify morning briefing widget loads
- [ ] Check that CloudSync project appears in dashboard widgets
- [ ] Resize a widget (full/half/third)
- [ ] Verify notifications widget shows recent activity

## 14. Portfolio

- [ ] Go to **Portfolio** view
- [ ] Verify CloudSync Platform Launch appears
- [ ] Check portfolio health indicators

## 15. Notifications

- [ ] Perform an action (e.g., complete a task, approve a timesheet)
- [ ] Verify notification appears in the notifications panel
- [ ] Mark notification as read

## 16. Settings & Admin

- [ ] Go to **Settings** — verify profile, preferences, and billing sections load
- [ ] Check theme toggle (light/dark mode)
- [ ] Verify user role and subscription tier display correctly

---

## Known Issues / Notes

- Bulk task creation via MCP fails (500 error) — individual creation works fine
- MCP `estimatedDays` parameter requires numeric type (string rejected)
- Production environment has no test data — all testing done on staging

---

## Post-Test Actions

After completing all tests:
1. Document any bugs found with steps to reproduce
2. Fix critical bugs before launch
3. Re-test fixed items
4. Deploy fixes to production
5. Run smoke test on production after deployment
