import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    ADMIN_TRIGGER_API_KEYS?: string
    ENRICHMENT_CALLBACK_API_KEYS?: string
  },
}))

const { env } = await import("@/config/env")
const {
  assertBearerCsvsDisjoint,
  validateAdminTriggerBearer,
  validateEnrichmentCallbackBearer,
} = await import("@/lib/admin-trigger-auth")

const envMutable = env as {
  ADMIN_TRIGGER_API_KEYS?: string
  ENRICHMENT_CALLBACK_API_KEYS?: string
}

function reqWith(authHeader?: string): Request {
  return new Request("http://example.test/api/admin-trigger/scene-analysis", {
    method: "POST",
    headers: authHeader ? { authorization: authHeader } : undefined,
  })
}

describe("validateAdminTriggerBearer", () => {
  beforeEach(() => {
    envMutable.ADMIN_TRIGGER_API_KEYS = "test-admin-trigger-key-1"
  })

  afterEach(() => {
    envMutable.ADMIN_TRIGGER_API_KEYS = undefined
    envMutable.ENRICHMENT_CALLBACK_API_KEYS = undefined
  })

  it("returns 503 config_missing when env unset", () => {
    envMutable.ADMIN_TRIGGER_API_KEYS = undefined
    const result = validateAdminTriggerBearer(
      reqWith("Bearer test-admin-trigger-key-1"),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(503)
    expect(result.message).toMatch(/config_missing/i)
    expect(result.message).toMatch(/ADMIN_TRIGGER_API_KEYS/)
  })

  it("returns 503 config_missing when env is whitespace/comma-only", () => {
    envMutable.ADMIN_TRIGGER_API_KEYS = " , , ,"
    const result = validateAdminTriggerBearer(reqWith("Bearer anything"))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(503)
  })

  it("returns 401 when Authorization header is missing", () => {
    const result = validateAdminTriggerBearer(reqWith(undefined))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
    expect(result.message).toMatch(/required/i)
  })

  it("returns 401 when scheme is not Bearer", () => {
    const result = validateAdminTriggerBearer(reqWith("Basic dXNlcjpwYXNz"))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
  })

  it("returns 401 on empty bearer value", () => {
    const result = validateAdminTriggerBearer(reqWith("Bearer "))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
  })

  it("accepts the configured key", () => {
    const result = validateAdminTriggerBearer(
      reqWith("Bearer test-admin-trigger-key-1"),
    )
    expect(result).toEqual({ ok: true })
  })

  it("rejects a wrong key with same length", () => {
    const result = validateAdminTriggerBearer(
      reqWith("Bearer test-admin-trigger-key-X"),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
    expect(result.message).toMatch(/invalid/i)
  })

  it("rejects a key with mismatched length without throwing", () => {
    const result = validateAdminTriggerBearer(reqWith("Bearer short"))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
  })

  it("supports CSV rotation (header matches second entry)", () => {
    envMutable.ADMIN_TRIGGER_API_KEYS =
      "test-admin-trigger-key-A, test-admin-trigger-key-B"
    const result = validateAdminTriggerBearer(
      reqWith("Bearer test-admin-trigger-key-B"),
    )
    expect(result).toEqual({ ok: true })
  })

  it("ignores empty CSV slots and trims surrounding whitespace", () => {
    envMutable.ADMIN_TRIGGER_API_KEYS = " , key-with-padding ,, "
    const result = validateAdminTriggerBearer(
      reqWith("Bearer key-with-padding"),
    )
    expect(result).toEqual({ ok: true })
  })

  it("does not crash on a non-ASCII key length mismatch", () => {
    // UTF-8 byte length differs from JS code-unit length for multibyte
    // characters; the length guard must use byte length so timingSafeEqual
    // never sees mismatched buffers.
    envMutable.ADMIN_TRIGGER_API_KEYS = "café-key-12345"
    const result = validateAdminTriggerBearer(reqWith("Bearer cafe-key-12345"))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
  })

  it("validates enrichment callback keys from a separate env var", () => {
    envMutable.ENRICHMENT_CALLBACK_API_KEYS = "callback-key"
    const result = validateEnrichmentCallbackBearer(
      reqWith("Bearer callback-key"),
    )
    expect(result).toEqual({ ok: true })
  })

  it("detects callback and trigger key overlap", () => {
    expect(assertBearerCsvsDisjoint("trigger-a, shared", "callback-a")).toBe(
      true,
    )
    expect(
      assertBearerCsvsDisjoint("trigger-a, shared", "callback-a,shared"),
    ).toBe(false)
  })
})
