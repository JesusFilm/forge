import { describe, expect, it } from "vitest"
import {
  WatchAudienceConfigurationSchema,
  createWatchAudienceConfiguration,
} from "./watch-audience"

describe("Watch audience authoring contract", () => {
  it("round-trips a serializable starter with the exact four roles", () => {
    const config = createWatchAudienceConfiguration()
    expect(
      WatchAudienceConfigurationSchema.parse(
        JSON.parse(JSON.stringify(config)),
      ),
    ).toEqual(config)
    expect(config.roles.map((r) => r.id)).toEqual([
      "explore",
      "grow",
      "share",
      "partner",
    ])
  })
  it.each([
    "fourth-question",
    "duplicate-role",
    "duplicate-question",
    "duplicate-option",
    "duplicate-action",
    "dangling-score",
    "duplicate-score",
    "weight",
    "copy",
    "cardinality",
    "unknown-kind",
    "unknown-field",
  ])("rejects %s", (fault) => {
    const c = createWatchAudienceConfiguration()
    const r = c.roles[0]!,
      q = r.questions[0]!,
      o = q.options[0]!
    if (fault === "fourth-question")
      r.questions.push({ ...structuredClone(q), id: "fourth-question" })
    if (fault === "duplicate-role") c.roles[1]!.id = r.id
    if (fault === "duplicate-question") r.questions[1]!.id = q.id
    if (fault === "duplicate-option") q.options[1]!.id = o.id
    if (fault === "duplicate-action") r.actions[1]!.id = r.actions[0]!.id
    if (fault === "dangling-score") o.scores[0]!.actionId = "missing"
    if (fault === "duplicate-score")
      o.scores.push(structuredClone(o.scores[0]!))
    if (fault === "weight") o.scores[0]!.weight = 11
    if (fault === "copy") r.label = "x".repeat(61)
    if (fault === "cardinality") q.options = []
    if (fault === "unknown-kind")
      Object.assign(r.actions[0]!.target, { kind: "react-component" })
    if (fault === "unknown-field") Object.assign(r, { html: "<b>hello</b>" })
    expect(WatchAudienceConfigurationSchema.safeParse(c).success).toBe(false)
  })
  it.each([
    "javascript:alert(1)",
    "//example.org",
    "https://example.org/\npath",
    "https://user:pass@example.org",
    "https://example.org/ a",
    "https:example.org",
    "http://example.org",
    "https://example.org/\u0085",
  ])("rejects unsafe resource %j", (url) => {
    const c = createWatchAudienceConfiguration()
    c.roles[0]!.actions[0]!.target = { kind: "resource", url }
    expect(WatchAudienceConfigurationSchema.safeParse(c).success).toBe(false)
  })
  it("accepts every supported semantic target", () => {
    const c = createWatchAudienceConfiguration()
    for (const target of [
      { kind: "video", slug: "jesus" },
      { kind: "history" },
      { kind: "languages" },
      ...["share", "download", "bible-quotes", "next-episode"].map(
        (target) => ({ kind: "current-video", target }),
      ),
      { kind: "resource", url: "https://www.jesusfilm.org/resources/" },
    ]) {
      Object.assign(c.roles[0]!.actions[0]!, { target })
      expect(WatchAudienceConfigurationSchema.safeParse(c).success).toBe(true)
    }
  })
})
