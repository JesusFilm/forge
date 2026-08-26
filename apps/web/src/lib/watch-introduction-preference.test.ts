/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest"

import {
  WATCH_INTRODUCTION_STORAGE_KEY,
  isWatchIntroductionLocaleEligible,
  markWatchIntroductionCompleted,
  readWatchIntroductionCompletion,
} from "@/lib/watch-introduction-preference"

beforeEach(() => {
  const values = new Map<string, string>()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  })
})

describe("watch introduction preference", () => {
  it("round-trips the versioned completion marker", () => {
    expect(readWatchIntroductionCompletion()).toBe("incomplete")

    expect(markWatchIntroductionCompleted()).toBe(true)

    expect(window.localStorage.getItem(WATCH_INTRODUCTION_STORAGE_KEY)).toBe(
      "completed",
    )
    expect(readWatchIntroductionCompletion()).toBe("completed")
  })

  it("fails closed when browser storage cannot be read or written", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new DOMException("denied")
        },
        setItem: () => {
          throw new DOMException("denied")
        },
      },
    })

    expect(readWatchIntroductionCompletion()).toBe("unavailable")
    expect(markWatchIntroductionCompleted()).toBe(false)
  })

  it("fails closed when reads work but writes are unavailable", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => {
          throw new DOMException("denied")
        },
      },
    })

    expect(readWatchIntroductionCompletion()).toBe("unavailable")
  })

  it("does not mistake an unknown marker value for this version", () => {
    window.localStorage.setItem(WATCH_INTRODUCTION_STORAGE_KEY, "legacy")

    expect(readWatchIntroductionCompletion()).toBe("incomplete")
  })

  it("limits the tour to catalogs with authored release copy", () => {
    expect(isWatchIntroductionLocaleEligible("en")).toBe(true)
    expect(isWatchIntroductionLocaleEligible("ar")).toBe(true)
    expect(isWatchIntroductionLocaleEligible("zh")).toBe(true)
    expect(isWatchIntroductionLocaleEligible("fr")).toBe(false)
  })
})
