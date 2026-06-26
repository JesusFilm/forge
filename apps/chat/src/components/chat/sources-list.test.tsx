import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { type SeekerSource } from "@/lib/conversations"

import { SourcesList } from "./sources-list"

function source(overrides: Partial<SeekerSource> = {}): SeekerSource {
  return {
    sourceName: "Doc",
    title: "A Title",
    url: "https://example.org/a",
    score: 0.9,
    snippet: "a snippet",
    ...overrides,
  }
}

describe("SourcesList", () => {
  it("renders an explicit 'No sources cited' state when empty", () => {
    render(<SourcesList sources={[]} />)
    expect(screen.getByText("No sources cited")).toBeInTheDocument()
  })

  it("links an https source with rel=noopener noreferrer", () => {
    render(<SourcesList sources={[source({ url: "https://example.org/x" })]} />)
    const link = screen.getByRole("link", { name: /A Title/ })
    expect(link).toHaveAttribute("href", "https://example.org/x")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("renders a non-https url as text, not a link", () => {
    render(
      <SourcesList sources={[source({ url: "http://insecure.example" })]} />,
    )
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText("A Title")).toBeInTheDocument()
  })

  it("renders a javascript: url as text, not a link", () => {
    render(
      <SourcesList
        sources={[source({ url: "javascript:alert(1)", title: "XSS" })]}
      />,
    )
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText("XSS")).toBeInTheDocument()
  })

  it("renders title/snippet as text (no HTML injection)", () => {
    const malicious = "<img src=x onerror=alert(1)>"
    render(
      <SourcesList
        sources={[source({ title: malicious, snippet: malicious })]}
      />,
    )
    // The raw markup renders as text content, and no <img> element is created.
    expect(document.querySelector("img")).toBeNull()
    expect(screen.getAllByText(malicious).length).toBeGreaterThan(0)
  })

  it("falls back to sourceName when title is null", () => {
    render(
      <SourcesList
        sources={[source({ title: null, sourceName: "FallbackName" })]}
      />,
    )
    expect(screen.getByText("FallbackName")).toBeInTheDocument()
  })
})
