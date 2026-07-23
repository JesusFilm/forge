/**
 * @vitest-environment jsdom
 */

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Text } from "./Text"

function renderText(overrides: Record<string, unknown> = {}) {
  const html = renderToStaticMarkup(
    <Text
      data={
        {
          id: "story-text",
          heading: "A story worth discovering",
          headingLevel: "h2",
          subtitle: "Inside the experience",
          contentParagraphs: [],
          textVariant: "promotional",
          ...overrides,
        } as unknown as Parameters<typeof Text>[0]["data"]
      }
    />,
  )
  const container = document.createElement("div")
  container.innerHTML = html
  return { container, html }
}

describe("Text promotional Markdown", () => {
  it("server-renders promotional Markdown as semantic editorial content", () => {
    const { container, html } = renderText({
      contentParagraphs: [
        "### Why this story matters",
        "A **trusted** story, shared with *every nation*.",
        "- Translation partners\n- Local storytellers",
        "> The story meets people in the language they know best.",
        "[Explore the library](/watch/videos)",
      ],
    })

    expect(
      container.querySelector('[data-variant="promotional"]'),
    ).not.toBeNull()
    expect(container.querySelector("h2")?.textContent).toBe(
      "A story worth discovering",
    )
    expect(container.querySelector("h2")?.classList).toContain("xl:row-start-2")
    expect(container.querySelector("h3")?.textContent).toBe(
      "Why this story matters",
    )
    expect(
      container.querySelector('[data-testid="promotional-markdown"]')
        ?.classList,
    ).toContain("xl:row-start-2")
    expect(
      container.querySelector('[data-testid="promotional-markdown"]')
        ?.classList,
    ).not.toContain("border-t")
    expect(
      container.querySelector('[data-testid="promotional-eyebrow-row"]')
        ?.classList,
    ).toContain("xl:row-start-1")
    expect(container.querySelectorAll("li")).toHaveLength(2)
    expect(container.querySelector("strong")?.textContent).toBe("trusted")
    expect(container.querySelector("em")?.textContent).toBe("every nation")
    expect(container.querySelector("blockquote")?.textContent).toContain(
      "language they know best",
    )
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/watch/videos",
    )
    expect(container.textContent).toContain(
      "A trusted story, shared with every nation.",
    )
    expect(html).not.toContain("use client")
  })

  it("keeps raw HTML inert and strips unsafe link protocols", () => {
    const { container, html } = renderText({
      contentParagraphs: [
        '<script data-danger="true">alert("unsafe")</script>',
        "[Bad script](javascript:alert(1))",
        "[Bad data](data:text/html,unsafe)",
        "[Safe site](https://www.jesusfilm.org/)",
      ],
    })

    expect(container.querySelector("script")).toBeNull()
    expect(container.textContent).toContain(
      '<script data-danger="true">alert("unsafe")</script>',
    )
    expect(html).not.toContain('data-danger="true"')
    const links = Array.from(container.querySelectorAll("a"))
    expect(
      links.find((link) => link.textContent === "Bad script")?.href,
    ).not.toMatch(/^javascript:/)
    expect(
      links.find((link) => link.textContent === "Bad data")?.href,
    ).not.toMatch(/^data:/)
    expect(
      links
        .find((link) => link.textContent === "Safe site")
        ?.getAttribute("href"),
    ).toBe("https://www.jesusfilm.org/")
  })

  it("normalizes promotional Markdown root links to the watch base path", () => {
    const { container } = renderText({
      contentParagraphs: ["[Read more](/)"],
    })

    expect(container.querySelector("a")?.getAttribute("href")).toBe("/watch")
  })

  it("does not parse Markdown for legacy Text variants", () => {
    const { container } = renderText({
      heading: "Legacy text",
      contentParagraphs: ["Keep **literal formatting** here."],
      textVariant: "small",
    })

    expect(container.querySelector('[data-variant="promotional"]')).toBeNull()
    expect(container.querySelector("strong")).toBeNull()
    expect(container.textContent).toContain("Keep **literal formatting** here.")
  })

  it("omits empty body chrome when only the promotional heading is authored", () => {
    const { container } = renderText({ contentParagraphs: [] })

    expect(container.querySelector("h2")?.textContent).toBe(
      "A story worth discovering",
    )
    expect(
      container.querySelector('[data-testid="promotional-markdown"]'),
    ).toBeNull()
  })

  it("does not render decorative rays beside the promotional heading", () => {
    const { container } = renderText()

    const promotional = container.querySelector('[data-variant="promotional"]')
    expect(promotional?.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(promotional?.innerHTML).not.toContain("bg-linear-to-r")
    expect(promotional?.innerHTML).not.toContain("bg-linear-to-b")
  })

  it("uses the reduced desktop scale for the promotional heading", () => {
    const { container } = renderText()

    const heading = container.querySelector("h2")
    expect(heading?.className).toContain("lg:text-4xl")
    expect(heading?.className).toContain("xl:text-5xl")
    expect(heading?.className).not.toContain("lg:text-5xl")
    expect(heading?.className).not.toContain("xl:text-[3.5rem]")
  })
})
