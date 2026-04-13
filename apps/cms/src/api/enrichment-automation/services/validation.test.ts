import { describe, expect, it } from "vitest"

import {
  getAutomationValidationErrors,
  validateAutomationData,
} from "./validation"

const validAutomation = {
  name: "Missing subtitles",
  template: "target_subtitles_missing",
  status: "active",
  schedule: { kind: "every_minute", timezone: "UTC" },
  refreshMode: "missing_only",
  targetLanguageIds: ["529"],
  maxVideosPerRun: 1,
}

describe("validateAutomationData", () => {
  it("accepts a valid target subtitle automation", () => {
    expect(validateAutomationData(validAutomation)).toBe(true)
    expect(getAutomationValidationErrors(validAutomation)).toEqual([])
  })

  it("rejects malformed schedule shapes", () => {
    expect(
      getAutomationValidationErrors({
        ...validAutomation,
        schedule: { kind: "hourly", minute: 60, timezone: "UTC" },
      }),
    ).toContain("schedule.hourly.minute must be an integer from 0 to 59")
  })

  it("rejects invalid target language payloads for subtitle automations", () => {
    expect(
      getAutomationValidationErrors({
        ...validAutomation,
        targetLanguageIds: ["529", "6414"],
      }),
    ).toContain("target_subtitles_missing requires exactly one target language")

    expect(
      getAutomationValidationErrors({
        ...validAutomation,
        targetLanguageIds: "529",
      }),
    ).toContain("targetLanguageIds must be an array of strings")
  })
})
