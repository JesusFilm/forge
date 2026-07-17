import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { BibleQuoteCard, type BibleQuoteCardProps } from "./bible-quote-card"

function props(
  overrides: Partial<BibleQuoteCardProps> = {},
): BibleQuoteCardProps {
  return {
    blockIndex: 2,
    itemIndex: 1,
    item: {
      reference: "John 3:16",
      text: "For God so loved the world...",
      attribution: "Jesus",
      backgroundColor: "#2457aa",
      backgroundImageUrl: "https://example.com/quote.jpg",
      ctaEnabled: true,
      ctaLabel: "Read more",
      ctaLink: "/watch",
    },
    dragState: null,
    dragHandleState: null,
    onActivateBlock: vi.fn(),
    onUpdateField: vi.fn(),
    onRemove: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnter: vi.fn(),
    onChooseImage: vi.fn(),
    onClearDragState: vi.fn(),
    onSetDragHandleState: vi.fn(),
    ...overrides,
  }
}

describe("BibleQuoteCard", () => {
  it("renders quote content with media, color, and CTA controls", () => {
    const html = renderToStaticMarkup(<BibleQuoteCard {...props()} />)

    expect(html).toContain("John 3:16")
    expect(html).toContain("For God so loved the world...")
    expect(html).toContain("Jesus")
    expect(html).toContain("Read more")
    expect(html).toContain("Edit quote call to action link")
    expect(html).toContain("Toggle quote call to action")
    expect(html).toContain("Choose quote image")
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain("Choose quote background color")
    expect(html).not.toContain("Remove quote image")
    expect(html).toContain(
      "background-image:url(&quot;https://example.com/quote.jpg&quot;)",
    )
    expect(html).toContain("#2457aa")
    expect(html).not.toContain('type="color"')
  })

  it("collapses CTA label and link when the quote CTA is disabled", () => {
    const html = renderToStaticMarkup(
      <BibleQuoteCard
        {...props({
          item: {
            reference: "Psalm 23:1",
            text: "The Lord is my shepherd.",
            backgroundColor: "#151515",
            ctaEnabled: false,
            ctaLabel: "Hidden CTA",
            ctaLink: "/hidden",
          },
        })}
      />,
    )

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain("grid-rows-[0fr]")
    expect(html).toContain('tabindex="-1"')
  })

  it("falls back to the default color when the stored color is invalid", () => {
    const html = renderToStaticMarkup(
      <BibleQuoteCard
        {...props({
          item: {
            reference: "Romans 8:28",
            text: "All things work together for good.",
            backgroundColor: "default",
            ctaEnabled: false,
          },
        })}
      />,
    )

    expect(html).toContain("#151515")
    expect(html).not.toContain('type="color"')
  })
})
