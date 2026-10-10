// @vitest-environment node

import { existsSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Since feat-306 the hook DISCRIMINATES: a genuine SeekerEgressProblem throws
// (the deploy gate — the probe gets 500 on /api/health, so the build is never
// promoted), while a failure of the diagnostic machinery itself still resolves.
// Collapsing the two — a blanket `catch {}` — silently restores report-only.

const ENV_KEYS = [
  "SEEKER_MASTRA_BASE_URL",
  "SEEKER_MASTRA_ALLOWED_HOSTS",
] as const

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

async function runRegister(): Promise<void> {
  vi.resetModules()
  const { register } = await import("./instrumentation")
  await register()
}

describe("instrumentation register — Seeker egress deploy gate", () => {
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clearEnv()
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    error = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    clearEnv()
    vi.unstubAllEnvs()
    error.mockRestore()
  })

  // Next silently no-ops a MISSING hook (ENOENT/MODULE_NOT_FOUND are swallowed),
  // and this suite reaches it by relative import — so a move or rename would
  // disarm the gate in production with every test still green. Mirrors the
  // health route's railway.toml path pin.
  it("lives at a path Next recognizes as the instrumentation hook", () => {
    expect(existsSync(join(process.cwd(), "src/instrumentation.ts"))).toBe(true)
  })

  it("logs the enum reason when production has a base URL with no allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    await expect(runRegister()).rejects.toThrow()
    expect(error).toHaveBeenCalledWith(
      "[seeker-egress] event=misconfigured reason=allowlist_unset effect=boot_refused_all_requests",
    )
  })

  // The boots-clean contract, now deploy-critical: chat with NO Seeker config
  // is the default production deploy. If describeSeekerEgressMisconfiguration's
  // unset-base-URL early return ever regressed, this build would never promote.
  it("resolves silently in production when Seeker is unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "production")
    await expect(runRegister()).resolves.toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })

  // A malformed base URL fails hostAllowed's `new URL()` parse, which RETURNS
  // false rather than throwing — so it must reach the throw, not diagnostic_failed.
  it("throws on a malformed base URL in production (not diagnostic_failed)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "not-a-url"
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS = "mastra.internal"
    await expect(runRegister()).rejects.toThrow(/reason=host_not_allowed/)
    expect(error).not.toHaveBeenCalledWith(
      expect.stringContaining("diagnostic_failed"),
    )
  })

  it("logs host_not_allowed when the base host is not pinned", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS = "other.internal"
    await expect(runRegister()).rejects.toThrow()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("reason=host_not_allowed"),
    )
  })

  it("stays silent when the configuration is sound", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS = "mastra.internal"
    await expect(runRegister()).resolves.toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })

  it("stays silent outside production (fail-open posture, nothing to report)", async () => {
    vi.stubEnv("NODE_ENV", "development")
    process.env.SEEKER_MASTRA_BASE_URL = "http://localhost:4111"
    await expect(runRegister()).resolves.toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })

  // THE deploy gate. A rejected register() rejects Next's prepare(), so every
  // route — /api/health included — returns 500 and Railway never promotes the
  // build. This is the case a blanket catch would silently swallow.
  it("REJECTS on a misconfigured production build (the deploy gate)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    await expect(runRegister()).rejects.toThrow(/SEEKER_MASTRA_ALLOWED_HOSTS/)
  })

  it("names the reason enum in the thrown message", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS = "other.internal"
    await expect(runRegister()).rejects.toThrow(/reason=host_not_allowed/)
  })

  // KTD7 on the THROW path too: Next re-emits this message once per request for
  // the life of the process, so it must name variables and the fixed enum only.
  it("never puts an env VALUE in the thrown message", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://leak-base.example"
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS = "leak-allowed.example"
    await expect(runRegister()).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("leak-base.example"),
      }),
    )
    await expect(runRegister()).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("leak-allowed.example"),
      }),
    )
  })

  // Source pin (the feat-304 lesson at this call site): `enforcing` must come
  // from requireSeekerEgressAllowlist(), not an inlined NODE_ENV read — else a
  // policy change moves the proxies and leaves the deploy gate behind.
  it("takes the enforcing decision from requireSeekerEgressAllowlist, not NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    vi.doMock("@/config/env", () => ({
      describeSeekerEgressMisconfiguration: () => "allowlist_unset",
      requireSeekerEgressAllowlist: () => false,
    }))
    const { register } = await import("./instrumentation")
    await expect(register()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      "[seeker-egress] event=misconfigured reason=allowlist_unset effect=seeker_sends_and_history_refuse",
    )
    vi.doUnmock("@/config/env")
  })

  // Anti-vacuous companion: same seam, opposite verdict, opposite NODE_ENV.
  it("throws when the policy says enforce even outside a production NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.resetModules()
    vi.doMock("@/config/env", () => ({
      describeSeekerEgressMisconfiguration: () => "host_not_allowed",
      requireSeekerEgressAllowlist: () => true,
    }))
    const { register } = await import("./instrumentation")
    await expect(register()).rejects.toThrow(/reason=host_not_allowed/)
    vi.doUnmock("@/config/env")
  })

  // A REAL problem is already known here, so a failing policy read must NOT
  // discard it into the fail-open diagnostic path — the throw wins.
  it("still throws when requireSeekerEgressAllowlist itself throws", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    vi.doMock("@/config/env", () => ({
      describeSeekerEgressMisconfiguration: () => "allowlist_unset",
      requireSeekerEgressAllowlist: () => {
        throw new Error("boom")
      },
    }))
    const { register } = await import("./instrumentation")
    await expect(register()).rejects.toThrow()
    expect(error).not.toHaveBeenCalledWith(
      expect.stringContaining("diagnostic_failed"),
    )
    vi.doUnmock("@/config/env")
  })

  // Outside a production build the hook stays REPORT-ONLY under `next dev` and
  // the test runner. NOTE: `next start` sets NODE_ENV=production, so a local
  // build+start run with a mismatched allowlist DOES 500 every route.
  it("does NOT throw outside production even when the pin is violated", async () => {
    vi.stubEnv("NODE_ENV", "development")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS = "other.internal"
    await expect(runRegister()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      "[seeker-egress] event=misconfigured reason=host_not_allowed effect=seeker_sends_and_history_refuse",
    )
  })

  // The other side of the discrimination: the diagnostic MACHINERY failing (the
  // dynamic import rejecting — @/config/env reaches `server-only`, which throws
  // on a wrong module resolution) is not evidence of a misconfiguration.
  // Failing the deploy on it would be a self-inflicted outage.
  it("resolves and logs diagnostic_failed when the env import REJECTS", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    vi.doMock("@/config/env", () => {
      throw new Error("server-only: cannot be imported here")
    })
    const { register } = await import("./instrumentation")
    await expect(register()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      "[seeker-egress] event=diagnostic_failed stage=import",
    )
    expect(error).not.toHaveBeenCalledWith(
      expect.stringContaining("event=misconfigured"),
    )
    vi.doUnmock("@/config/env")
  })

  it("resolves and logs diagnostic_failed when the diagnostic itself throws", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    vi.doMock("@/config/env", () => ({
      describeSeekerEgressMisconfiguration: () => {
        throw new Error("boom")
      },
      requireSeekerEgressAllowlist: () => true,
    }))
    const { register } = await import("./instrumentation")
    await expect(register()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      "[seeker-egress] event=diagnostic_failed stage=call",
    )
    vi.doUnmock("@/config/env")
  })

  // KTD7: the diagnostic_failed line is the ONLY thing logged on that path —
  // the caught error can carry a module path or env-shaped fragment.
  it("never logs the caught error on the diagnostic_failed path", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    vi.doMock("@/config/env", () => ({
      describeSeekerEgressMisconfiguration: () => {
        throw new Error("SECRET-FRAGMENT-/abs/module/path")
      },
      requireSeekerEgressAllowlist: () => true,
    }))
    const { register } = await import("./instrumentation")
    await register()
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(
      "[seeker-egress] event=diagnostic_failed stage=call",
    )
    vi.doUnmock("@/config/env")
  })

  it("no-ops on a non-nodejs runtime without reading env", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge")
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    await expect(runRegister()).resolves.toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })
})
