import { describe, expect, it } from "vitest"

import { classifySearchTraceQuery } from "./search-trace-privacy"

describe("classifySearchTraceQuery", () => {
  it("keeps normal production queries sample-eligible", () => {
    expect(classifySearchTraceQuery("Jesus film for kids")).toEqual({
      queryText: "Jesus film for kids",
      queryQualityLabel: "normal",
      sensitiveQueryLabel: "none",
      abuseLabel: "none",
      sampleEligible: true,
    })
  })

  it("redacts obvious email, phone, credential, and token values", () => {
    const result = classifySearchTraceQuery(
      "email me at viewer@example.com phone +1 (555) 123-4567 api_key abc123 bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature123 abcdef1234567890abcdef1234567890",
    )

    expect(result.sampleEligible).toBe(false)
    expect(result.sensitiveQueryLabel).toBe("mixed")
    expect(result.queryText).toContain("[redacted-email]")
    expect(result.queryText).toContain("[redacted-phone]")
    expect(result.queryText).toContain("[redacted-credential]")
    expect(result.queryText).toContain("[redacted-token]")
    expect(result.queryText).not.toContain("viewer@example.com")
    expect(result.queryText).not.toContain("abc123")
    expect(result.queryText).not.toContain("eyJhbGci")
    expect(result.queryText).not.toContain("abcdef1234567890abcdef1234567890")
  })

  it("redacts cookie, IP address, and user identifier shaped values", () => {
    const result = classifySearchTraceQuery(
      "Cookie: sessionid=abcdef123456; cf_clearance=secret ip 203.0.113.10 user_id usr_123456789",
    )

    expect(result.sampleEligible).toBe(false)
    expect(result.sensitiveQueryLabel).toBe("mixed")
    expect(result.queryText).toContain("[redacted-cookie]")
    expect(result.queryText).toContain("[redacted-ip]")
    expect(result.queryText).toContain("[redacted-user-id]")
    expect(result.queryText).not.toContain("sessionid=abcdef123456")
    expect(result.queryText).not.toContain("203.0.113.10")
    expect(result.queryText).not.toContain("usr_123456789")
  })

  it("marks injection-like queries as non-sampleable abuse", () => {
    const result = classifySearchTraceQuery("<script>alert(1)</script>")

    expect(result.abuseLabel).toBe("injection_probe")
    expect(result.sampleEligible).toBe(false)
    expect(result.queryText).toContain("[redacted-abuse]")
  })

  it("normalizes whitespace and caps retained query text length", () => {
    const result = classifySearchTraceQuery(`  ${"a".repeat(1200)}  `)

    expect(result.queryQualityLabel).toBe("long")
    expect(result.queryText).toHaveLength(1024)
  })
})
