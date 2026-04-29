// Unit tests for the lazy cms Postgres pool.
//
// Verifies:
//   - getCmsPgPool() throws CmsDatabaseUrlMissingError when env is unset
//   - getCmsPgPool() returns the same Pool instance on repeat calls
//     (singleton)
//   - The thrown error carries a stable code so workflow consumers can
//     branch on `instanceof` without parsing the message
//
// The actual Pool construction is not exercised against a real
// Postgres here — that's covered by the repository tests in Unit 3
// against a Strapi-shaped fixture.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const envMock = vi.hoisted(() => ({
  env: {
    CMS_DATABASE_URL: undefined as string | undefined,
  },
}))

vi.mock("@/config/env", () => envMock)

// Imported AFTER the env mock so `env.CMS_DATABASE_URL` resolves to
// the mock value at lookup time.
import {
  CmsDatabaseUrlMissingError,
  _resetCmsPgPoolForTests,
  getCmsPgPool,
} from "./cms-pg"

describe("getCmsPgPool", () => {
  beforeEach(() => {
    _resetCmsPgPoolForTests()
    envMock.env.CMS_DATABASE_URL = undefined
  })

  afterEach(() => {
    _resetCmsPgPoolForTests()
  })

  it("throws CmsDatabaseUrlMissingError when CMS_DATABASE_URL is unset", () => {
    expect(() => getCmsPgPool()).toThrow(CmsDatabaseUrlMissingError)
  })

  it("CmsDatabaseUrlMissingError carries a stable typed code", () => {
    try {
      getCmsPgPool()
      expect.fail("expected getCmsPgPool to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(CmsDatabaseUrlMissingError)
      expect((err as CmsDatabaseUrlMissingError).code).toBe(
        "cms_database_url_missing",
      )
      expect((err as CmsDatabaseUrlMissingError).name).toBe(
        "CmsDatabaseUrlMissingError",
      )
    }
  })

  it("error message names the env var so operators can act on it", () => {
    try {
      getCmsPgPool()
      expect.fail("expected getCmsPgPool to throw")
    } catch (err) {
      expect((err as Error).message).toContain("CMS_DATABASE_URL")
    }
  })

  it("returns the same Pool instance on repeat calls (singleton)", () => {
    envMock.env.CMS_DATABASE_URL = "postgres://forge:secret@cms-pg:5432/cms"

    const first = getCmsPgPool()
    const second = getCmsPgPool()

    expect(first).toBe(second)

    // The pool ships with native pg event-emitter shape; we don't need
    // to assert internals — referential equality is the singleton
    // contract.
    void first.end().catch(() => {
      // Pool.end() requires no live clients; we never connected one.
      // Swallow any rejection so the test exits cleanly.
    })
  })

  it("constructs a fresh Pool after _resetCmsPgPoolForTests()", () => {
    envMock.env.CMS_DATABASE_URL = "postgres://forge:secret@cms-pg:5432/cms"

    const first = getCmsPgPool()
    _resetCmsPgPoolForTests()
    const second = getCmsPgPool()

    expect(first).not.toBe(second)

    void first.end().catch(() => {})
    void second.end().catch(() => {})
  })

  it("re-reads env after a reset (env change picked up)", () => {
    envMock.env.CMS_DATABASE_URL = undefined
    expect(() => getCmsPgPool()).toThrow(CmsDatabaseUrlMissingError)

    _resetCmsPgPoolForTests()
    envMock.env.CMS_DATABASE_URL = "postgres://forge:secret@cms-pg:5432/cms"

    const pool = getCmsPgPool()
    expect(pool).toBeDefined()
    void pool.end().catch(() => {})
  })
})
