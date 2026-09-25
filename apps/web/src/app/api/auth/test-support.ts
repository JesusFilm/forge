import { vi } from "vitest"

/**
 * The three env vars every `/watch/api/auth/*` route module reads at import
 * time. Kept in one place so the three route suites cannot drift into
 * bootstrapping their module under different configuration.
 *
 * `vi.mock(...)` calls stay file-local: vitest hoists them above imports, so
 * they cannot be shared through a helper.
 */
export function stubWebAuthEnv() {
  vi.stubEnv("WEB_AUTH_BASE_URL", "https://auth.example.test")
  vi.stubEnv("WEB_BASE_URL", "http://localhost:3000")
  vi.stubEnv(
    "WEB_SESSION_SECRET",
    "test-session-secret-at-least-thirty-two-chars",
  )
}
