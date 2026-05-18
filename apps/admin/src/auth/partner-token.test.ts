import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  PARTNER_KEY_ID_LENGTH,
  PARTNER_TOKEN_PREFIX,
  generatePartnerToken,
  hashRawToken,
  parsePartnerToken,
  timingSafeEqualHex,
} from "@/auth/partner-token"

describe("partner-token", () => {
  describe("generatePartnerToken", () => {
    it("produces a token in the jfp_search_<keyId>_<random> shape", () => {
      const { keyId, rawToken, keyHash } = generatePartnerToken()
      expect(rawToken.startsWith(PARTNER_TOKEN_PREFIX)).toBe(true)
      expect(rawToken).toMatch(/^jfp_search_[A-Za-z2-9]{12}_[A-Za-z0-9_-]{43}$/)
      expect(keyId).toHaveLength(PARTNER_KEY_ID_LENGTH)
      // keyId is in the alphabet (no _, no 0/O/I/l/1).
      expect(keyId).toMatch(/^[A-Za-z2-9]+$/)
      expect(keyId).not.toMatch(/[_01OIl]/)
      // keyHash is sha256(rawToken).
      expect(keyHash).toEqual(
        createHash("sha256").update(rawToken, "utf8").digest("hex"),
      )
      expect(keyHash).toHaveLength(64)
    })

    it("produces distinct keyIds across draws (no collisions in 1000)", () => {
      const seen = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        const { keyId } = generatePartnerToken()
        expect(seen.has(keyId)).toBe(false)
        seen.add(keyId)
      }
    })
  })

  describe("parsePartnerToken", () => {
    it("returns null for missing/empty/non-bearer headers", () => {
      expect(parsePartnerToken(null)).toBeNull()
      expect(parsePartnerToken("")).toBeNull()
      expect(parsePartnerToken("Bearer ")).toBeNull()
      expect(
        parsePartnerToken("not-bearer jfp_search_ABCDEFGHJKLM_xxx"),
      ).toBeNull()
    })

    it("returns null for wrong prefix", () => {
      const fake = `Bearer sk_search_ABCDEFGHJKLM_${"a".repeat(43)}`
      expect(parsePartnerToken(fake)).toBeNull()
    })

    it("returns null when keyId chars are out-of-alphabet", () => {
      // `_` inside keyId is rejected (would alias the delimiter).
      const underscore = `Bearer jfp_search_AB_DEFGHJKLM_${"a".repeat(43)}`
      expect(parsePartnerToken(underscore)).toBeNull()
      // `0` rejected (visually confusable, not in alphabet).
      const zero = `Bearer jfp_search_AB0DEFGHJKLM_${"a".repeat(43)}`
      expect(parsePartnerToken(zero)).toBeNull()
    })

    it("returns null when random tail is the wrong length", () => {
      const short = `Bearer jfp_search_ABCDEFGHJKLM_${"a".repeat(42)}`
      const long = `Bearer jfp_search_ABCDEFGHJKLM_${"a".repeat(44)}`
      expect(parsePartnerToken(short)).toBeNull()
      expect(parsePartnerToken(long)).toBeNull()
    })

    it("parses a real-shape token round-trip", () => {
      const { rawToken, keyId } = generatePartnerToken()
      const parsed = parsePartnerToken(`Bearer ${rawToken}`)
      expect(parsed).not.toBeNull()
      expect(parsed?.keyId).toBe(keyId)
      expect(parsed?.rawToken).toBe(rawToken)
    })

    it("accepts case-insensitive Bearer prefix", () => {
      const { rawToken } = generatePartnerToken()
      expect(parsePartnerToken(`bearer ${rawToken}`)).not.toBeNull()
      expect(parsePartnerToken(`BEARER ${rawToken}`)).not.toBeNull()
    })
  })

  describe("hashRawToken", () => {
    it("is deterministic", () => {
      const a = hashRawToken("hello")
      const b = hashRawToken("hello")
      expect(a).toBe(b)
      expect(a).toHaveLength(64)
    })

    it("differs across inputs", () => {
      expect(hashRawToken("a")).not.toBe(hashRawToken("b"))
    })
  })

  describe("timingSafeEqualHex", () => {
    it("returns true on exact match", () => {
      const hash = hashRawToken("identical")
      expect(timingSafeEqualHex(hash, hash)).toBe(true)
    })

    it("returns false on mismatched content", () => {
      expect(timingSafeEqualHex(hashRawToken("a"), hashRawToken("b"))).toBe(
        false,
      )
    })

    it("returns false on mismatched length without throwing", () => {
      expect(timingSafeEqualHex("abc", "abcdef")).toBe(false)
    })

    it("returns false on non-hex input without throwing", () => {
      // Buffer.from with "hex" silently truncates invalid chars but does not
      // throw, so the function relies on the length-equal check + bufA.length
      // === bufB.length guard. Both halves end up zero-length here.
      const a = "zz".repeat(32)
      const b = "yy".repeat(32)
      expect(timingSafeEqualHex(a, b)).toBe(false)
    })

    it("returns false on empty strings", () => {
      expect(timingSafeEqualHex("", "")).toBe(false)
    })
  })
})
