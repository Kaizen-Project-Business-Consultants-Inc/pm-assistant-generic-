# Coding Standards — Kovarti (pm-assistant-generic)

Written 2026-10-08, after an efficiency check found about 3,800 lines of dead code, a route that read
the whole 108 MB audit history for any user, missing indexes, history tables that never shrink, and
1,974 problems that the newly installed code checker had never been there to catch.

**Two layers enforce this document:**
1. **Automatic gates.** `deploy.sh` runs them on every prod release and they allow nothing new (see
   TESTING_GUIDE.md): type check, unit tests, `npm run lint`, `npm run duplication`,
   `npm run deadcode`, `npm run bundle-budget`, and the guard tests (efficiency, read/write
   permission, import tangles, a11y names, working days, tenant isolation…).
2. **The review before every commit** (section 9). It covers what no tool can judge: is this the
   right algorithm, the simplest correct design, the right place for the code?

Known problems sit in baseline lists (`eslint-suppressions.json`, `scripts/*-baseline.json`, the
allowances at the top of guard tests). **They only shrink.** Adding to one needs the user's OK.

---

## 1. Efficiency — choose the algorithm on purpose

- **Know the size.** Before writing a loop, ask how big each list can get for a real customer:
  5,000 tasks, 500 projects, 60 people, years of history. Design for that, not for the demo project.
- **No search inside a loop.** `find` / `filter` / `findIndex` / `includes` on an array inside a
  loop or a `map` callback is n × m. Build a `Map` or `Set` once before the loop. This is the lint
  rule `no-restricted-syntax`. If both lists are provably tiny, disable the line with the reason.
- **No database call inside a loop.** Ask once for all of them: `WHERE id IN (…)`, batch by 100,
  or use the batch helpers that already exist (`findByProjectIds`, `findTasksByScheduleIds`,
  `updateDatesMany`, `logActivities`). This is the lint rule `no-await-in-loop`. Where order truly
  matters (a cascade, a rate-limited API), disable with the reason, or use bounded concurrency.
- **Do the work in SQL, not in Node.** Count, sum and group in the query. Never load rows only to
  count or total them.
- **Sort, parse or compile once,** outside loops: `sort`, `new RegExp`, `JSON.parse` of the same
  value, `Intl` formatters.
- **Cache what is asked for repeatedly,** with a key scoped to the company (`companyCacheKey`) and
  a clear time-to-live. Never cache across companies.
- **Heavy algorithms have a speed test** (being added in October 2026 under `src/server/__tests__/performance/`), on big generated
  data with a time limit and a scaling check (N vs 2N). Changing one of those algorithms means its
  test must still pass. A new heavy algorithm gets a new speed test.
- **The client loads only what the screen needs.** Big libraries (PDF, Excel, charts) are loaded
  with `lazy()` / `await import()`. The first load stays under the budget (`npm run bundle-budget`).

## 2. Database

- **Every list is bounded:** paged (`clampPagination`), `LIMIT`ed, or filtered to one project or
  person. Never `SELECT *` from a growing table without `WHERE` and `LIMIT` (efficiency guard rule 1).
- **Every filter or sort on a growing table has an index** that starts with that column (guard
  rule 2). A new query on a new column ships with its tenant migration `T0NN_*.sql` adding the index.
  Check complex queries with `EXPLAIN` on staging.
- **Growing tables are cleaned up** (`DELETE … WHERE created_at < NOW() - INTERVAL …` in a
  scheduled job), or kept on purpose with the reason in `KEEP_FOREVER` (guard rule 3).
- **Migrations are immutable.** New ones are numbered in sequence. Tenant tables go in
  `tenant-migrations/T0NN_*`; control-plane tables (users, organizations, billing) go in
  `migrations/`. Know where your table lives: users, organizations, billing and `_migrations` are in the shared database; everything else is in each company's own.
- **Tenant isolation:** never `USE db` followed by `conn.execute()` on a pooled connection. Use
  `databaseService.queryOn(conn, …)`. A guard scans for it.
- **Parameters, never string-built SQL.** Identifiers that must be dynamic come from a fixed
  allow-list.

## 3. Security and permissions

- **Every route declares who may call it,** enforced by the read and write guard tests: a project
  check (`checkProjectRoleFor`, `requireProjectAccess`, `readableProjectIds`…) or a listed reason.
  Only the project's PM changes project data. Admin never changes customer data.
- **Heavy routes** (export, verify, download, import, bulk, rebuild, simulate…) also need a role or
  project gate and a rate limit (efficiency guard rule 4).
- **Real-time joins check membership,** the same as REST (CLAUDE.md lesson 3). Broadcasts and cache
  invalidation are scoped to the project (lesson 5).
- **Validate input with zod at the edge.** Bad input is a 400 with a plain message, never a 500.
  Error replies go through the normalizer; add any new field it must keep.
- **No `eval`, `new Function` or risky regular expressions on user input** (lint).
  `dangerouslySetInnerHTML` only after DOMPurify.
- **No secrets in code or logs.**
- **A refusal stops the route.** Our replies pass through async onSend hooks, so straight after
  `reply.send()` Fastify does not yet count the reply as sent. A gate (preHandler) that refuses
  must `return reply.status(…).send(…)` — sending and returning nothing lets the route run anyway.
  In a handler, stop with `return reply`, never a bare `return`. Don't test `reply.sent` after a
  helper unless that helper returns the reply; an async helper must not return the reply for the
  caller to test (it is thenable — `await` gives undefined): return true/false. Guard:
  `__tests__/middleware/replyDiscipline.test.ts`.

## 4. Correctness

- **Every promise is awaited, returned, or explicitly `void`-ed with a `.catch`** (lint
  `no-floating-promises`). Side effects that must not block the user (logging, notifications) are
  fire-and-forget **with** a catch.
- **Dates are calendar days** (`utils/calendarDate.ts` / `formatCalendarDate`), never moments.
  Durations count **working days** (`workingDays.ts`; weekends off unless the project calendar says
  otherwise). Delivery times use the recipient's zone.
- **The API speaks camelCase** (the serializer converts). Read the camelCase shape on the client.
- **Design every state up front** (CLAUDE.md lesson 1): when a component has more than two states,
  write the state list and transitions before coding.
- **Test the path, not just the rule:** break it the way a user would, through the API or UI, and
  check that the message is actionable.

## 5. Simplicity and structure

- **Small functions:** cognitive complexity ≤ 25, nesting ≤ 5 (lint). If it's hard to name, it's
  doing two things.
- **One copy only.** A 15+ line block in two places becomes a shared function or component
  (`npm run duplication`). If a pattern will appear twice, build the shared piece first (lesson 2).
- **Reuse before writing:** search for an existing helper, service, hook or component first.
- **Replacing something removes the old one in the same change.** The plan lists "Removes: …" for
  the user's OK. No orphaned files, exports, routes or packages (`npm run deadcode`).
- **No import tangles:** repositories don't import services, and features talk through domain
  events (import-cycle guard, ceiling 0).
- **No speculative code:** no flags, options or abstractions beyond what was asked.
- **Use established parsers** for markdown, HTML, CSV and XML, not regex (lesson 4).
- **Match the surrounding code:** naming, comment density, file layout. Comments explain *why*,
  not *what*.

## 6. User interface

- **Keyboard and screen reader** from day one: labels, roles, focus, `onKeyDown` (lint `jsx-a11y`
  + a11y names guard). WCAG AA contrast in light and dark.
- **Hide, don't disable,** controls a role can never use. New controls must stand out.
- **No effect without complete dependencies** (lint `react-hooks/exhaustive-deps`). Stale data and
  endless reloads both start there.
- **Plain-English messages** that tell the user what to do next.

## 7. Tests

- New logic gets unit tests: happy path, edge cases, errors.
- UI behaviour is proven on staging with Playwright, as each role (PM, team member, outsider), before
  calling it done.
- Every bug fix adds a test or guard that would have caught it, and a sweep for the same gap elsewhere
  (no partial fixes).

## 8. Documentation

Docs ship in the same commit (CLAUDE.md Phase 6): PRODUCT_MANUAL, USER_GUIDE (the in-app full guide),
UserGuidePage (the quick guide), WORLD_CLASS_FEATURES, TESTING_GUIDE, SECURITY_GUIDE, as affected.

## 9. The review before every commit

Before committing code, run the **Code Reviewer** agent (`.claude/agents/code-reviewer.md`) on the
diff (`git diff --staged`). It reviews against this document and must answer, for the change:

1. **Algorithm:** what size can the input reach? What is the cost (n, n log n, n²…)? Is there a known
   better approach, or an existing helper that already does it?
2. **Database:** which queries run? How many times per request? Are they indexed and bounded?
3. **Who can call it:** what gate, and is there a rate limit if it is heavy?
4. **What it replaces, and is the old code removed?**
5. **Simplest correct design:** anything to delete, merge or reuse?
6. **Tests and docs:** do they cover the path, not just the rule?

Fix every **must-fix** finding before committing. Record the outcome in a `Review:` line next to the Co-Authored-By line. The commit hook requires it:

- `Review: passed (code reviewer)`, or `Review: passed after fixes (code reviewer)`
- `Review: not needed (docs only)` / `(tests only)` / `(baseline shrink)` — only when no app code
  changed

The hook (`.githooks/commit-msg`) rejects a commit without a `Review:` line. It is switched on per
clone with `git config core.hooksPath .githooks`.
