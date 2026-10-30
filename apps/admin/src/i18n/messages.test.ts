import { describe, expect, it } from "vitest"

import { adminMessages, supportedAdminLocales } from "./messages"

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix]
  }
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe("admin messages", () => {
  it("carries the same nav keys in every supported locale", () => {
    const english = keyPaths(adminMessages.en.nav).sort()
    for (const locale of supportedAdminLocales) {
      expect(keyPaths(adminMessages[locale].nav).sort()).toEqual(english)
    }
  })

  it("names the push-campaigns nav entry in en and es", () => {
    expect(adminMessages.en.nav.items.pushCampaigns.label).toBe(
      "Push campaigns",
    )
    expect(adminMessages.es.nav.items.pushCampaigns.label).toBe("Campanas push")
  })

  it("carries every push-campaigns page string, including both report splits", () => {
    const page = adminMessages.en.pages.pushCampaigns
    expect(page.newCampaign.length).toBeGreaterThan(0)
    expect(page.emptyDescription).toContain("New campaign")
    expect(page.workerStale).toContain("stale")
    expect(page.flagOffDescription).toContain("PUSH_CAMPAIGNS_ENABLED")
    expect(page.editor.frozenNotice).toContain("frozen")
    expect(page.report.byLanguage.length).toBeGreaterThan(0)
    expect(page.report.byCountry.length).toBeGreaterThan(0)
    // R25 — every column the report shows has a label.
    for (const column of [
      "audience",
      "accepted",
      "handedOff",
      "unknown",
      "pending",
      "failed",
      "invalid",
      "suppressed",
      "unreachable",
      "missed",
      "opened",
      "attributed",
      "attributedWatchStarts",
    ] as const) {
      expect(page.report.columns[column].length).toBeGreaterThan(0)
    }
  })

  it("mirrors the page dictionary into es, which the module builds by copy", () => {
    expect(keyPaths(adminMessages.es.pages.pushCampaigns).sort()).toEqual(
      keyPaths(adminMessages.en.pages.pushCampaigns).sort(),
    )
  })
})
