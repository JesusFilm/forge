import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AssistantMarkdown, MarkdownRenderBoundary } from "./assistant-markdown"

describe("AssistantMarkdown formatting", () => {
  it("renders bold and emphasis as elements, not literal asterisks", () => {
    const { container } = render(
      <AssistantMarkdown content="This is **bold** and *soft*." />,
    )
    const strong = container.querySelector("strong")
    const em = container.querySelector("em")
    expect(strong).toHaveTextContent("bold")
    expect(em).toHaveTextContent("soft")
    expect(container.textContent).not.toContain("*")
  })

  it("renders unordered and ordered lists as list elements", () => {
    const { container } = render(
      <AssistantMarkdown
        content={"- first point\n- second point\n\n1. one\n2. two"}
      />,
    )
    const ul = container.querySelector("ul")
    const ol = container.querySelector("ol")
    expect(ul).not.toBeNull()
    expect(ol).not.toBeNull()
    expect(ul?.querySelectorAll("li")).toHaveLength(2)
    expect(ol?.querySelectorAll("li")).toHaveLength(2)
  })

  it("renders blockquotes with the scripture treatment", () => {
    const { container } = render(
      <AssistantMarkdown content="> Trust in the LORD with all your heart." />,
    )
    const quote = container.querySelector("blockquote")
    expect(quote).toHaveTextContent("Trust in the LORD with all your heart.")
    expect(quote?.className).toContain("font-scripture")
    expect(container.textContent).not.toContain(">")
  })

  it("renders inline code as a code element", () => {
    const { container } = render(
      <AssistantMarkdown content="Read `John 3:16` today." />,
    )
    expect(container.querySelector("code")).toHaveTextContent("John 3:16")
  })

  it("keeps line structure in fenced code blocks (degraded, no pre element)", () => {
    const { container } = render(
      <AssistantMarkdown
        content={"```js\nconst x = 1;\nconsole.log(x)\n```"}
      />,
    )
    // pre is not allowlisted: the code element survives with its newlines,
    // and the pre-wrap chip styling keeps them visible.
    expect(container.querySelector("pre")).toBeNull()
    const code = container.querySelector("code")
    expect(code?.textContent).toContain("const x = 1;\nconsole.log(x)")
    expect(code?.className).toContain("whitespace-pre-wrap")
  })

  it("renders soft and hard line breaks as br elements (remark-breaks)", () => {
    const soft = render(
      <AssistantMarkdown content={"Verse line one\nVerse line two"} />,
    )
    expect(soft.container.querySelectorAll("br")).toHaveLength(1)
    expect(soft.container.textContent).toContain("Verse line one")
    soft.unmount()
    const hard = render(<AssistantMarkdown content={"Line one  \nLine two"} />)
    expect(hard.container.querySelectorAll("br")).toHaveLength(1)
  })

  it("forwards the start attribute on ordered lists", () => {
    const { container } = render(
      <AssistantMarkdown content={"2. second point\n3. third point"} />,
    )
    expect(container.querySelector("ol")).toHaveAttribute("start", "2")
  })

  it("renders https links with target=_blank and rel=noopener noreferrer", () => {
    render(
      <AssistantMarkdown content="[Watch here](https://www.jesusfilm.org/watch)" />,
    )
    const link = screen.getByRole("link")
    expect(link).toHaveAttribute("href", "https://www.jesusfilm.org/watch")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveTextContent("Watch here")
  })
})

describe("AssistantMarkdown link gate (https-only)", () => {
  it.each([
    ["http:", "[insecure](http://example.com/page)", "insecure"],
    ["javascript:", "[run](javascript:alert(1))", "run"],
    ["uppercase JAVASCRIPT:", "[shout](JAVASCRIPT:alert(1))", "shout"],
    [
      "entity-obfuscated javascript:",
      "[sneak](javascript&#58;alert(1))",
      "sneak",
    ],
    ["data:", "[blob](data:text/html,hi)", "blob"],
    ["relative", "[somewhere](/watch)", "somewhere"],
  ])(
    "renders a %s link's label as plain text, never an anchor",
    (_, md, label) => {
      const { container } = render(<AssistantMarkdown content={md} />)
      expect(container.querySelector("a")).toBeNull()
      // The specific label survives as visible text.
      expect(container.textContent).toContain(label)
    },
  )
})

describe("AssistantMarkdown raw-HTML hardening", () => {
  it("renders a raw <script> block as inert text, never an element", () => {
    const { container } = render(
      <AssistantMarkdown content={"<script>alert('xss')</script>"} />,
    )
    expect(container.querySelector("script")).toBeNull()
    expect(container.textContent).toContain("<script>alert('xss')</script>")
  })

  it("renders inline <img onerror> as inert text, never an element", () => {
    const { container } = render(
      <AssistantMarkdown
        content={'Before <img src=x onerror="alert(1)"> after'}
      />,
    )
    expect(container.querySelector("img")).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
  })

  it("renders an <iframe srcdoc> as inert text, never an element", () => {
    const { container } = render(
      <AssistantMarkdown
        content={'<iframe srcdoc="<script>alert(1)</script>"></iframe>'}
      />,
    )
    expect(container.querySelector("iframe")).toBeNull()
    // Degrades to visible text, not a silent drop.
    expect(container.textContent).toContain("<iframe srcdoc=")
  })

  it("keeps disallowed markdown elements out of the DOM but keeps their text", () => {
    const { container } = render(
      <AssistantMarkdown content={"# A heading\n\n---\n\nplain after"} />,
    )
    expect(container.querySelector("h1")).toBeNull()
    expect(container.querySelector("hr")).toBeNull()
    expect(container.textContent).toContain("A heading")
    expect(container.textContent).toContain("plain after")
  })

  it("drops images entirely (img is not in the allowlist)", () => {
    const { container } = render(
      <AssistantMarkdown content="![a picture](https://example.com/x.png)" />,
    )
    expect(container.querySelector("img")).toBeNull()
  })
})

describe("AssistantMarkdown streaming tolerance", () => {
  it.each([
    ["unclosed bold", "The point is **almost made"],
    ["half-typed link", "See [the film](https://www.jesusfil"],
    ["dangling emphasis", "A thought that trails *"],
    ["mid-list token", "- first\n- seco"],
  ])("renders %s mid-stream without throwing", (_, partial) => {
    const { container } = render(
      <AssistantMarkdown content={partial} streaming />,
    )
    expect((container.textContent ?? "").length).toBeGreaterThan(0)
  })

  it("shows the pulse cursor only while streaming", () => {
    const { container, rerender } = render(
      <AssistantMarkdown content="Waiting" streaming />,
    )
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    rerender(<AssistantMarkdown content="Done" />)
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})

describe("AssistantMarkdown pathological-input containment", () => {
  it("renders a deep blockquote nesting bomb as plain text without throwing", () => {
    // 4000 nesting markers stack-overflows react-markdown's recursive render
    // when parsed; the prefix guard must divert to plain text instead.
    const bomb = "> ".repeat(4000) + "hi"
    const { container } = render(<AssistantMarkdown content={bomb} />)
    expect(container.querySelector("blockquote")).toBeNull()
    expect(container.textContent).toContain("> > >")
    expect(container.textContent).toContain("hi")
  })

  it("renders a deep list-indentation bomb as plain text without throwing", () => {
    const bomb = Array.from(
      { length: 40 },
      (_, i) => " ".repeat((i + 20) * 4) + "- item",
    ).join("\n")
    const { container } = render(<AssistantMarkdown content={bomb} />)
    expect(container.querySelector("ul")).toBeNull()
    // Isolates the GUARD layer: without it this parses as an indented code
    // block (a code element), not the plain-span fallback.
    expect(container.querySelector("code")).toBeNull()
    expect(container.textContent).toContain("- item")
  })

  it("renders over-length alternating-emphasis input as plain text (length cap)", () => {
    // Alternating */_ nests genuinely but never forms a marker RUN, so the
    // prefix guard misses it; only the shape-agnostic length cap diverts it
    // before the super-linear emphasis parse freezes the main thread.
    const bomb = "*_".repeat(6000) // 12000 units, no prefix run
    expect(/^[ \t>*+-]{64,}/m.test(bomb)).toBe(false)
    const { container } = render(<AssistantMarkdown content={bomb} />)
    expect(container.querySelector("em")).toBeNull()
    expect(container.querySelector("strong")).toBeNull()
    const span = container.querySelector("[data-message-content] > span")
    expect(span?.className).toContain("whitespace-pre-wrap")
  })

  it("still renders a legitimate reply at the length cap as markdown", () => {
    // A reply exactly at the per-message contract cap is legitimate — it must
    // NOT be diverted; only content beyond the cap is.
    const atCap = "**bold** ".repeat(910).slice(0, 8192) // <= 8192 units
    expect(atCap.length).toBeLessThanOrEqual(8192)
    const { container } = render(<AssistantMarkdown content={atCap} />)
    expect(container.querySelector("strong")).not.toBeNull()
  })

  it("falls back to plain pre-wrap text when the markdown render throws", () => {
    const Thrower = () => {
      throw new Error("render boom")
    }
    // Suppress React's expected error-boundary console noise for this case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const { container } = render(
        <MarkdownRenderBoundary content="raw *text* survives">
          <Thrower />
        </MarkdownRenderBoundary>,
      )
      const fallback = container.querySelector("span")
      expect(fallback?.textContent).toBe("raw *text* survives")
      expect(fallback?.className).toContain("whitespace-pre-wrap")
    } finally {
      spy.mockRestore()
    }
  })
})
