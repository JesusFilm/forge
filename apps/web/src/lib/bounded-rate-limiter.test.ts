import { describe, expect, it } from "vitest"

import {
  createBoundedRateLimiter,
  trustedClientKey,
} from "./bounded-rate-limiter"

function clock(start = 1_000_000) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe("createBoundedRateLimiter", () => {
  it("admits up to the limit per key in a window, then refuses with a whole-second Retry-After, without touching other keys", () => {
    const time = clock()
    const limiter = createBoundedRateLimiter({
      limit: 3,
      windowMs: 60_000,
      maxKeys: 10,
      overflowLimit: 3,
      now: time.now,
    })
    for (let i = 0; i < 3; i++) {
      expect(limiter.admit("a")).toEqual({ allowed: true })
    }
    time.advance(20_500)
    expect(limiter.admit("a")).toEqual({
      allowed: false,
      retryAfterSeconds: 40,
    })
    expect(limiter.admit("b")).toEqual({ allowed: true })
  })

  it("reopens a key when its window expires, and a refusal does not extend the window", () => {
    const time = clock()
    const limiter = createBoundedRateLimiter({
      limit: 1,
      windowMs: 60_000,
      maxKeys: 10,
      overflowLimit: 1,
      now: time.now,
    })
    expect(limiter.admit("a").allowed).toBe(true)
    time.advance(59_999)
    expect(limiter.admit("a").allowed).toBe(false)
    expect(limiter.admit("a").allowed).toBe(false)
    time.advance(1)
    expect(limiter.admit("a")).toEqual({ allowed: true })
  })

  it("never tracks more than maxKeys keys: new keys over the cap share one bounded overflow bucket and never evict a tracked key", () => {
    const time = clock()
    const limiter = createBoundedRateLimiter({
      limit: 2,
      windowMs: 60_000,
      maxKeys: 3,
      overflowLimit: 4,
      now: time.now,
    })
    expect(limiter.admit("a").allowed).toBe(true)
    expect(limiter.admit("a").allowed).toBe(true)
    expect(limiter.admit("b").allowed).toBe(true)
    expect(limiter.admit("c").allowed).toBe(true)
    expect(limiter.size()).toBe(3)

    // Four distinct strangers arrive: all fit the shared overflow allowance...
    for (const stranger of ["d", "e", "f", "g"]) {
      expect(limiter.admit(stranger).allowed).toBe(true)
    }
    // ...the fifth, and any later one, does not, whatever its key.
    expect(limiter.admit("h").allowed).toBe(false)
    expect(limiter.admit("i").allowed).toBe(false)
    expect(limiter.size()).toBe(3)

    // The flood did not evict `a`: it is still refused rather than reset.
    expect(limiter.admit("a").allowed).toBe(false)
  })

  it("holds a hard memory bound under a distinct-key flood", () => {
    const time = clock()
    const limiter = createBoundedRateLimiter({
      limit: 5,
      windowMs: 60_000,
      maxKeys: 100,
      overflowLimit: 5,
      now: time.now,
    })
    for (let i = 0; i < 20_000; i++) limiter.admit(`10.0.${i >> 8}.${i & 255}`)
    expect(limiter.size()).toBe(100)
  })

  it("expires idle keys so capacity returns once their window has passed", () => {
    const time = clock()
    const limiter = createBoundedRateLimiter({
      limit: 1,
      windowMs: 60_000,
      maxKeys: 2,
      overflowLimit: 1,
      now: time.now,
    })
    limiter.admit("a")
    limiter.admit("b")
    expect(limiter.size()).toBe(2)
    time.advance(60_000)
    // Both windows are over: a newcomer gets its own bucket.
    expect(limiter.admit("c")).toEqual({ allowed: true })
    expect(limiter.admit("c").allowed).toBe(false)
    expect(limiter.size()).toBe(1)
    // Freed capacity is real: `d` also gets its own bucket, and only a third
    // newcomer meets the cap and the (untouched) one-request overflow allowance.
    expect(limiter.admit("d")).toEqual({ allowed: true })
    expect(limiter.size()).toBe(2)
    expect(limiter.admit("e").allowed).toBe(true)
    expect(limiter.admit("f").allowed).toBe(false)
  })

  it("reopens the overflow bucket when its own window expires", () => {
    const time = clock()
    const limiter = createBoundedRateLimiter({
      limit: 1,
      windowMs: 60_000,
      maxKeys: 1,
      overflowLimit: 1,
      now: time.now,
    })
    limiter.admit("a")
    time.advance(30_000)
    expect(limiter.admit("b").allowed).toBe(true) // overflow window opens here
    expect(limiter.admit("c").allowed).toBe(false)
    time.advance(30_000) // `a` has expired; the overflow window has not
    expect(limiter.admit("d").allowed).toBe(true) // d takes the freed slot
    expect(limiter.admit("e").allowed).toBe(false) // cap again; overflow still spent
    time.advance(30_000) // overflow window is now over; `d` is still open
    expect(limiter.admit("f").allowed).toBe(true)
  })
})

describe("trustedClientKey", () => {
  it("keys on cf-connecting-ip only, ignoring a caller-supplied x-forwarded-for", () => {
    expect(
      trustedClientKey(
        new Headers({
          "cf-connecting-ip": " 203.0.113.9 ",
          "x-forwarded-for": "198.51.100.1",
        }),
      ),
    ).toBe("203.0.113.9")
    expect(
      trustedClientKey(new Headers({ "x-forwarded-for": "198.51.100.1" })),
    ).toBe("unknown")
  })

  it("collapses a missing, empty or oversized identity into the one bounded unknown bucket", () => {
    expect(trustedClientKey(new Headers())).toBe("unknown")
    expect(trustedClientKey(new Headers({ "cf-connecting-ip": "  " }))).toBe(
      "unknown",
    )
    expect(
      trustedClientKey(new Headers({ "cf-connecting-ip": "1".repeat(129) })),
    ).toBe("unknown")
  })
})
