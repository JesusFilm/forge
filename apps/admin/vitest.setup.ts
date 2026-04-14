// Populate placeholders for any required env var so `src/config/env.ts`
// validation passes in test mode. `CI=1` also short-circuits validation
// via `skipValidation`, but we set explicit values to keep parity with
// `apps/manager/vitest.setup.ts`. When `skipValidation` is on, t3-oss/env
// does NOT apply Zod defaults, so explicit values are required here.
process.env.CI ??= "1"
process.env.NEXT_PUBLIC_APP_NAME ??= "forge-admin"
process.env.DATABASE_URL ??=
  "postgresql://test:test@localhost:5432/forge_admin_test"
process.env.BETTER_AUTH_SECRET ??=
  "forge-admin-test-secret-min-32-chars-placeholder"
