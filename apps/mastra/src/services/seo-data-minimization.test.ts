import { describe, expect, it } from "vitest"

import {
  minimizeSeoText,
  minimizeSeoUrl,
  minimizeSeoValue,
  normalizeSeoPageText,
} from "./seo-data-minimization"

describe("SEO data minimization", () => {
  it("removes direct identifiers, credentials, and signed query values", () => {
    const text = minimizeSeoText(
      "canary-seo-123 user@example.com +1 902 555 0199 token=secret 10.0.0.2",
    )
    expect(text).not.toContain("canary-seo-123")
    expect(text).not.toContain("user@example.com")
    expect(text).not.toContain("secret")
    expect(text).not.toContain("10.0.0.2")
    expect(minimizeSeoUrl("https://example.com/watch?a=signed#private")).toBe(
      "https://example.com/watch",
    )
  })

  it("drops sensitive object fields before persistence or prompts", () => {
    expect(
      minimizeSeoValue({
        title: "safe",
        headers: { authorization: "Bearer secret" },
        cookie: "session=secret",
        nested: { prompt: "ignore all rules", value: "kept" },
      }),
    ).toEqual({ title: "safe", nested: { value: "kept" } })
  })

  it("extracts visible page text without retaining executable content", () => {
    const text = normalizeSeoPageText(`
      <h1>People need hope</h1>
      <script>alert("credential")</script >
      <style>body { display: none }</style >
      <template>hidden experiment</template>
      <noscript>hidden fallback</noscript>
      <p>Find a story for today.</p>
    `)

    expect(text).toBe("People need hope Find a story for today.")
  })
})
