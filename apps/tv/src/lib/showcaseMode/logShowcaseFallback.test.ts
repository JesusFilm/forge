import {
  logShowcaseFallback,
  logShowcaseParseDrops,
} from "./logShowcaseFallback"
import { datadogLog } from "../datadog"

jest.mock("../datadog", () => ({
  datadogLog: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

const warn = datadogLog.warn as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe("logShowcaseFallback", () => {
  it("emits the reason as a first-class context attribute", () => {
    logShowcaseFallback({ reason: "experience-absent" })
    expect(warn).toHaveBeenCalledWith("showcase_fallback", {
      reason: "experience-absent",
    })
  })
})

describe("logShowcaseParseDrops", () => {
  it("is a no-op when nothing was dropped", () => {
    logShowcaseParseDrops({ items: 0, chapters: 0 })
    expect(warn).not.toHaveBeenCalled()
  })

  it("warns when only items were dropped", () => {
    logShowcaseParseDrops({ items: 2, chapters: 0 })
    expect(warn).toHaveBeenCalledWith("showcase_experience_drops", {
      dropped_items: 2,
      dropped_chapters: 0,
    })
  })

  it("warns when only chapters were dropped", () => {
    logShowcaseParseDrops({ items: 0, chapters: 1 })
    expect(warn).toHaveBeenCalledWith("showcase_experience_drops", {
      dropped_items: 0,
      dropped_chapters: 1,
    })
  })
})
