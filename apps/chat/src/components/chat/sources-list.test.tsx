import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

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

function sectionEl(): HTMLDetailsElement {
  const section = document.querySelector('[data-sources="section"]')
  if (!(section instanceof HTMLDetailsElement)) {
    throw new Error("sources section <details> not rendered")
  }
  return section
}

describe("SourcesList", () => {
  it("renders an explicit 'No sources cited' state when empty, with no disclosure to open", () => {
    render(<SourcesList sources={[]} />)
    // Immediately visible without interaction — never behind the collapse.
    expect(screen.getByText("No sources cited")).toBeInTheDocument()
    expect(document.querySelector('[data-sources="empty"]')).not.toBeNull()
    expect(document.querySelector('[data-sources="section"]')).toBeNull()
  })

  it("renders a visible 'Sources · N' heading with the source count", () => {
    render(
      <SourcesList
        sources={[
          source({ url: "https://example.org/a" }),
          source({ url: "https://example.org/b" }),
          source({ url: "https://example.org/c" }),
        ]}
      />,
    )
    expect(screen.getByText("Sources · 3")).toBeInTheDocument()
  })

  it("collapses the section by default and expands it on summary click", async () => {
    const user = userEvent.setup()
    render(<SourcesList sources={[source()]} />)
    expect(sectionEl().open).toBe(false)
    await user.click(screen.getByText("Sources · 1"))
    expect(sectionEl().open).toBe(true)
    expect(document.querySelector('[data-sources="list"]')).not.toBeNull()
  })

  it("dedupes sources with an identical url, keeping the first occurrence", () => {
    render(
      <SourcesList
        sources={[
          source({
            url: "https://example.org/same",
            title: "First",
            snippet: "first passage",
          }),
          source({
            url: "https://example.org/same",
            title: "Second",
            snippet: "second passage",
          }),
          source({
            url: "https://example.org/same",
            title: "Third",
            snippet: "third passage",
          }),
          source({ url: "https://example.org/other", title: "Other" }),
        ]}
      />,
    )
    expect(screen.getByText("Sources · 2")).toBeInTheDocument()
    const list = document.querySelector('[data-sources="list"]')
    expect(list).not.toBeNull()
    expect(within(list as HTMLElement).getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByText("First")).toBeInTheDocument()
    expect(screen.queryByText("Second")).not.toBeInTheDocument()
    expect(screen.queryByText("Third")).not.toBeInTheDocument()
    expect(screen.getByText("Other")).toBeInTheDocument()
    // First-occurrence-wins covers the whole entry, snippet included — a
    // regression to last-wins would keep the title but swap the passage.
    expect(screen.getByText("first passage")).toBeInTheDocument()
    expect(screen.queryByText("second passage")).not.toBeInTheDocument()
    expect(screen.queryByText("third passage")).not.toBeInTheDocument()
  })

  it("does not dedupe sources whose url is empty", () => {
    render(
      <SourcesList
        sources={[
          source({ url: "", title: "Unlinked A" }),
          source({ url: "", title: "Unlinked B" }),
        ]}
      />,
    )
    expect(screen.getByText("Sources · 2")).toBeInTheDocument()
    expect(screen.getByText("Unlinked A")).toBeInTheDocument()
    expect(screen.getByText("Unlinked B")).toBeInTheDocument()
  })

  it("does not dedupe distinct sources sharing an unparseable junk url", () => {
    render(
      <SourcesList
        sources={[
          source({ url: "N/A", title: "Junk A" }),
          source({ url: "N/A", title: "Junk B" }),
        ]}
      />,
    )
    // "N/A" identifies nothing — collapsing these would silently drop a
    // citation from the grounding trail.
    expect(screen.getByText("Sources · 2")).toBeInTheDocument()
    expect(screen.getByText("Junk A")).toBeInTheDocument()
    expect(screen.getByText("Junk B")).toBeInTheDocument()
  })

  it("clamps the snippet to three lines by default", () => {
    render(<SourcesList sources={[source({ snippet: "a long passage" })]} />)
    const snippet = document.querySelector("[data-source-snippet]")
    expect(snippet).not.toBeNull()
    expect(snippet).toHaveClass("line-clamp-3")
    // line-clamp-3 works via its own display:-webkit-box — ANY display
    // utility on the same element silently unclamps it (browser-caught in
    // feat-269; jsdom can't observe the visual clamp, so pin the class mix).
    const displayUtilities = [
      "block",
      "inline-block",
      "inline",
      "flex",
      "inline-flex",
      "grid",
      "inline-grid",
      "table",
      "inline-table",
      "flow-root",
      "contents",
      "list-item",
      "hidden",
    ]
    for (const cls of displayUtilities) {
      expect(snippet?.classList.contains(cls)).toBe(false)
    }
    // The full text is in the DOM (the clamp is visual), so expanding can
    // never lose content.
    expect(snippet).toHaveTextContent("a long passage")
  })

  it("expands a source's full passage through its own disclosure", async () => {
    const user = userEvent.setup()
    render(<SourcesList sources={[source({ snippet: "the full passage" })]} />)
    await user.click(screen.getByText("Sources · 1"))
    const snippetDetails = document
      .querySelector("[data-source-snippet]")
      ?.closest("details")
    expect(snippetDetails).not.toBeNull()
    expect(snippetDetails?.open).toBe(false)
    await user.click(screen.getByText("Show full passage"))
    // Open state drives the clamp release (group-open:line-clamp-none).
    expect(snippetDetails?.open).toBe(true)
  })

  it("expands one source's passage independently of its siblings", async () => {
    const user = userEvent.setup()
    render(
      <SourcesList
        sources={[
          source({ url: "https://example.org/a", snippet: "passage a" }),
          source({ url: "https://example.org/b", snippet: "passage b" }),
        ]}
      />,
    )
    await user.click(screen.getByText("Sources · 2"))
    const toggles = screen.getAllByText("Show full passage")
    expect(toggles).toHaveLength(2)
    await user.click(toggles[0])
    const detailsFor = (index: number) =>
      document
        .querySelector(`[data-source-index="${index}"] [data-source-snippet]`)
        ?.closest("details")
    expect(detailsFor(0)?.open).toBe(true)
    expect(detailsFor(1)?.open).toBe(false)
  })

  it("renders no passage disclosure for a snippet-less source", async () => {
    const user = userEvent.setup()
    render(<SourcesList sources={[source({ snippet: "" })]} />)
    await user.click(screen.getByText("Sources · 1"))
    expect(screen.queryByText("Show full passage")).not.toBeInTheDocument()
    expect(document.querySelector("[data-source-snippet]")).toBeNull()
  })

  it("nudges the opened section into view and not on close", async () => {
    const user = userEvent.setup()
    render(<SourcesList sources={[source()]} />)
    // jsdom has no scrollIntoView; an instance stub satisfies the typeof
    // guard so the open-branch nudge is actually exercised.
    const scrollIntoView = vi.fn()
    sectionEl().scrollIntoView =
      scrollIntoView as unknown as HTMLElement["scrollIntoView"]
    await user.click(screen.getByText("Sources · 1"))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" })
    await user.click(screen.getByText("Sources · 1"))
    // Closing must not re-nudge.
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it("links an https source with rel=noopener noreferrer", async () => {
    const user = userEvent.setup()
    render(<SourcesList sources={[source({ url: "https://example.org/x" })]} />)
    await user.click(screen.getByText("Sources · 1"))
    const link = screen.getByRole("link", { name: /A Title/ })
    expect(link).toHaveAttribute("href", "https://example.org/x")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("renders a non-https url as text, not a link", async () => {
    const user = userEvent.setup()
    render(
      <SourcesList sources={[source({ url: "http://insecure.example" })]} />,
    )
    await user.click(screen.getByText("Sources · 1"))
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText("A Title")).toBeInTheDocument()
  })

  it("renders a javascript: url as text, not a link", async () => {
    const user = userEvent.setup()
    render(
      <SourcesList
        sources={[source({ url: "javascript:alert(1)", title: "XSS" })]}
      />,
    )
    await user.click(screen.getByText("Sources · 1"))
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText("XSS")).toBeInTheDocument()
  })

  it("renders title/snippet as text (no HTML injection)", async () => {
    const user = userEvent.setup()
    const malicious = "<img src=x onerror=alert(1)>"
    render(
      <SourcesList
        sources={[source({ title: malicious, snippet: malicious })]}
      />,
    )
    await user.click(screen.getByText("Sources · 1"))
    // The raw markup renders as text content, and no <img> element is created.
    expect(document.querySelector("img")).toBeNull()
    expect(screen.getAllByText(malicious).length).toBeGreaterThan(0)
  })

  it("falls back to sourceName when title is null", async () => {
    const user = userEvent.setup()
    render(
      <SourcesList
        sources={[source({ title: null, sourceName: "FallbackName" })]}
      />,
    )
    await user.click(screen.getByText("Sources · 1"))
    expect(screen.getByText("FallbackName")).toBeInTheDocument()
  })

  it("renders a hostile sourceName on the fallback path as text", async () => {
    const user = userEvent.setup()
    const malicious = "<img src=x onerror=alert(1)>"
    render(
      <SourcesList
        sources={[source({ title: null, sourceName: malicious })]}
      />,
    )
    await user.click(screen.getByText("Sources · 1"))
    expect(document.querySelector("img")).toBeNull()
    expect(screen.getAllByText(malicious).length).toBeGreaterThan(0)
  })
})
