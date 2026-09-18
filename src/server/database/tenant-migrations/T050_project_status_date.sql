-- Status date: the day a project's progress is measured "as of".
--
-- Microsoft Project works this way, and it is a better model than reading the clock.
-- Asking "is this later than right now" has two problems. It depends on the reader's
-- time zone, so two people looking at the same project disagree about whether it
-- slipped. And the numbers move while someone is reading a report.
--
-- With a status date, the project manager states the day everything is measured against,
-- everyone sees the same answer, and a report is reproducible. Left NULL, the app falls
-- back to today in the organisation's time zone (see migration 117), which is what
-- Project does when no status date has been set.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS status_date DATE NULL AFTER end_date;
