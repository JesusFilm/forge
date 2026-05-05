import { describe, expect, it, vi } from "vitest"
import {
  assertParallelArrayLengthsMatch,
  toPgArray,
  toPgVector,
} from "@/db/pgvector"

describe("toPgArray", () => {
  it("returns empty literal for empty input", () => {
    expect(toPgArray([])).toBe("{}")
  })

  it("quotes and comma-joins simple values", () => {
    expect(toPgArray(["a", "b", "c"])).toBe('{"a","b","c"}')
  })

  it("escapes embedded double quotes", () => {
    expect(toPgArray(['he said "hi"'])).toBe('{"he said \\"hi\\""}')
  })

  it("preserves spaces and commas inside values via quoting", () => {
    expect(toPgArray(["a, b", "c d"])).toBe('{"a, b","c d"}')
  })

  it("escapes backslash characters", () => {
    expect(toPgArray(["a\\b"])).toBe('{"a\\\\b"}')
  })

  it("rejects brace characters", () => {
    expect(() => toPgArray(["ok", "bad{val}"])).toThrow(
      /unsupported brace character/,
    )
  })

  // Stage 3 (feat-117) — nullable element support. Per-row Way A casts at
  // the SELECT seam need NULL-bearing arrays so that `chapter_title`,
  // `start_seconds`, `end_seconds`, and the per-chunk optional fields
  // round-trip cleanly inside a single `INSERT … unnest(...)` call.
  describe("nullable element support (Stage 3 — feat-117)", () => {
    it("emits the unquoted NULL token for null elements, preserving sibling quoting", () => {
      // Critical contract: the NULL token must be UNQUOTED so Postgres's
      // text-array parser interprets it as a SQL NULL when bound via
      // `?::text[]`. A quoted `"NULL"` would round-trip as the literal
      // 4-character string and silently corrupt downstream nullability.
      expect(toPgArray([null, "x"])).toBe('{NULL,"x"}')
    })

    it("emits NULL for every position when the entire array is null", () => {
      expect(toPgArray([null, null, null])).toBe("{NULL,NULL,NULL}")
    })

    it('preserves the literal three-character string "NULL" as a quoted value (distinct from null)', () => {
      // The quoted form is a distinct element from the unquoted token.
      // A future bug that conflated the two (e.g. `if (v === null || v === "NULL")`)
      // would silently convert the string "NULL" into a SQL NULL —
      // catching it requires testing both spellings.
      expect(toPgArray(["NULL", "x"])).toBe('{"NULL","x"}')
    })

    it("still rejects brace characters when the array also contains nulls", () => {
      expect(() => toPgArray([null, "before{after"])).toThrow(
        /unsupported brace character/,
      )
    })

    it("accepts a mix of nulls, plain values, escaped quotes, and backslashes", () => {
      expect(toPgArray([null, "a", 'he said "hi"', "a\\b", null])).toBe(
        '{NULL,"a","he said \\"hi\\"","a\\\\b",NULL}',
      )
    })
  })
})

describe("assertParallelArrayLengthsMatch", () => {
  // Stage 3 (feat-117) — shared preflight guard for `INSERT … unnest(...)`
  // bulk writes. PG18's `unnest(arr1, arr2, ...)` silently NULL-pads
  // unequal-length arrays, so the helper throws via the caller-supplied
  // typed-error factory BEFORE `$executeRaw` ships the bad SQL.

  it("returns void without throwing when every parallel array matches the expected length", () => {
    const factory = vi.fn(
      (msg: string) => new Error(`should-not-be-called: ${msg}`),
    )
    expect(() =>
      assertParallelArrayLengthsMatch(
        3,
        [
          { name: "a", length: 3 },
          { name: "b", length: 3 },
          { name: "c", length: 3 },
        ],
        factory,
      ),
    ).not.toThrow()
    expect(factory).not.toHaveBeenCalled()
  })

  it("throws via the error factory with the mismatching column name and a length-mismatch message", () => {
    class TestError extends Error {
      constructor(
        readonly code: "artifact_invalid",
        message: string,
      ) {
        super(message)
        this.name = "TestError"
      }
    }
    const factory = vi.fn(
      (msg: string) => new TestError("artifact_invalid", msg),
    )
    expect(() =>
      assertParallelArrayLengthsMatch(
        3,
        [
          { name: "ids", length: 3 },
          { name: "vectors", length: 2 }, // mismatched
          { name: "models", length: 3 },
        ],
        factory,
      ),
    ).toThrow(TestError)
    expect(factory).toHaveBeenCalledTimes(1)
    const [message] = factory.mock.calls[0]!
    expect(message).toContain("vectors")
    expect(message).toMatch(/expected=3/)
    expect(message).toMatch(/vectors=2/)
  })

  it("invokes the factory with a string message and propagates whatever Error class the factory returns", () => {
    class CustomError extends Error {
      readonly tag = "custom" as const
    }
    const factory = vi.fn((msg: string) => new CustomError(msg))
    expect(() =>
      assertParallelArrayLengthsMatch(
        2,
        [{ name: "only", length: 1 }],
        factory,
      ),
    ).toThrow(CustomError)
    const [message] = factory.mock.calls[0]!
    expect(typeof message).toBe("string")
    expect(message).toContain("only")
  })

  it("throws on the FIRST mismatched column (later columns are not evaluated by the factory)", () => {
    const factory = vi.fn((msg: string) => new Error(msg))
    expect(() =>
      assertParallelArrayLengthsMatch(
        4,
        [
          { name: "first-bad", length: 3 },
          { name: "second-bad", length: 5 },
        ],
        factory,
      ),
    ).toThrow(/first-bad/)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it("treats an empty arrays list as a no-op (no throw, factory not called)", () => {
    const factory = vi.fn((msg: string) => new Error(msg))
    expect(() => assertParallelArrayLengthsMatch(0, [], factory)).not.toThrow()
    expect(factory).not.toHaveBeenCalled()
  })
})

describe("toPgVector", () => {
  it("returns empty literal for empty input", () => {
    expect(toPgVector([])).toBe("[]")
  })

  it("formats a 1536-dim float array", () => {
    const v = [0.1, -0.2, 0.3]
    expect(toPgVector(v)).toBe("[0.1,-0.2,0.3]")
  })

  it("does not wrap integers in quotes", () => {
    expect(toPgVector([1, 2, 3])).toBe("[1,2,3]")
  })
})
