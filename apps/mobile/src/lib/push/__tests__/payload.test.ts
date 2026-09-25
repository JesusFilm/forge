/**
 * The pure payload layer (R2). Admin validates every field and answers
 * BAD_USER_INPUT for a shape it does not like, which would lose the whole
 * registration, so each normalizer is pinned against admin's own bounds in
 * `apps/admin/src/services/push/contracts.ts`.
 */

import {
  PUSH_DEFAULT_APP_LANGUAGE_SLUG,
  PUSH_DEFAULT_PHONE_LOCALE,
  PUSH_DEFAULT_TIME_ZONE,
} from "../constants"
import {
  buildPushRegistrationPayload,
  hashPushRegistrationPayload,
  normalizeAppBuild,
  normalizePhoneLocale,
  normalizeTimeZone,
  resolveAppBuild,
} from "../payload"

/** Admin's own regex for a phone locale, copied so a drift shows up here. */
const ADMIN_BCP47 = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/

/** A UUID, the shape the store mints. Inside admin's 8-to-64 bound. */
const INSTALL_ID = "3f2a9c10-5b6d-4e71-8a02-9c3d4e5f6071"

const ENVIRONMENT = {
  platform: "IOS" as const,
  appBuild: "1.0.0+42",
  phoneLocale: "en-US",
  timeZone: "Pacific/Auckland",
}

describe("normalizePhoneLocale", () => {
  it("keeps an ordinary language-region tag", () => {
    expect(normalizePhoneLocale("en-US")).toBe("en-US")
    expect(normalizePhoneLocale("ar")).toBe("ar")
    expect(normalizePhoneLocale("zh-Hant-TW")).toBe("zh-Hant-TW")
  })

  it("drops a Unicode extension, which the tag does not need", () => {
    // iOS reports a calendar or numbering extension for some regions. Admin's
    // language resolution reads the language subtag and the region, never these.
    expect(normalizePhoneLocale("ar-SA-u-ca-islamic-nu-arab")).toBe("ar-SA")
    expect(normalizePhoneLocale("en-US-x-private")).toBe("en-US")
    expect(normalizePhoneLocale("en-t-de")).toBe("en")
  })

  it("falls back to the default for a shape admin would refuse", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "   ",
      "e",
      "en_US",
      "123",
      "toolongsubtag-US",
    ]) {
      expect(normalizePhoneLocale(raw)).toBe(PUSH_DEFAULT_PHONE_LOCALE)
    }
  })

  it("never answers a tag admin's own regex would refuse", () => {
    for (const raw of [
      "en-US",
      "ar-SA-u-ca-islamic",
      "en_US",
      "",
      "zh-Hant-TW",
      "de-DE-1996",
      "x-klingon",
      `en-${"a".repeat(40)}`,
    ]) {
      const tag = normalizePhoneLocale(raw)
      expect(tag).toMatch(ADMIN_BCP47)
      expect(tag.length).toBeLessThanOrEqual(35)
    }
  })

  it("trims a tag past admin's 35-character column by whole subtags", () => {
    const long = `en-Latn-US-${"abcdefgh-".repeat(6)}zz`
    expect(normalizePhoneLocale(long)).toBe("en-Latn-US-abcdefgh-abcdefgh")
  })
})

describe("normalizeTimeZone", () => {
  it("keeps an IANA name", () => {
    expect(normalizeTimeZone("Pacific/Auckland")).toBe("Pacific/Auckland")
    expect(normalizeTimeZone(" Asia/Riyadh ")).toBe("Asia/Riyadh")
  })

  it("falls back to UTC for anything unusable", () => {
    for (const raw of [null, undefined, "", "  ", "z".repeat(65)]) {
      expect(normalizeTimeZone(raw)).toBe(PUSH_DEFAULT_TIME_ZONE)
    }
  })
})

describe("resolveAppBuild", () => {
  it("joins the version and the platform build number", () => {
    expect(resolveAppBuild("1.0.0", "42")).toBe("1.0.0+42")
    expect(resolveAppBuild("1.0.0", 42)).toBe("1.0.0+42")
  })

  it("sends the version alone when no build number is configured", () => {
    // A development bundle has no remote build number: EAS resolves it only for
    // a real build, so this is the ordinary local shape.
    expect(resolveAppBuild("1.0.0", null)).toBe("1.0.0")
    expect(resolveAppBuild("1.0.0", undefined)).toBe("1.0.0")
  })

  it("normalizes an unusable pair rather than sending nothing", () => {
    expect(resolveAppBuild(null, null)).toBe("unknown")
    expect(normalizeAppBuild("")).toBe("unknown")
    expect(normalizeAppBuild("v".repeat(80))).toHaveLength(64)
  })
})

describe("buildPushRegistrationPayload", () => {
  it("carries every field R2 names, with no viewer handle by default", () => {
    const payload = buildPushRegistrationPayload({
      expoPushToken: "ExponentPushToken[abc]",
      installId: INSTALL_ID,
      permission: "granted",
      appLanguageSlug: "arabic",
      identity: null,
      environment: ENVIRONMENT,
    })

    expect(payload).toEqual({
      expoPushToken: "ExponentPushToken[abc]",
      installId: INSTALL_ID,
      platform: "IOS",
      appBuild: "1.0.0+42",
      appLanguageSlug: "arabic",
      phoneLocale: "en-US",
      timeZone: "Pacific/Auckland",
      permission: "granted",
    })
    expect("viewerToken" in payload).toBe(false)
    expect("sessionToken" in payload).toBe(false)
  })

  it("sends both halves of the viewer handle, never one (admin refuses one)", () => {
    const payload = buildPushRegistrationPayload({
      expoPushToken: "ExponentPushToken[abc]",
      installId: INSTALL_ID,
      permission: "granted",
      appLanguageSlug: "english",
      identity: { viewerToken: "viewer-1", sessionToken: "session-1" },
      environment: ENVIRONMENT,
    })

    expect(payload.viewerToken).toBe("viewer-1")
    expect(payload.sessionToken).toBe("session-1")
  })

  it("falls back to the default language slug when the viewer picked none", () => {
    const payload = buildPushRegistrationPayload({
      expoPushToken: "ExponentPushToken[abc]",
      installId: INSTALL_ID,
      permission: "granted",
      appLanguageSlug: null,
      identity: null,
      environment: ENVIRONMENT,
    })

    expect(payload.appLanguageSlug).toBe(PUSH_DEFAULT_APP_LANGUAGE_SLUG)
  })

  it("normalizes a slug admin would refuse", () => {
    // Admin allows no spaces in a slug and caps it at 191 characters.
    const payload = buildPushRegistrationPayload({
      expoPushToken: "ExponentPushToken[abc]",
      installId: INSTALL_ID,
      permission: "granted",
      appLanguageSlug: "  korean  ",
      identity: null,
      environment: ENVIRONMENT,
    })

    expect(payload.appLanguageSlug).toBe("korean")
    expect(
      buildPushRegistrationPayload({
        expoPushToken: "ExponentPushToken[abc]",
        installId: INSTALL_ID,
        permission: "granted",
        appLanguageSlug: "two words",
        identity: null,
        environment: ENVIRONMENT,
      }).appLanguageSlug,
    ).toBe(PUSH_DEFAULT_APP_LANGUAGE_SLUG)
  })
})

describe("hashPushRegistrationPayload", () => {
  const base = buildPushRegistrationPayload({
    expoPushToken: "ExponentPushToken[abc]",
    installId: INSTALL_ID,
    permission: "granted",
    appLanguageSlug: "english",
    identity: null,
    environment: ENVIRONMENT,
  })

  it("is stable for the same payload", () => {
    expect(hashPushRegistrationPayload(base)).toBe(
      hashPushRegistrationPayload(base),
    )
  })

  it("changes when any field R3 watches changes", () => {
    const variants = [
      { ...base, expoPushToken: "ExponentPushToken[xyz]" },
      // A re-installed app mints a new id, and admin must read that as a new
      // registration rather than let the stored key skip the call.
      { ...base, installId: "8c1d0e2f-3a4b-4c5d-9e6f-70a1b2c3d4e5" },
      { ...base, platform: "ANDROID" as const },
      { ...base, appBuild: "1.0.1+43" },
      { ...base, appLanguageSlug: "arabic" },
      { ...base, phoneLocale: "fr-FR" },
      { ...base, timeZone: "Europe/Paris" },
      { ...base, permission: "denied" as const },
      { ...base, viewerToken: "viewer-1", sessionToken: "session-1" },
    ]

    const hashes = variants.map(hashPushRegistrationPayload)
    expect(new Set([...hashes, hashPushRegistrationPayload(base)]).size).toBe(
      variants.length + 1,
    )
  })

  it("carries no token or handle in the hash itself", () => {
    // The hash is persisted; the token and the handle never are.
    const hash = hashPushRegistrationPayload({
      ...base,
      viewerToken: "viewer-1",
      sessionToken: "session-1",
    })

    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(hash).not.toContain("Exponent")
    expect(hash).not.toContain("viewer-1")
  })
})
