// @vitest-environment node
// Call-site source pins for the production egress pin. The proxy suites drive
// their cores with `requireAllowlist` supplied as a literal, so a one-line
// revert at either env-reading BUILDER — `requireAllowlist: false` in place of
// `requireSeekerEgressAllowlist()` — would compile, typecheck, and leave every
// other test green while silently restoring fail-open egress of the ai-chat
// lane bearer. These are the tests that go red for that revert.
//
// Both builders are pinned in ONE file because they share the module-load
// NODE_ENV dance: env.ts freezes NODE_ENV at parse time, so each case must
// stub then re-import (the shape env.test.ts already uses).

import { afterEach, describe, expect, it, vi } from "vitest"

const ENV_KEYS = [
  "SEEKER_MASTRA_BASE_URL",
  "SEEKER_MASTRA_ALLOWED_HOSTS",
  "AI_CHAT_MASTRA_API_KEY",
] as const

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function buildersUnder(nodeEnv: string) {
  vi.resetModules()
  vi.stubEnv("NODE_ENV", nodeEnv)
  const { buildHistoryProxyConfig } =
    await import("@/app/api/history/history-proxy")
  const { buildSeekerProxyConfig } = await import("@/app/api/seeker/route")
  return { buildHistoryProxyConfig, buildSeekerProxyConfig }
}

describe("egress pin — env source is threaded at both proxy config builders", () => {
  it("arms requireAllowlist in a production build (both builders)", async () => {
    const { buildHistoryProxyConfig, buildSeekerProxyConfig } =
      await buildersUnder("production")
    expect(buildHistoryProxyConfig().requireAllowlist).toBe(true)
    expect(buildSeekerProxyConfig().requireAllowlist).toBe(true)
  })

  // Anti-vacuous companion: a builder hard-coded to `true` would pass the case
  // above. Only reading the env policy satisfies both directions.
  it.each(["development", "test"])(
    "leaves requireAllowlist fail-open for NODE_ENV %j (both builders)",
    async (nodeEnv) => {
      const { buildHistoryProxyConfig, buildSeekerProxyConfig } =
        await buildersUnder(nodeEnv)
      expect(buildHistoryProxyConfig().requireAllowlist).toBe(false)
      expect(buildSeekerProxyConfig().requireAllowlist).toBe(false)
    },
  )

  // The builders must agree: a pin on one proxy and not the other still leaks
  // the bearer on the unpinned path.
  it("keeps both builders on the same policy value", async () => {
    for (const nodeEnv of ["production", "development"]) {
      const { buildHistoryProxyConfig, buildSeekerProxyConfig } =
        await buildersUnder(nodeEnv)
      expect(buildSeekerProxyConfig().requireAllowlist).toBe(
        buildHistoryProxyConfig().requireAllowlist,
      )
    }
  })

  // End-to-end join the layered tests never make: NODE_ENV=production with a
  // set base URL and NO allowlist must actually deny at the guard, not merely
  // set a flag. Pins policy -> builder -> validateBaseUrl in one assertion.
  it("denies a real unpinned production config at the guard", async () => {
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    process.env.AI_CHAT_MASTRA_API_KEY = "lane-key"
    const { buildSeekerProxyConfig } = await buildersUnder("production")
    const { validateBaseUrl } = await import("@/lib/server/mastra-upstream")

    const config = buildSeekerProxyConfig()
    expect(
      validateBaseUrl(
        config.baseUrl!,
        config.allowedHosts,
        config.requireAllowlist,
      ),
    ).toBeNull()
  })

  it("admits the same config once the allowlist pins the host", async () => {
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    process.env.AI_CHAT_MASTRA_API_KEY = "lane-key"
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS = "mastra.internal"
    const { buildSeekerProxyConfig } = await buildersUnder("production")
    const { validateBaseUrl } = await import("@/lib/server/mastra-upstream")

    const config = buildSeekerProxyConfig()
    expect(
      validateBaseUrl(
        config.baseUrl!,
        config.allowedHosts,
        config.requireAllowlist,
      ),
    ).toBe("https://mastra.internal")
  })
})
