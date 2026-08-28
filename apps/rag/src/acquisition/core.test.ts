import { describe, expect, it } from "vitest"
import { extractContent } from "./extract.js"
import { normalizeUrl } from "./normalize-url.js"

describe("acquisition pure core", () => {
  it("normalizes tracking URLs into a stable identity", () => {
    expect(
      normalizeUrl("HTTPS://EXAMPLE.COM/story/?utm_source=x&keep=1#part"),
    ).toBe("https://example.com/story?keep=1")
  })

  it("extracts the first configured content scope after stripping chrome", () => {
    const result = extractContent(
      "<html><head><title>Hope | Example</title></head><body><main><nav>menu</nav><p>Living hope.</p></main></body></html>",
      { contentSelectors: ["main"], stripSelectors: ["nav"] },
    )
    expect(result).toEqual({ title: "Hope", text: "Living hope." })
  })
})
