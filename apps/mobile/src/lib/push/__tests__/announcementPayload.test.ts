/**
 * The announcement payload contract (R20, R21, KTD9, KTD14). Admin builds it
 * and the OS hands it back as untrusted data, so every field is validated on
 * the way in and the parser never throws.
 */

import { LAPSE_REMINDER_PAYLOAD_VERSION } from "../../lapseReminders/constants"
import { buildLapseReminderPayload } from "../../lapseReminders/payload"
import {
  PUSH_ANNOUNCEMENT_FAMILY,
  PUSH_ANNOUNCEMENT_KINDS,
  PUSH_ANNOUNCEMENT_MAX_NONCE_LENGTH,
  PUSH_ANNOUNCEMENT_MAX_PAYLOAD_BYTES,
  PUSH_ANNOUNCEMENT_MAX_SLUG_LENGTH,
  PUSH_ANNOUNCEMENT_PAYLOAD_VERSION,
  notificationFamily,
  parsePushAnnouncementPayload,
} from "../announcementPayload"

/** 32 random bytes base64url encoded, which is what admin mints (KTD14). */
const NONCE = "aBcD1234_-efGHijkLMNopQRstuVWXyz0123456789A"

function announcement(overrides: Record<string, unknown> = {}) {
  return {
    version: PUSH_ANNOUNCEMENT_PAYLOAD_VERSION,
    family: PUSH_ANNOUNCEMENT_FAMILY,
    kind: "video",
    slug: "the-birth-of-jesus",
    nonce: NONCE,
    ...overrides,
  }
}

describe("notificationFamily", () => {
  it("names the announcement family from the payload's own discriminator", () => {
    expect(notificationFamily(announcement())).toBe("announcement")
  })

  it.each(["day1", "day7"] as const)(
    "reads a %s reminder payload as the reminder family",
    (kind) => {
      const payload = buildLapseReminderPayload(kind, { slug: "jesus" })

      expect(notificationFamily(payload)).toBe("reminder")
    },
  )

  it("reads anything without the discriminator as the reminder family", () => {
    // The reminder contract predates this key, so "no family" MUST keep
    // meaning reminder: a payload written by an older build still routes.
    expect(notificationFamily(null)).toBe("reminder")
    expect(notificationFamily(undefined)).toBe("reminder")
    expect(notificationFamily("announcement")).toBe("reminder")
    expect(notificationFamily([PUSH_ANNOUNCEMENT_FAMILY])).toBe("reminder")
    expect(notificationFamily({ family: "campaign" })).toBe("reminder")
    expect(
      notificationFamily({ version: LAPSE_REMINDER_PAYLOAD_VERSION }),
    ).toBe("reminder")
  })
})

describe("parsePushAnnouncementPayload", () => {
  it.each(PUSH_ANNOUNCEMENT_KINDS)(
    "accepts the %s destination kind",
    (kind) => {
      expect(parsePushAnnouncementPayload(announcement({ kind }))).toEqual({
        ok: true,
        kind,
        slug: "the-birth-of-jesus",
        nonce: NONCE,
      })
    },
  )

  it("carries the nonce through unchanged and uninterpreted", () => {
    const parsed = parsePushAnnouncementPayload(announcement())

    expect(parsed.ok && parsed.nonce).toBe(NONCE)
  })

  it.each([null, undefined, "x", 7, [announcement()]])(
    "rejects %p as not an object",
    (data) => {
      expect(parsePushAnnouncementPayload(data)).toEqual({
        ok: false,
        reason: "not_an_object",
      })
    },
  )

  it("rejects a payload over the byte cap before any pattern runs", () => {
    const slug = "a".repeat(PUSH_ANNOUNCEMENT_MAX_PAYLOAD_BYTES)

    expect(parsePushAnnouncementPayload(announcement({ slug }))).toEqual({
      ok: false,
      reason: "too_large",
    })
  })

  it("counts the cap in BYTES, not characters", () => {
    // Well under the cap in CHARACTERS and well over it in bytes: a three-byte
    // script fills the cap in a third of the characters, so a character cap
    // would admit about three times the payload.
    const note = "あ".repeat(400)

    expect(note.length).toBeLessThan(PUSH_ANNOUNCEMENT_MAX_PAYLOAD_BYTES)
    expect(parsePushAnnouncementPayload(announcement({ note }))).toEqual({
      ok: false,
      reason: "too_large",
    })
  })

  it("rejects a version it does not know", () => {
    expect(
      parsePushAnnouncementPayload(
        announcement({ version: PUSH_ANNOUNCEMENT_PAYLOAD_VERSION + 1 }),
      ),
    ).toEqual({ ok: false, reason: "version_mismatch" })
  })

  it.each(["collection", "", null, 1, "VIDEO"])(
    "rejects the unknown destination kind %p (AE14)",
    (kind) => {
      expect(parsePushAnnouncementPayload(announcement({ kind }))).toEqual({
        ok: false,
        reason: "unknown_kind",
      })
    },
  )

  it.each(["", ".", "..", "a/b", "a?b", "a#b", "a b", 12, null])(
    "rejects the slug %p",
    (slug) => {
      expect(parsePushAnnouncementPayload(announcement({ slug }))).toEqual({
        ok: false,
        reason: "invalid_slug",
      })
    },
  )

  it("rejects a slug over the character bound", () => {
    const slug = "a".repeat(PUSH_ANNOUNCEMENT_MAX_SLUG_LENGTH + 1)

    expect(parsePushAnnouncementPayload(announcement({ slug }))).toEqual({
      ok: false,
      reason: "invalid_slug",
    })
  })

  it("accepts a slug exactly at the bound", () => {
    const slug = "a".repeat(PUSH_ANNOUNCEMENT_MAX_SLUG_LENGTH)

    expect(parsePushAnnouncementPayload(announcement({ slug }))).toMatchObject({
      ok: true,
      slug,
    })
  })

  it.each([
    "",
    "not base64url!",
    "a".repeat(PUSH_ANNOUNCEMENT_MAX_NONCE_LENGTH + 1),
    7,
    null,
  ])("rejects the campaign identifier %p", (nonce) => {
    expect(parsePushAnnouncementPayload(announcement({ nonce }))).toEqual({
      ok: false,
      reason: "invalid_nonce",
    })
  })

  it("never throws on a payload built to break a serializer", () => {
    const circular: Record<string, unknown> = announcement()
    circular.self = circular

    expect(parsePushAnnouncementPayload(circular)).toEqual({
      ok: false,
      reason: "too_large",
    })
  })

  it("rejects a reminder payload, which is the other family's contract", () => {
    // Reachable only by calling this parser directly: the dispatcher asks
    // `notificationFamily` first. Pinned so the two contracts cannot merge.
    const reminder = buildLapseReminderPayload("day1", { slug: "jesus" })

    expect(parsePushAnnouncementPayload(reminder).ok).toBe(false)
  })
})
