-- U73 (2026-10-21): What-If results never saved. T027 made scenario_analyses.user_id an INT, but
-- user ids are UUID strings, so every save failed with "Data truncated for column 'user_id'" and
-- the scenario history was always empty. Same width as every other user id column.
ALTER TABLE scenario_analyses MODIFY user_id VARCHAR(36) NOT NULL;
