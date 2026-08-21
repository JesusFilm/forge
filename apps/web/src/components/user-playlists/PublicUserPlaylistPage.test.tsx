import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: () => <span data-testid="image" />,
}))
vi.mock("./PublicUserPlaylistReportDialog", () => ({
  PublicUserPlaylistReportDialog: () => <button>Report</button>,
}))

import { PublicUserPlaylistPage } from "./PublicUserPlaylistPage"

describe("PublicUserPlaylistPage", () => {
  it("renders the closed block set, community/unlisted notice, and hostile text inertly", async () => {
    const hostile = "<script>alert(1)</script> https://example.test"
    const html = renderToStaticMarkup(
      await PublicUserPlaylistPage({
        intentTtlMs: 60_000,
        data: {
          uiLocale: "en",
          playlist: {
            title: hostile,
            description: hostile,
            locale: "en",
            countryCode: "CA",
            reportIntent: "intent",
            blocks: [
              { kind: "text", text: hostile },
              {
                kind: "mediaCollection",
                title: "Collection",
                videoIds: ["video_1"],
              },
              {
                kind: "videoCarousel",
                title: "Carousel",
                videoIds: ["video_1"],
              },
            ],
          },
          videos: [
            {
              id: "video_1",
              slug: "jesus",
              title: "Jesus",
              imageUrl: null,
              imageAlt: "Jesus",
              blurDataUrl: null,
              durationSeconds: 120,
              languageSlug: "english",
            },
          ],
        },
      }),
    )

    expect(html).toContain("Community-created playlist")
    expect(html).toContain("unlisted and shareable by link")
    expect(html).toContain("Collection")
    expect(html).toContain("Carousel")
    expect(html).toContain("Jesus")
    expect(html).toContain('href="/watch/jesus.html"')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toContain('href="https://example.test"')
  })
})
