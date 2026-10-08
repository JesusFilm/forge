import { describe, expect, it } from "vitest"
import {
  parseWatchDescription,
  toWatchMetadataDescription,
} from "@/lib/watch-description"

const suffix =
  "For more information please visit - https://www.lumoproject.com Follow us on Facebook - https://www.facebook.com/thelumoproject Follow us on Twitter - https://twitter.com/TheLumoProject Follow us on Instagram - https://www.instagram.com/lumo.project"

describe("watch description parsing", () => {
  it("separates the known LUMO source footer from editorial copy", () => {
    expect(parseWatchDescription(`The Gospel of John. ${suffix}`)).toEqual({
      editorial: "The Gospel of John.",
      attribution: { lumo: true },
    })
  })

  it("recognizes the non-www LUMO site variant", () => {
    expect(
      parseWatchDescription(
        "A story. " +
          suffix.replace(
            "https://www.lumoproject.com",
            "https://lumoproject.com",
          ),
      ).attribution,
    ).toEqual({ lumo: true })
  })

  it("leaves unrelated prose and arbitrary URLs byte-for-byte unchanged", () => {
    const source =
      "Visit https://example.org for details. Follow us on Facebook."
    expect(parseWatchDescription(source)).toEqual({
      editorial: source,
      attribution: null,
    })
  })

  it("does not match altered footer wording, case, or a missing word boundary", () => {
    for (const source of [
      `The Gospel. ${suffix.replace("Follow us on Facebook", "follow us on Facebook")}`,
      `The Gospel.visit${suffix}`,
    ]) {
      expect(parseWatchDescription(source)).toEqual({
        editorial: source,
        attribution: null,
      })
    }
  })

  it("uses editorial copy for bounded metadata", () => {
    const source = `${"A long editorial description with useful words. ".repeat(6)}${suffix}`
    const metadata = toWatchMetadataDescription(source)
    expect(metadata.length).toBeLessThanOrEqual(160)
    expect(metadata).not.toContain("http")
    expect(metadata).toMatch(/…$/)
  })
})
