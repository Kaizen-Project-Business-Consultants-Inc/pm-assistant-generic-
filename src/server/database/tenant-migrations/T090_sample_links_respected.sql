-- T090: every link in the sample project is honoured by its dates (audit 2, 2026-10-11).
-- The seed (T033) links "Phase 5: Testing & QA" to "Phase 4: Frontend Development" Finish-to-Start,
-- but Phase 5 starts on 22 Sep while Phase 4 runs to 25 Sep (26 Sep before T081), so a new user's
-- first schedule opened with a broken link (and Schedule Review flagged it). T081 only moved weekend
-- END dates back to the Friday before, which never breaks a link; this was in the seed itself.
-- Moving Phase 5 later would push Go Live and every row tied to those dates (sprints, bookings,
-- baseline), so the link becomes Finish-to-Finish instead: testing can't finish before the frontend
-- does (30 Oct after 25 Sep). Only an untouched sample changes: the link as seeded, Phase 5 still
-- starting 22 Sep and Phase 4 still 11 Aug – 25 Sep (26 Sep before T081). A company that edited
-- the link or moved either phase keeps what it has. Running it again changes nothing (the link is
-- then FF). Also run by SampleProjectService.load() after the seed.
UPDATE task_dependencies SET dependency_type = 'FF'
 WHERE id = 'demo-dep-5' AND task_id = 'demo-t-p5' AND dependency_id = 'demo-t-p4'
   AND dependency_type = 'FS' AND lag_days = 0
   AND EXISTS (SELECT 1 FROM tasks p5 WHERE p5.id = 'demo-t-p5' AND p5.start_date = '2026-09-22')
   AND EXISTS (SELECT 1 FROM tasks p4 WHERE p4.id = 'demo-t-p4' AND p4.start_date = '2026-08-11'
                 AND p4.end_date IN ('2026-09-25', '2026-09-26'));
