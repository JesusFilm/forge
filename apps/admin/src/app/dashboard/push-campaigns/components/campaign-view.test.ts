import { describe, expect, it } from "vitest"

import {
  formatPushAudience,
  formatPushCountry,
  formatPushDestination,
  formatPushSchedule,
  formatPushUtcDate,
  isPushCampaignCancellable,
  isPushCampaignDeletable,
  isPushCampaignFrozen,
  isPushCampaignTested,
  normalizePushCountryInput,
  pushCopyFieldError,
  pushStatusView,
} from "./campaign-view"

describe("isPushCampaignFrozen", () => {
  it("leaves draft and tested editable and freezes every later status (R11)", () => {
    expect(isPushCampaignFrozen("DRAFT")).toBe(false)
    expect(isPushCampaignFrozen("TESTED")).toBe(false)
    for (const status of [
      "SCHEDULED",
      "SENDING",
      "SENT",
      "PAUSED",
      "CANCELLED",
    ] as const) {
      expect(isPushCampaignFrozen(status)).toBe(true)
    }
  })
})

describe("isPushCampaignTested", () => {
  it("treats only a draft as untested (R10)", () => {
    expect(isPushCampaignTested("DRAFT")).toBe(false)
    expect(isPushCampaignTested("TESTED")).toBe(true)
    expect(isPushCampaignTested("SENDING")).toBe(true)
  })
})

describe("isPushCampaignCancellable", () => {
  it("offers cancel for scheduled and sending only (R11)", () => {
    expect(isPushCampaignCancellable("SCHEDULED")).toBe(true)
    expect(isPushCampaignCancellable("SENDING")).toBe(true)
    expect(isPushCampaignCancellable("TESTED")).toBe(false)
    expect(isPushCampaignCancellable("SENT")).toBe(false)
    expect(isPushCampaignCancellable("CANCELLED")).toBe(false)
  })
})

describe("pushStatusView", () => {
  it("names every status the campaign model carries", () => {
    for (const status of [
      "DRAFT",
      "TESTED",
      "SCHEDULED",
      "SENDING",
      "SENT",
      "PAUSED",
      "CANCELLED",
    ] as const) {
      expect(pushStatusView(status).label.length).toBeGreaterThan(0)
    }
    expect(pushStatusView("CANCELLED").tone).toBe("danger")
  })
})

describe("formatPushSchedule", () => {
  it("names the wave's day and local hour", () => {
    expect(
      formatPushSchedule({
        mode: "WAVE",
        sendDate: new Date("2026-10-01T00:00:00Z"),
        localHour: 9,
      }),
    ).toBe("2026-10-01 at 09:00 local")
  })

  it("names send-now everywhere for an immediate campaign", () => {
    expect(
      formatPushSchedule({
        mode: "IMMEDIATE",
        sendDate: null,
        localHour: null,
      }),
    ).toBe("Send now everywhere")
  })

  it("says not scheduled when no date is set", () => {
    expect(
      formatPushSchedule({ mode: "WAVE", sendDate: null, localHour: null }),
    ).toBe("Not scheduled")
  })
})

describe("formatPushAudience", () => {
  it("names everywhere, the country list, and the language filter", () => {
    expect(
      formatPushAudience({
        audienceScope: "EVERYWHERE",
        countries: [],
        languageFilter: [],
      }),
    ).toBe("Everywhere")
    expect(
      formatPushAudience({
        audienceScope: "COUNTRIES",
        countries: ["SA", "FR"],
        languageFilter: ["arabic"],
      }),
    ).toBe(
      "2 country/countries: Saudi Arabia (SA), France (FR) — languages: arabic",
    )
  })
})

describe("formatPushCountry", () => {
  it("puts the English name first and the code in brackets", () => {
    expect(formatPushCountry("MX")).toBe("Mexico (MX)")
    expect(formatPushCountry("SA")).toBe("Saudi Arabia (SA)")
  })

  it("keeps the bare code when Intl has no name or refuses the value", () => {
    expect(formatPushCountry("QQ")).toBe("QQ")
    expect(formatPushCountry("T1")).toBe("T1")
    expect(formatPushCountry("")).toBe("")
  })

  // Intl names UK and EU, but no phone stores either code, so a name would make
  // a target that reaches nobody look valid.
  it("keeps the bare code for an alias or a group code", () => {
    expect(formatPushCountry("UK")).toBe("UK")
    expect(formatPushCountry("EU")).toBe("EU")
  })
})

describe("isPushCampaignDeletable", () => {
  it("offers delete for every status except the two a cancel is for", () => {
    for (const status of [
      "DRAFT",
      "TESTED",
      "SENT",
      "PAUSED",
      "CANCELLED",
    ] as const) {
      expect(isPushCampaignDeletable(status)).toBe(true)
    }
    expect(isPushCampaignDeletable("SCHEDULED")).toBe(false)
    expect(isPushCampaignDeletable("SENDING")).toBe(false)
  })
})

describe("formatPushDestination", () => {
  it("says not chosen until both the kind and the slug are set (R7)", () => {
    expect(
      formatPushDestination({
        destinationKind: "SERIES",
        destinationSlug: null,
      }),
    ).toBe("Not chosen")
    expect(
      formatPushDestination({
        destinationKind: "SERIES",
        destinationSlug: "jesus",
      }),
    ).toBe("series / jesus")
  })
})

describe("formatPushUtcDate", () => {
  it("renders an em dash for a missing date", () => {
    expect(formatPushUtcDate(null)).toBe("—")
    expect(formatPushUtcDate(new Date("2026-10-01T09:30:00Z"))).toBe(
      "2026-10-01 09:30 UTC",
    )
  })
})

describe("pushCopyFieldError", () => {
  it("accepts a title at the 50-character cap and refuses 51", () => {
    expect(pushCopyFieldError("title", "x".repeat(50))).toBeNull()
    expect(pushCopyFieldError("title", "x".repeat(51))).toContain("51 of 50")
  })

  it("accepts a body at the 120-character cap and refuses 121", () => {
    expect(pushCopyFieldError("body", "x".repeat(120))).toBeNull()
    expect(pushCopyFieldError("body", "x".repeat(121))).toContain("121 of 120")
  })

  it("names a blank field, because the service requires both", () => {
    expect(pushCopyFieldError("title", "   ")).toBe("Write a title")
    expect(pushCopyFieldError("body", "")).toBe("Write a body")
  })

  it("measures the trimmed value, so trailing spaces are not an error", () => {
    expect(pushCopyFieldError("title", `${"x".repeat(50)}   `)).toBeNull()
  })
})

describe("normalizePushCountryInput", () => {
  it("upper-cases a two-letter code", () => {
    expect(normalizePushCountryInput("sa", [])).toEqual({ country: "SA" })
  })

  it("refuses anything that is not two letters", () => {
    expect(normalizePushCountryInput("SAU", [])).toHaveProperty("error")
    expect(normalizePushCountryInput("1A", [])).toHaveProperty("error")
    expect(normalizePushCountryInput("", [])).toHaveProperty("error")
  })

  it("refuses a repeat and names it", () => {
    const result = normalizePushCountryInput("fr", ["FR"])
    expect(result).toEqual({ error: "FR is already on the list." })
  })

  it("refuses an alias and names the ISO code to use", () => {
    expect(normalizePushCountryInput("uk", [])).toEqual({
      error: "UK is not an ISO country code. Use GB for United Kingdom.",
    })
  })

  it("refuses a code that names no country", () => {
    expect(normalizePushCountryInput("eu", [])).toEqual({
      error: "EU is not a country code that a phone reports.",
    })
  })

  it("accepts XK, which the edge reports for Kosovo", () => {
    expect(normalizePushCountryInput("xk", [])).toEqual({ country: "XK" })
  })
})
