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
    expect(container.querySelector("h3")?.textContent).toBe(
      "Why this story matters",
    )
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
})
