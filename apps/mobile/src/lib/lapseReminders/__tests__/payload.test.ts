import { watchSlugFromUrl } from "../../deepLinkOrigin"
import {
  LAPSE_REMINDER_KINDS,
  LAPSE_REMINDER_PAYLOAD_VERSION,
} from "../constants"
import {
  LAPSE_REMINDER_HOME_TARGET,
  LAPSE_REMINDER_MAX_PAYLOAD_BYTES,
  LAPSE_REMINDER_MAX_SLUG_LENGTH,
  LAPSE_REMINDER_PARSE_REASONS,
  buildLapseReminderPayload,
  parseLapseReminderPayload,
} from "../payload"

/** A payload built by hand, the way an untrusted one arrives from the OS. */
function payload(target: string, overrides: Record<string, unknown> = {}) {
  return {
    version: LAPSE_REMINDER_PAYLOAD_VERSION,
    kind: "day1",
    target,
    ...overrides,
  }
}

function watchUrl(slug: string): string {
  return `forgemobile://watch/${slug}`
}

describe("buildLapseReminderPayload", () => {
  it.each(LAPSE_REMINDER_KINDS)(
    "round-trips kind, target and version for %s",
    (kind) => {
      const built = buildLapseReminderPayload(kind, {
        slug: "the-birth-of-jesus",
      })

      expect(built.version).toBe(LAPSE_REMINDER_PAYLOAD_VERSION)
      expect(built.kind).toBe(kind)
      expect(parseLapseReminderPayload(built)).toEqual({
        ok: true,
        kind,
        slug: "the-birth-of-jesus",
      })
    },
  )

  it("carries exactly the three fields KTD4 allows", () => {
    const built = buildLapseReminderPayload("day1", {
      slug: "the-birth-of-jesus",
    })

    expect(Object.keys(built).sort()).toEqual(["kind", "target", "version"])
  })

  it("yields the same slug through the real deep-link parser", () => {
    // The integration that stops the two halves drifting: no mock, the parser
    // the app's own deep links already run through.
    const built = buildLapseReminderPayload("day1", {
      slug: "one.jesusfilm.ourlovingpursuer",
    })

    expect(watchSlugFromUrl(built.target)).toBe(
      "one.jesusfilm.ourlovingpursuer",
    )
  })

  it.each([
    "jesus",
    "the-birth-of-jesus",
    "1_jf-0-0",
    "2_GOJ-0-0",
    "one.jesusfilm.ourlovingpursuer",
    "a~b",
  ])("round-trips the real slug shape %s through both parsers", (slug) => {
    const built = buildLapseReminderPayload("day7", { slug })

    expect(watchSlugFromUrl(built.target)).toBe(slug)
    expect(parseLapseReminderPayload(built)).toEqual({
      ok: true,
      kind: "day7",
      slug,
    })
  })

  it("writes the Home marker when there is no record", () => {
    const built = buildLapseReminderPayload("day1", null)

    expect(built.target).toBe(LAPSE_REMINDER_HOME_TARGET)
    expect(parseLapseReminderPayload(built)).toEqual({
      ok: true,
      kind: "day1",
      slug: null,
    })
  })

  it.each([
    ["a slash", "series/episode-1"],
    ["a traversal", ".."],
    ["a bare dot", "."],
    ["whitespace", "the birth"],
    ["a scheme", "javascript:alert(1)"],
    ["an empty string", ""],
    ["an over-long slug", "a".repeat(LAPSE_REMINDER_MAX_SLUG_LENGTH + 1)],
  ])(
    "falls back to Home for a record whose slug carries %s",
    (_label, slug) => {
      // A payload this builder emits must always parse. Emitting a slug the
      // parser rejects would schedule a reminder whose tap silently lands on Home
      // and logs a fault nobody caused.
      const built = buildLapseReminderPayload("day1", { slug })

      expect(built.target).toBe(LAPSE_REMINDER_HOME_TARGET)
      expect(parseLapseReminderPayload(built)).toEqual({
        ok: true,
        kind: "day1",
        slug: null,
      })
    },
  )

  it("keeps a slug at the length limit", () => {
    // Anti-vacuous companion to the over-long case above: the boundary itself
    // must still reach the watch screen.
    const slug = "a".repeat(LAPSE_REMINDER_MAX_SLUG_LENGTH)
    const built = buildLapseReminderPayload("day1", { slug })

    expect(built.target).toBe(watchUrl(slug))
    expect(parseLapseReminderPayload(built)).toEqual({
      ok: true,
      kind: "day1",
      slug,
    })
  })

  it("stays well under the size cap for the longest slug it will emit", () => {
    const built = buildLapseReminderPayload("day7", {
      slug: "a".repeat(LAPSE_REMINDER_MAX_SLUG_LENGTH),
    })

    expect(JSON.stringify(built).length).toBeLessThan(
      LAPSE_REMINDER_MAX_PAYLOAD_BYTES,
    )
  })
})

describe("parseLapseReminderPayload", () => {
  it("accepts the Home marker", () => {
    expect(
      parseLapseReminderPayload(payload(LAPSE_REMINDER_HOME_TARGET)),
    ).toEqual({ ok: true, kind: "day1", slug: null })
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "day1"],
    ["a number", 7],
    ["an array", [{ version: 1, kind: "day1", target: "home" }]],
  ])("rejects %s as not an object", (_label, data) => {
    expect(parseLapseReminderPayload(data)).toEqual({
      ok: false,
      reason: "not_an_object",
    })
  })

  it.each([
    ["a higher version", LAPSE_REMINDER_PAYLOAD_VERSION + 1],
    ["a lower version", LAPSE_REMINDER_PAYLOAD_VERSION - 1],
    ["a missing version", undefined],
    ["a string version", String(LAPSE_REMINDER_PAYLOAD_VERSION)],
  ])("rejects %s", (_label, version) => {
    expect(
      parseLapseReminderPayload(
        payload(LAPSE_REMINDER_HOME_TARGET, { version }),
      ),
    ).toEqual({ ok: false, reason: "version_mismatch" })
  })

  it.each([
    ["a missing kind", undefined],
    ["an empty kind", ""],
    ["an unknown kind", "day30"],
    ["a non-string kind", 1],
  ])("rejects %s", (_label, kind) => {
    expect(
      parseLapseReminderPayload(payload(LAPSE_REMINDER_HOME_TARGET, { kind })),
    ).toEqual({ ok: false, reason: "unknown_kind" })
  })

  it.each([
    ["a missing target", undefined],
    ["a non-string target", 1],
    ["an empty target", ""],
    ["a query string", `${watchUrl("jesus")}?lang=en`],
    ["a fragment", `${watchUrl("jesus")}#t=10`],
    ["a trailing path segment", `${watchUrl("jesus")}/english`],
    ["a trailing slash", `${watchUrl("jesus")}/`],
    ["no slug at all", "forgemobile://watch/"],
    ["another route", "forgemobile://series/jesus"],
    ["another scheme", "https://www.jesusfilm.org/watch/jesus.html"],
    ["a scheme-relative host", "//evil.example.com/watch/jesus"],
    ["a javascript scheme", "javascript:alert(1)"],
    ["a different case in the scheme", "FORGEMOBILE://watch/jesus"],
    ["a bare slug", "jesus"],
  ])("rejects %s as a malformed target", (_label, target) => {
    expect(
      parseLapseReminderPayload(
        payload(LAPSE_REMINDER_HOME_TARGET, { target }),
      ),
    ).toEqual({ ok: false, reason: "malformed_target" })
  })

  it.each([
    ["an encoded slash", watchUrl("series%2Fepisode-1")],
    ["an encoded traversal", watchUrl("%2e%2e")],
    ["a bare traversal", watchUrl("..")],
    ["a bare dot", watchUrl(".")],
    ["encoded whitespace", watchUrl("the%20birth")],
    ["a colon", watchUrl("javascript:alert(1)")],
    ["an encoded colon", watchUrl(encodeURIComponent("javascript:alert(1)"))],
    ["a percent sign", watchUrl("100%25")],
    ["a stray percent", watchUrl("a%zz")],
    ["a reserved character", watchUrl("a&b")],
    [
      "more than the length limit",
      watchUrl("a".repeat(LAPSE_REMINDER_MAX_SLUG_LENGTH + 1)),
    ],
  ])("rejects %s as an invalid slug", (_label, target) => {
    expect(
      parseLapseReminderPayload(
        payload(LAPSE_REMINDER_HOME_TARGET, { target }),
      ),
    ).toEqual({ ok: false, reason: "invalid_slug" })
  })

  it("accepts a slug of exactly the length limit", () => {
    const slug = "a".repeat(LAPSE_REMINDER_MAX_SLUG_LENGTH)

    expect(parseLapseReminderPayload(payload(watchUrl(slug)))).toEqual({
      ok: true,
      kind: "day1",
      slug,
    })
  })

  it("measures the size cap in bytes, not in characters", () => {
    // 400 three-byte characters are 400 characters and about 1,260 bytes, so a
    // character-denominated cap would admit them. 900 ASCII characters are
    // about 960 bytes, so they pass the size gate and fail on the slug rule.
    // The pair is what pins the unit.
    const wide = payload(`forgemobile://watch/${"あ".repeat(400)}`)
    const narrow = payload(watchUrl("a".repeat(900)))

    expect(JSON.stringify(wide).length).toBeLessThan(
      LAPSE_REMINDER_MAX_PAYLOAD_BYTES,
    )
    expect(parseLapseReminderPayload(wide)).toEqual({
      ok: false,
      reason: "too_large",
    })
    expect(parseLapseReminderPayload(narrow)).toEqual({
      ok: false,
      reason: "invalid_slug",
    })
  })

  it("rejects an oversized payload before it looks at anything else", () => {
    // The size gate runs first, so a megabyte of junk never reaches a regex.
    const huge = payload(watchUrl("a".repeat(5000)), {
      version: LAPSE_REMINDER_PAYLOAD_VERSION + 1,
      kind: "day30",
    })

    expect(parseLapseReminderPayload(huge)).toEqual({
      ok: false,
      reason: "too_large",
    })
  })

  it("rejects a payload padded with extra fields past the cap", () => {
    const padded = payload(LAPSE_REMINDER_HOME_TARGET, {
      note: "x".repeat(LAPSE_REMINDER_MAX_PAYLOAD_BYTES),
    })

    expect(parseLapseReminderPayload(padded)).toEqual({
      ok: false,
      reason: "too_large",
    })
  })

  it("tolerates a payload that cannot serialize", () => {
    // A circular object is not a payload this app writes, but the parser reads
    // whatever the OS hands back and must never throw into the tap handler.
    const circular: Record<string, unknown> = payload(
      LAPSE_REMINDER_HOME_TARGET,
    )
    circular.self = circular

    expect(parseLapseReminderPayload(circular)).toEqual({
      ok: false,
      reason: "too_large",
    })
  })

  it("ignores extra fields that stay under the cap", () => {
    // The OS adds its own keys to a notification's data on both platforms, so
    // an unknown key is not a fault.
    expect(
      parseLapseReminderPayload(
        payload(watchUrl("jesus"), { experienceId: "abc" }),
      ),
    ).toEqual({ ok: true, kind: "day1", slug: "jesus" })
  })

  it("returns only reasons from the fixed set", () => {
    // KTD9 logs the reason as a facet, so an unlisted one would split the
    // dashboard silently.
    const rejected = [
      null,
      payload(LAPSE_REMINDER_HOME_TARGET, { version: 99 }),
      payload(LAPSE_REMINDER_HOME_TARGET, { kind: "day30" }),
      payload("javascript:alert(1)"),
      payload(watchUrl("..")),
      payload(watchUrl("a".repeat(5000))),
    ].map((data) => parseLapseReminderPayload(data))

    expect(rejected).toHaveLength(6)
    for (const result of rejected) {
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("unreachable")
      expect(LAPSE_REMINDER_PARSE_REASONS).toContain(result.reason)
    }
    // Anti-vacuous: every reason in the set is reachable from the cases above,
    // so the set carries no dead member.
    expect(
      new Set(rejected.map((result) => (result.ok ? null : result.reason))),
    ).toEqual(new Set(LAPSE_REMINDER_PARSE_REASONS))
  })
})
