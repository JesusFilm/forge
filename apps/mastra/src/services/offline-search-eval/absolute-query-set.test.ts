import { describe, expect, it } from "vitest"

import {
  ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION,
  absolutePublicWatchQuerySet,
} from "./absolute-query-set"

describe("absolute public Watch query set", () => {
  it("freezes unique development and held-out cases under a version", () => {
    const cases = absolutePublicWatchQuerySet()
    expect(ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION).toBe(
      "public-watch-absolute/v2",
    )
    expect(cases.length).toBeGreaterThanOrEqual(100)
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length)
    expect(cases.some((entry) => entry.split === "development")).toBe(true)
    expect(cases.some((entry) => entry.split === "held-out")).toBe(true)
  })

  it("pre-registers one no-result restraint case in each split", () => {
    const noResultCases = absolutePublicWatchQuerySet().filter(
      (entry) => entry.expectedNoResult,
    )

    expect(noResultCases.map((entry) => entry.id)).toEqual([
      "seed-no-result-random-development",
      "seed-no-result-random-held-out",
    ])
    expect(new Set(noResultCases.map((entry) => entry.split))).toEqual(
      new Set(["development", "held-out"]),
    )
  })

  it("covers title, topic, semantic, typo, confusing, and multilingual intent", () => {
    const cases = absolutePublicWatchQuerySet()
    const intents = new Set(cases.map((entry) => entry.intent))
    expect(intents).toEqual(
      new Set([
        "product-title",
        "metadata-topic",
        "semantic-intent",
        "typo-recovery",
        "confusing-or-no-result",
      ]),
    )
    expect(
      cases.filter((entry) => entry.tags.includes("multilingual")).length,
    ).toBeGreaterThanOrEqual(10)
  })

  it("pins English, Mandarin, and Thai JESUS-family checks across both splits", () => {
    const cases = absolutePublicWatchQuerySet()
    expect(cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "seed-jesus",
          locale: "en",
          split: "development",
        }),
        expect.objectContaining({
          id: "seed-chinese-who-is-jesus",
          locale: "zh",
          languageSlug: "mandarin-china",
        }),
        expect.objectContaining({
          id: "seed-thai-who-is-jesus",
          locale: "th",
          languageSlug: "thai",
        }),
      ]),
    )
    expect(
      new Set(
        cases
          .filter((entry) =>
            [
              "seed-jesus",
              "seed-chinese-who-is-jesus",
              "seed-thai-who-is-jesus",
            ].includes(entry.id),
          )
          .map((entry) => entry.split),
      ),
    ).toEqual(new Set(["development", "held-out"]))
  })
})
