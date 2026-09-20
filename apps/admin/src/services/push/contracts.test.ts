import { describe, expect, it } from "vitest"

import {
  PUSH_COPY_BODY_MAX_CHARS,
  PUSH_COPY_TITLE_MAX_CHARS,
  PUSH_MAX_AUDIENCE_COUNTRIES,
  PushAudienceInputSchema,
  PushCampaignCopySetSchema,
  PushDestinationInputSchema,
  PushScheduleInputSchema,
  PushTestDeviceAddInputSchema,
  PushTestDeviceIdSchema,
  isExpoPushTokenShape,
} from "./contracts"

const ENGLISH = { languageSlug: "english", title: "Hello", body: "A body" }

describe("push copy contracts", () => {
  it("accepts a title of exactly the cap", () => {
    const parsed = PushCampaignCopySetSchema.parse([
      { ...ENGLISH, title: "a".repeat(PUSH_COPY_TITLE_MAX_CHARS) },
    ])
    expect(parsed[0].title).toHaveLength(50)
  })

  it("rejects a title one character over the cap in any language", () => {
    const result = PushCampaignCopySetSchema.safeParse([
      ENGLISH,
      {
        languageSlug: "arabic",
        title: "a".repeat(PUSH_COPY_TITLE_MAX_CHARS + 1),
        body: "A body",
      },
    ])
    expect(result.success).toBe(false)
  })

  it("rejects a body one character over the cap", () => {
    const result = PushCampaignCopySetSchema.safeParse([
      { ...ENGLISH, body: "b".repeat(PUSH_COPY_BODY_MAX_CHARS + 1) },
    ])
    expect(result.success).toBe(false)
  })

  it("requires English copy", () => {
    const result = PushCampaignCopySetSchema.safeParse([
      { languageSlug: "arabic", title: "Hello", body: "A body" },
    ])
    expect(result.success).toBe(false)
  })

  it("rejects two rows for one language", () => {
    const result = PushCampaignCopySetSchema.safeParse([
      ENGLISH,
      { ...ENGLISH, title: "Second" },
    ])
    expect(result.success).toBe(false)
  })

  it("rejects copy that is only whitespace", () => {
    expect(
      PushCampaignCopySetSchema.safeParse([{ ...ENGLISH, body: "   " }])
        .success,
    ).toBe(false)
  })

  it("trims the authored strings", () => {
    const parsed = PushCampaignCopySetSchema.parse([
      { ...ENGLISH, title: "  Hello  " },
    ])
    expect(parsed[0].title).toBe("Hello")
  })
})

describe("push destination contract", () => {
  it.each(["VIDEO", "SERIES", "EXPERIENCE"] as const)(
    "accepts the %s kind",
    (kind) => {
      expect(PushDestinationInputSchema.parse({ kind, slug: "jesus" })).toEqual(
        { kind, slug: "jesus" },
      )
    },
  )

  it("rejects a kind outside the catalog", () => {
    expect(
      PushDestinationInputSchema.safeParse({ kind: "PODCAST", slug: "jesus" })
        .success,
    ).toBe(false)
  })

  it("rejects an empty slug", () => {
    expect(
      PushDestinationInputSchema.safeParse({ kind: "VIDEO", slug: " " })
        .success,
    ).toBe(false)
  })
})

describe("push audience contract", () => {
  it("accepts everywhere with no countries", () => {
    expect(PushAudienceInputSchema.parse({ scope: "EVERYWHERE" })).toEqual({
      scope: "EVERYWHERE",
      countries: [],
      languageFilter: [],
    })
  })

  it("rejects everywhere that also names countries", () => {
    expect(
      PushAudienceInputSchema.safeParse({
        scope: "EVERYWHERE",
        countries: ["SA"],
      }).success,
    ).toBe(false)
  })

  it("rejects a country scope with no country", () => {
    expect(
      PushAudienceInputSchema.safeParse({ scope: "COUNTRIES", countries: [] })
        .success,
    ).toBe(false)
  })

  it("uppercases and de-duplicates the country list", () => {
    expect(
      PushAudienceInputSchema.parse({
        scope: "COUNTRIES",
        countries: ["sa", "SA", "nz"],
      }).countries,
    ).toEqual(["SA", "NZ"])
  })

  it("rejects a country code that is not two letters", () => {
    expect(
      PushAudienceInputSchema.safeParse({
        scope: "COUNTRIES",
        countries: ["SAU"],
      }).success,
    ).toBe(false)
  })

  it("rejects more countries than the row can hold", () => {
    expect(
      PushAudienceInputSchema.safeParse({
        scope: "COUNTRIES",
        countries: Array.from(
          { length: PUSH_MAX_AUDIENCE_COUNTRIES + 1 },
          (_, index) => `C${index}`,
        ),
      }).success,
    ).toBe(false)
  })

  it("keeps a declared language filter", () => {
    expect(
      PushAudienceInputSchema.parse({
        scope: "COUNTRIES",
        countries: ["SA"],
        languageFilter: ["arabic", "arabic"],
      }).languageFilter,
    ).toEqual(["arabic"])
  })
})

describe("push schedule contract", () => {
  it("accepts a date and an hour inside the day", () => {
    expect(
      PushScheduleInputSchema.parse({ sendDate: "2026-10-01", localHour: 9 }),
    ).toEqual({ sendDate: "2026-10-01", localHour: 9 })
  })

  it.each([-1, 24, 9.5])("rejects the local hour %s", (localHour) => {
    expect(
      PushScheduleInputSchema.safeParse({ sendDate: "2026-10-01", localHour })
        .success,
    ).toBe(false)
  })

  it("rejects a date that is not a real day", () => {
    expect(
      PushScheduleInputSchema.safeParse({
        sendDate: "2026-02-30",
        localHour: 9,
      }).success,
    ).toBe(false)
  })

  it("rejects a date that is not in year-month-day order", () => {
    expect(
      PushScheduleInputSchema.safeParse({
        sendDate: "01-10-2026",
        localHour: 9,
      }).success,
    ).toBe(false)
  })
})

describe("expo push token shape", () => {
  it.each([
    "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "F9E7C2A1-1111-2222-3333-444455556666",
  ])("recognises %s as a push token", (token) => {
    expect(isExpoPushTokenShape(token)).toBe(true)
  })

  it.each([
    "cl9x8k2p0000qwertyuiopas",
    "ExponentPushToken[]",
    "ExponentPushToken[abc",
    "",
    "   ",
  ])("does not recognise %s as a push token", (value) => {
    expect(isExpoPushTokenShape(value)).toBe(false)
  })
})

describe("push test device contracts", () => {
  it("accepts a lowercase identifier", () => {
    expect(PushTestDeviceIdSchema.parse("cl9x8k2p0000qwertyuiopas")).toBe(
      "cl9x8k2p0000qwertyuiopas",
    )
  })

  it("trims the pasted identifier", () => {
    expect(PushTestDeviceIdSchema.parse("  cl9x8k2p0000qwe  ")).toBe(
      "cl9x8k2p0000qwe",
    )
  })

  it.each([
    "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "F9E7C2A1-1111-2222-3333-444455556666",
    "short",
    "HAS-UPPERCASE-AND-DASHES",
  ])("rejects %s as a test ID", (value) => {
    expect(PushTestDeviceIdSchema.safeParse(value).success).toBe(false)
  })

  it("requires a label with the identifier", () => {
    expect(
      PushTestDeviceAddInputSchema.parse({
        testDeviceId: "cl9x8k2p0000qwertyuiopas",
        label: "  Urim iPhone  ",
      }),
    ).toEqual({
      testDeviceId: "cl9x8k2p0000qwertyuiopas",
      label: "Urim iPhone",
    })
  })

  it("rejects an empty label", () => {
    expect(
      PushTestDeviceAddInputSchema.safeParse({
        testDeviceId: "cl9x8k2p0000qwertyuiopas",
        label: "   ",
      }).success,
    ).toBe(false)
  })
})
