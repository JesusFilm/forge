import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockEnv, modeRef } = vi.hoisted(() => ({
  mockEnv: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://canonical.local",
    FORGE_PARITY_DEBUG: "0" as "0" | "1",
  },
  // The bridge's U5 mode guard short-circuits unless the active mode
  // is `"dual-read"`. After U4 collapsed the active union to
  // `"strapi" | "admin"`, that mode is unreachable in production — but
  // these tests exercise the bridge's emission contract directly, so
  // we default-mock to the historical canary mode and let the mode-
  // guard tests flip `modeRef.value` to exercise the short-circuit.
  modeRef: { value: "dual-read" as string },
}))

vi.mock("@/env", () => ({
  env: mockEnv,
}))

vi.mock("@/lib/content-api-mode", () => ({
  getContentApiMode: () => modeRef.value,
}))

import {
  PARITY_LOG_EVENTS,
  runDualReadComparison,
  type DualReadOutcome,
} from "./parity-bridge"

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

/**
 * Minimal Strapi response that satisfies normalizeStrapi's required
 * fields. `locale` is intentionally omitted in some scenarios to
 * exercise the bridge's synth path.
 */
// Fixtures use IDENTICAL content fields by default so the zero-diff
// happy path holds without per-test patching. Tests exercising specific
// diff classes mutate fields locally before invoking the bridge.
const SHARED_DESCRIPTION = "Shared canonical description"
const SHARED_TITLE = "Christmas Experience"

function strapiOk(overrides: Partial<DualReadOutcome["strapi"]> = {}) {
  return {
    ok: true as const,
    response: {
      documentId: "shared-id-1",
      slug: "christmas",
      locale: "en",
      title: SHARED_TITLE,
      metaDescription: SHARED_DESCRIPTION,
      ogImage: {
        url: "https://canonical.local/uploads/og.png",
        width: 1200,
        height: 630,
        alternativeText: "OG alt",
      },
      blocks: [],
    },
    durationMs: 42,
    ...overrides,
  } as DualReadOutcome["strapi"]
}

function adminOk(overrides: Partial<DualReadOutcome["admin"]> = {}) {
  return {
    ok: true as const,
    response: {
      id: "shared-id-1",
      slug: "christmas",
      locale: "en",
      title: SHARED_TITLE,
      // Admin schema field is metaDescription; bridge remaps to
      // description before normalizeAdmin. Same value as Strapi side
      // so the happy-path diff is zero across all channels.
      metaDescription: SHARED_DESCRIPTION,
      ogImageUrl: "https://canonical.local/uploads/og.png",
      blocks: [],
    },
    durationMs: 38,
    ...overrides,
  } as DualReadOutcome["admin"]
}

function makeOutcome(
  strapi: DualReadOutcome["strapi"],
  admin: DualReadOutcome["admin"],
): DualReadOutcome {
  return {
    slug: "christmas",
    urlLocale: "en",
    strapi,
    admin,
  }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("parity-bridge — runDualReadComparison", () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    mockEnv.FORGE_PARITY_DEBUG = "0"
  })

  afterEach(() => {
    logSpy.mockRestore()
    mockEnv.FORGE_PARITY_DEBUG = "0"
  })

  function lastLogPayload(): Record<string, unknown> {
    expect(logSpy).toHaveBeenCalled()
    const call = logSpy.mock.calls.at(-1)
    expect(call).toBeDefined()
    expect(typeof call?.[0]).toBe("string")
    return JSON.parse(call?.[0] as string) as Record<string, unknown>
  }

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it("emits forge.parity.diff with zero counts when both sides match", () => {
    runDualReadComparison(makeOutcome(strapiOk(), adminOk()))
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.diff")
    expect(payload.diffCounts).toMatchObject({
      structural: 0,
      value: 0,
      order: 0,
      semantic: 0,
      potentiallyTruncated: 0,
    })
    expect(payload.timings).toMatchObject({ strapiMs: 42, adminMs: 38 })
  })

  it("synthesizes locale from urlLocale when Strapi response lacks it", () => {
    const strapi = strapiOk()
    // Strapi side without `locale` (current fragment may not select it)
    delete (
      strapi as unknown as {
        response: { locale?: string }
      }
    ).response.locale
    runDualReadComparison(makeOutcome(strapi, adminOk()))
    const payload = lastLogPayload()
    // Should not throw a strapi_normalization error — bridge synthesizes
    expect(payload.event).toBe("forge.parity.diff")
  })

  it("remaps admin metaDescription to description before normalizeAdmin", () => {
    // Admin response uses metaDescription; harness consumes description.
    // If the bridge didn't remap, normalizeAdmin would still run (description
    // is nullable) but the admin-side description would be undefined,
    // surfacing as a value diff vs Strapi's metaDescription. With the remap
    // in place, both sides' meta.description match.
    const strapi = strapiOk()
    ;(
      strapi as { response: { metaDescription: string } }
    ).response.metaDescription = "shared"
    const admin = adminOk()
    ;(
      admin as { response: { metaDescription: string } }
    ).response.metaDescription = "shared"
    runDualReadComparison(makeOutcome(strapi, admin))
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.diff")
    expect((payload.diffCounts as { value: number }).value).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // R13 — log payload strips raw content values
  // ---------------------------------------------------------------------------

  it("does NOT include raw ValueDiff strapi/admin fields in the log payload", () => {
    // Force a value diff: differing titles
    const strapi = strapiOk()
    ;(strapi as { response: { title: string } }).response.title =
      "Strapi-only secret title"
    const admin = adminOk()
    ;(admin as { response: { title: string } }).response.title =
      "Admin-only secret title"
    runDualReadComparison(makeOutcome(strapi, admin))

    const raw = logSpy.mock.calls.at(-1)?.[0]
    expect(typeof raw).toBe("string")
    const serialized = raw as string
    // R13 enforcement: neither raw title string appears in the production
    // log payload, even though the differ knows about both internally.
    expect(serialized).not.toContain("Strapi-only secret title")
    expect(serialized).not.toContain("Admin-only secret title")

    const payload = JSON.parse(serialized) as Record<string, unknown>
    const counts = payload.diffCounts as { value: number }
    expect(counts.value).toBeGreaterThanOrEqual(1)
    expect(payload.diffPaths).toBeInstanceOf(Array)
  })

  it("DOES include diffSamples with raw values when FORGE_PARITY_DEBUG=1 (dev opt-in)", () => {
    mockEnv.FORGE_PARITY_DEBUG = "1"
    const strapi = strapiOk()
    ;(strapi as { response: { title: string } }).response.title =
      "STRAPI_TITLE_X"
    const admin = adminOk()
    ;(admin as { response: { title: string } }).response.title = "ADMIN_TITLE_X"
    runDualReadComparison(makeOutcome(strapi, admin))

    const raw = logSpy.mock.calls.at(-1)?.[0] as string
    expect(raw).toContain("diffSamples")
    expect(raw).toContain("STRAPI_TITLE_X")
    expect(raw).toContain("ADMIN_TITLE_X")
  })

  // ---------------------------------------------------------------------------
  // Orchestrated outcome events
  // ---------------------------------------------------------------------------

  it("emits forge.parity.both_failed when both sides errored", () => {
    runDualReadComparison(
      makeOutcome(
        {
          ok: "error",
          error: new Error("strapi network error"),
          durationMs: 10000,
        },
        {
          ok: "error",
          error: new Error("admin network error"),
          durationMs: 3000,
        },
      ),
    )
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.both_failed")
    expect(payload.errorMessage).toBe("strapi network error")
  })

  it("emits forge.parity.strapi_failed_admin_succeeded — the U5b advance gating signal", () => {
    runDualReadComparison(
      makeOutcome(
        {
          ok: "error",
          error: new Error("strapi 503"),
          durationMs: 10000,
        },
        adminOk(),
      ),
    )
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.strapi_failed_admin_succeeded")
    expect(payload.errorMessage).toBe("strapi 503")
  })

  it("emits forge.parity.admin_timeout when admin call exceeded budget", () => {
    runDualReadComparison(
      makeOutcome(strapiOk(), { ok: "timeout", durationMs: 3000 }),
    )
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.admin_timeout")
    expect((payload.timings as { adminMs: number }).adminMs).toBe(3000)
  })

  it("emits forge.parity.harness_error subkind admin_fetch_error when admin errored (non-timeout)", () => {
    runDualReadComparison(
      makeOutcome(strapiOk(), {
        ok: "error",
        error: new Error("admin 500"),
        durationMs: 1500,
      }),
    )
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.harness_error")
    expect(payload.subkind).toBe("admin_fetch_error")
  })

  // ---------------------------------------------------------------------------
  // Harness error classification
  // ---------------------------------------------------------------------------

  it("emits forge.parity.harness_error subkind strapi_normalization when Strapi response is malformed", () => {
    const strapi = strapiOk()
    // Drop required fields — bridge synthesizes locale, but documentId
    // is left empty and normalizeStrapi throws StrapiNormalizationError.
    ;(strapi as { response: { documentId: string } }).response.documentId = ""
    runDualReadComparison(makeOutcome(strapi, adminOk()))
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.harness_error")
    expect(payload.subkind).toBe("strapi_normalization")
  })

  it("emits forge.parity.harness_error subkind admin_blocks_validation when admin blocks fail Zod parse", () => {
    const admin = adminOk()
    // Admin blocks must pass BlocksSchema.parse() in normalize-admin.ts.
    // Feeding a clearly-invalid shape (string "not-an-array") triggers
    // AdminBlocksValidationError rather than the comparator path.
    ;(admin as { response: { blocks: unknown } }).response.blocks =
      "not-an-array"
    runDualReadComparison(makeOutcome(strapiOk(), admin))
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.harness_error")
    expect(payload.subkind).toBe("admin_blocks_validation")
  })

  it("emits forge.parity.admin_missing when admin response is null and Strapi has data (typical backfill gap)", () => {
    runDualReadComparison(
      makeOutcome(strapiOk(), {
        ok: true,
        response: null,
        durationMs: 50,
      }),
    )
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.admin_missing")
    // No subkind — admin_missing isn't a harness_error variant.
    expect(payload.subkind).toBeUndefined()
  })

  it("emits forge.parity.harness_error subkind comparator_unknown when both responses are null", () => {
    runDualReadComparison(
      makeOutcome(
        { ok: true, response: null, durationMs: 30 },
        { ok: true, response: null, durationMs: 40 },
      ),
    )
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.harness_error")
    expect(payload.subkind).toBe("comparator_unknown")
  })

  it("emits forge.parity.harness_error subkind comparator_unknown when Strapi is null but admin has data (anomalous)", () => {
    runDualReadComparison(
      makeOutcome({ ok: true, response: null, durationMs: 30 }, adminOk()),
    )
    const payload = lastLogPayload()
    expect(payload.event).toBe("forge.parity.harness_error")
    expect(payload.subkind).toBe("comparator_unknown")
  })

  // ---------------------------------------------------------------------------
  // Contract — log payload shape and event-name union
  // ---------------------------------------------------------------------------

  it("payload is JSON-parseable and round-trips top-level shape", () => {
    runDualReadComparison(makeOutcome(strapiOk(), adminOk()))
    const raw = logSpy.mock.calls.at(-1)?.[0] as string
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed).toMatchObject({
      event: expect.any(String),
      route: "[slug]",
      slug: "christmas",
      locale: "en",
    })
  })

  it("PARITY_LOG_EVENTS pins the seven events the bridge emits", () => {
    // The closed type union enforces compile-time exhaustiveness; this
    // test pins the count so an accidental addition or removal is loud
    // at runtime too.
    expect(new Set(PARITY_LOG_EVENTS)).toEqual(
      new Set([
        "forge.parity.diff",
        "forge.parity.admin_timeout",
        "forge.parity.harness_error",
        "forge.parity.strapi_failed_admin_succeeded",
        "forge.parity.both_failed",
        "forge.parity.admin_missing",
        "forge.parity.canary_failed",
      ]),
    )
    expect(PARITY_LOG_EVENTS).toHaveLength(7)
  })

  // ---------------------------------------------------------------------------
  // R13 defense-in-depth — production strips raw values even when
  // FORGE_PARITY_DEBUG is set in error
  // ---------------------------------------------------------------------------

  it("does NOT include diffSamples when FORGE_PARITY_DEBUG=1 + NODE_ENV=production (defense-in-depth)", () => {
    const procEnv = process.env as Record<string, string | undefined>
    const originalNodeEnv = procEnv.NODE_ENV
    mockEnv.FORGE_PARITY_DEBUG = "1"
    procEnv.NODE_ENV = "production"
    try {
      const strapi = strapiOk()
      ;(strapi as { response: { title: string } }).response.title =
        "STRAPI_PROD_TITLE"
      const admin = adminOk()
      ;(admin as { response: { title: string } }).response.title =
        "ADMIN_PROD_TITLE"
      runDualReadComparison(makeOutcome(strapi, admin))

      const raw = logSpy.mock.calls.at(-1)?.[0] as string
      // R13 invariant holds: production NEVER carries raw content
      // values, even when FORGE_PARITY_DEBUG=1 is set in error.
      expect(raw).not.toContain("diffSamples")
      expect(raw).not.toContain("STRAPI_PROD_TITLE")
      expect(raw).not.toContain("ADMIN_PROD_TITLE")
    } finally {
      procEnv.NODE_ENV = originalNodeEnv
    }
  })
})

// ---------------------------------------------------------------------------
// U5 (PR-B) mode guard — short-circuit when the active mode is anything
// other than `"dual-read"`. After U4 collapsed the active union, this
// effectively kills all canary emission.
// ---------------------------------------------------------------------------

describe("parity-bridge — mode guard", () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    // Restore the dual-read default after every test so unrelated suites
    // run against the historical emission contract.
    modeRef.value = "dual-read"
  })

  it("emits ZERO log events when the active mode is 'admin'", () => {
    modeRef.value = "admin"
    runDualReadComparison({
      slug: "christmas",
      urlLocale: "en",
      strapi: {
        ok: true,
        response: {
          documentId: "id",
          slug: "christmas",
          locale: "en",
          title: "T",
          metaDescription: "D",
          ogImage: null,
          blocks: [],
        },
        durationMs: 10,
      },
      admin: {
        ok: true,
        response: {
          id: "id",
          slug: "christmas",
          locale: "en",
          title: "T",
          metaDescription: "D",
          ogImageUrl: null,
          blocks: [],
        },
        durationMs: 10,
      },
    })

    expect(logSpy).not.toHaveBeenCalled()
  })

  it("emits ZERO log events when the active mode is 'strapi'", () => {
    modeRef.value = "strapi"
    runDualReadComparison({
      slug: "any",
      urlLocale: "en",
      strapi: {
        ok: "error",
        error: new Error("upstream"),
        durationMs: 0,
      },
      admin: {
        ok: "error",
        error: new Error("upstream"),
        durationMs: 0,
      },
    })

    expect(logSpy).not.toHaveBeenCalled()
  })
})
