/**
 * @vitest-environment jsdom
 *
 * Pins the PRODUCTION card URL under a configured basePath.
 *
 * Every other suite renders with `__NEXT_ROUTER_BASEPATH` unset, so a card's
 * rendered `href` has no `/watch` prefix and those assertions cannot tell a
 * correct href from a doubled or a missing one. `next/link` reads that env var
 * once at module load, so it has to be set before the module graph is pulled
 * in — a `beforeEach` assignment or `vi.stubEnv` after the import is inert and
 * would make this whole file pass vacuously.
 *
 * That is why the imports below are dynamic and live inside the test.
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("embla-carousel-react", () => ({
  default: vi.fn(() => [vi.fn(), null]),
}))

beforeAll(() => {
  process.env.__NEXT_ROUTER_BASEPATH = "/watch"
})

async function renderCard(item: Record<string, unknown>, languageSlug: string) {
  const { MediaCollection } = await import("./MediaCollection")

  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)

  act(() => {
    root.render(
      <MediaCollection
        languageSlug={languageSlug}
        data={{ id: "block-1", itemsSource: "manual", items: [item] } as never}
      />,
    )
  })

  const card = container.querySelector<HTMLAnchorElement>(
    'a[data-testid="VideoCard"]',
  )
  const attrs = {
    dataHref: card?.getAttribute("data-href"),
    href: card?.getAttribute("href"),
  }

  act(() => {
    root.unmount()
  })
  container.remove()
  return attrs
}

describe("MediaCollection card href under a configured basePath", () => {
  it("renders the canonical public URL exactly once", async () => {
    const { dataHref, href } = await renderCard(
      { id: "item-1", videoId: "v-1", videoSlug: "jesus", title: "JESUS" },
      "english",
    )

    // The component hands Link a base-path-relative href...
    expect(dataHref).toBe("/jesus.html")
    // ...and Link prepends the basePath exactly once.
    expect(href).toBe("/watch/jesus.html")
    expect(href).not.toContain("/watch/watch/")
  })

  // A default-language href is syntactically valid, so a card that silently
  // drops the dub language would pass every English-only assertion. This is
  // the recurring Watch defect class, so it gets its own pin.
  //
  // The two language axes are held APART on purpose. Passing a Spanish dub
  // alongside a Spanish page language makes the assertion vacuous: deleting
  // the item-language branch would fall through to the page language and
  // produce the same URL. Here the page language is English, so only the
  // item's own dub can produce this result.
  it("preserves the item's dub language over the page language", async () => {
    const { dataHref, href } = await renderCard(
      {
        id: "item-1",
        videoId: "v-1",
        videoSlug: "jesus",
        title: "JESUS",
        videoDub: { language: { slug: "spanish-castilian" } },
      },
      "english",
    )

    expect(dataHref).toBe("/jesus.html/spanish-castilian.html")
    expect(href).toBe("/watch/jesus.html/spanish-castilian.html")
    expect(href).not.toContain("/watch/watch/")
  })

  // The companion: with no item language, the page language is what must
  // reach the URL. Without this, the fixture above could be satisfied by
  // ignoring the page language entirely.
  it("falls back to the page language when the item has no dub", async () => {
    const { dataHref, href } = await renderCard(
      { id: "item-1", videoId: "v-1", videoSlug: "jesus", title: "JESUS" },
      "spanish-castilian",
    )

    expect(dataHref).toBe("/jesus.html/spanish-castilian.html")
    expect(href).toBe("/watch/jesus.html/spanish-castilian.html")
  })
})
