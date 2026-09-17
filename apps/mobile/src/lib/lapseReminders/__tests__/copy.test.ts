import {
  LAPSE_REMINDER_COPY,
  LAPSE_REMINDER_COPY_TITLED,
  LAPSE_REMINDER_KINDS,
  LAPSE_REMINDER_TITLE_TOKEN,
} from "../constants"
import { lapseReminderBody } from "../copy"

describe("lapseReminderBody", () => {
  it("names the video when the record carries a title", () => {
    expect(lapseReminderBody("day1", "The Birth of Jesus")).toBe(
      "Continue watching The Birth of Jesus.",
    )
    expect(lapseReminderBody("day7", "The Birth of Jesus")).toBe(
      "The Birth of Jesus is still here whenever you are ready.",
    )
  })

  it("falls back to the untitled copy for a record written before titles", () => {
    for (const kind of LAPSE_REMINDER_KINDS) {
      expect(lapseReminderBody(kind, null)).toBe(LAPSE_REMINDER_COPY[kind])
    }
  })

  it("treats a blank or whitespace title as no title", () => {
    expect(lapseReminderBody("day1", "")).toBe(LAPSE_REMINDER_COPY.day1)
    expect(lapseReminderBody("day1", "   ")).toBe(LAPSE_REMINDER_COPY.day1)
  })

  it("leaves no unsubstituted token in any titled string", () => {
    for (const kind of LAPSE_REMINDER_KINDS) {
      expect(lapseReminderBody(kind, "A Title")).not.toContain(
        LAPSE_REMINDER_TITLE_TOKEN,
      )
    }
  })

  it("keeps every titled string carrying the token it substitutes", () => {
    // Anti-vacuous: without this, dropping the token from a titled string
    // would make the test above pass while the title never appears.
    for (const kind of LAPSE_REMINDER_KINDS) {
      expect(LAPSE_REMINDER_COPY_TITLED[kind]).toContain(
        LAPSE_REMINDER_TITLE_TOKEN,
      )
    }
  })

  it("does not let a title containing the token re-expand", () => {
    expect(lapseReminderBody("day1", "{title}")).toBe(
      "Continue watching {title}.",
    )
  })
})
