-- Meeting Coach (2026-10-01): the scorecard shown with each meeting analysis
-- (called out vs. AI-spotted counts, owner/date gaps, tips, trend). NULL for older analyses.
ALTER TABLE meeting_analyses ADD COLUMN IF NOT EXISTS coach JSON NULL;
