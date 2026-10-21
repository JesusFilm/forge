import { afterEach, describe, expect, it, vi } from "vitest"
import { randomUuid, RandomUuidUnavailableError } from "@/lib/random-uuid"

const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("randomUuid", () => {
  it("uses crypto.randomUUID in a secure context", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-2222-4333-8444-555555555555",
      getRandomValues: () => {
        throw new Error("should not be called")
      },
    })
    expect(randomUuid()).toBe("11111111-2222-4333-8444-555555555555")
  })

  it("builds a v4 UUID from getRandomValues when randomUUID is missing (plain HTTP, Firefox < 95)", () => {
    const getRandomValues = vi.fn()
    const real = globalThis.crypto
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => {
        getRandomValues(array)
        return real.getRandomValues(array)
      },
    })
    const ids = new Set(Array.from({ length: 50 }, () => randomUuid()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(V4)
    expect(getRandomValues).toHaveBeenCalledTimes(50)
  })

  it("sets the version and variant bits on the raw bytes", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => array.fill(0xff),
    })
    expect(randomUuid()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff")
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => array.fill(0),
    })
    expect(randomUuid()).toBe("00000000-0000-4000-8000-000000000000")
  })

  it("throws a typed error instead of using a weak random source", () => {
    vi.stubGlobal("crypto", undefined)
    expect(() => randomUuid()).toThrow(RandomUuidUnavailableError)
  })
})
