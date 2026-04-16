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
    onClearDragState: vi.fn(),
    onSetDragHandleState: vi.fn(),
    onPushToast: vi.fn(),
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
    expect(html).toContain("Call to Action Link")
    expect(html).toContain("Choose Bible quote image")
    expect(html).toContain("Choose Bible quote background color")
    expect(html).toContain(
      "background-image:url(&quot;https://example.com/quote.jpg&quot;)",
    )
    expect(html).toContain("background-color:#2457aa")
  })

  it("hides CTA label and link when the quote CTA is disabled", () => {
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

    expect(html).toContain("Disabled")
    expect(html).not.toContain("Hidden CTA")
    expect(html).not.toContain("Call to Action Link")
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

    expect(html).toContain("background-color:#151515")
    expect(html).toContain('type="color"')
    expect(html).toContain('value="#151515"')
  })
})
