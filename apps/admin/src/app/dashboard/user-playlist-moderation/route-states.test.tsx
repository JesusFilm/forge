import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import ErrorState from "./error"
import LoadingState from "./loading"

describe("user playlist moderation route states", () => {
  it("renders an announced loading state", () => {
    const html = renderToStaticMarkup(<LoadingState />)
    expect(html).toContain('role="status"')
    expect(html).toContain("Loading playlist reports")
  })

  it("renders a bounded retryable error state", () => {
    const html = renderToStaticMarkup(
      <ErrorState error={new Error("secret ciphertext")} reset={vi.fn()} />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain("Moderation queue is temporarily unavailable")
    expect(html).not.toContain("secret ciphertext")
  })
})
