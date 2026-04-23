/**
 * Regression test: the refresh CLI must NOT transitively import
 * `@/config/env` or `@/storage/s3`. The CLI deliberately bypasses the
 * admin env validator so operators can run it with only the
 * RAILWAY_S3_* vars populated (not DATABASE_URL, BETTER_AUTH_SECRET,
 * etc.). A transitive pull would force the operator's terminal to
 * carry admin's full env matrix just to upload a JSON blob.
 *
 * Context: the sibling-call-site / transitive-import pattern captured
 * in docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md.
 */

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const __dirname = dirname(fileURLToPath(import.meta.url))

const FORBIDDEN_TRANSITIVES = [
  "@/config/env",
  "@/storage/s3",
  "@/services/core-id-mapping.service",
]

async function readModule(relative: string): Promise<string> {
  return readFile(resolve(__dirname, relative), "utf8")
}

describe("refresh-core-id-mapping CLI import isolation", () => {
  it("does not import @/config/env, @/storage/s3, or the service file directly", async () => {
    const cli = await readModule("./refresh-core-id-mapping.ts")
    for (const bad of FORBIDDEN_TRANSITIVES) {
      expect(cli).not.toMatch(new RegExp(`from\\s+["']${bad}["']`))
    }
  })

  it("imports only from the constants module (no transitive env.ts pull)", async () => {
    const constants = await readModule(
      "../services/core-id-mapping.constants.ts",
    )
    // The constants module must itself be env-free.
    for (const bad of FORBIDDEN_TRANSITIVES) {
      expect(constants).not.toMatch(new RegExp(`from\\s+["']${bad}["']`))
    }
    expect(constants).not.toMatch(/from\s+["']@\/config\/env["']/)
    // And it must actually export the constant the CLI needs.
    expect(constants).toMatch(/export\s+const\s+DEFAULT_CORE_ID_MAPPING_S3_KEY/)
  })
})

describe("core-id-mapping.service re-exports constants for backward compat", () => {
  it("still exports DEFAULT_CORE_ID_MAPPING_S3_KEY and ADMIN_MIGRATIONS_S3_PREFIX", async () => {
    const mod = await import("@/services/core-id-mapping.service")
    expect(mod.DEFAULT_CORE_ID_MAPPING_S3_KEY).toBe(
      "admin-migrations/core-id-mapping.json",
    )
    expect(mod.ADMIN_MIGRATIONS_S3_PREFIX).toBe("admin-migrations/")
  })
})

describe("core-id-mapping.constants is env-validator-free", () => {
  it("can be imported without any process.env populated", async () => {
    // If the constants file accidentally imports @/config/env again,
    // this dynamic import would throw during env validation (CI=1 in
    // the test env suppresses the t3-env throw, so the stronger static
    // assertion is the source-level regex above — this test is a
    // runtime smoke).
    const mod = await import("@/services/core-id-mapping.constants")
    expect(mod.DEFAULT_CORE_ID_MAPPING_S3_KEY).toBeTruthy()
    expect(mod.ADMIN_MIGRATIONS_S3_PREFIX).toBeTruthy()
  })
})
