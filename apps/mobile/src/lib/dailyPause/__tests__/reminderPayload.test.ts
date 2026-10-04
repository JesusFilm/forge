/**
 * The daily-pause reminder payload (KTD13). The app writes it, and the OS hands
 * it back on a tap, so the tap reads it as untrusted data.
 */

import { buildLapseReminderPayload } from "../../lapseReminders/payload"
import { notificationFamily } from "../../push/announcementPayload"
import {
  buildDailyPauseReminderPayload,
  parseDailyPauseReminderPayload,
} from "../reminderPayload"

describe("buildDailyPauseReminderPayload", () => {
  it("writes the wire shape as literals", () => {
    // A pending reminder keeps the payload it was scheduled with across an
    // update, so the literals are pinned here and not read from the module.
    expect(buildDailyPauseReminderPayload()).toEqual({
      version: 1,
      family: "daily-pause",
    })
  })

  it("writes a payload that parses back", () => {
    expect(
      parseDailyPauseReminderPayload(buildDailyPauseReminderPayload()),
    ).toEqual({ ok: true })
  })

  it("carries the family that the tap dispatches before the lapse branch", () => {
    expect(notificationFamily(buildDailyPauseReminderPayload())).toBe(
      "daily-pause",
    )
  })
})

describe("parseDailyPauseReminderPayload", () => {
  it.each([
    ["not_an_object", null],
    ["not_an_object", "daily-pause"],
    ["not_an_object", [{ version: 1, family: "daily-pause" }]],
    ["wrong_family", { version: 1 }],
    ["wrong_family", { version: 1, family: "announcement" }],
    ["version_mismatch", { version: 2, family: "daily-pause" }],
    ["version_mismatch", { family: "daily-pause" }],
  ])("rejects a payload for %s", (reason, data) => {
    expect(parseDailyPauseReminderPayload(data)).toEqual({ ok: false, reason })
  })

  it("rejects a lapse reminder payload, which is the other contract", () => {
    const lapse = buildLapseReminderPayload("day1", { slug: "jesus" })

    expect(parseDailyPauseReminderPayload(lapse)).toEqual({
      ok: false,
      reason: "wrong_family",
    })
  })
})
