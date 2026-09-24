// The real app loads .env via `import 'dotenv/config'` in src/server/index.ts before
// config.ts ever runs. Vitest never goes through that entrypoint, so any test that
// imports config.ts (or anything importing it) without mocking it sees an empty
// process.env and fails config validation — not because the test is wrong, but
// because nothing loaded .env for it. This runs before every server test file so
// config validation sees the same environment the app itself boots with.
import 'dotenv/config';
