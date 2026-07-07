import { describe, expect, it } from "vitest"

import { watchVideoStructuredDataJson } from "@/lib/watch-structured-data"

describe("watchVideoStructuredDataJson", () => {
  it("serializes sanitized VideoObject JSON-LD from the metadata model", () => {
    const json = watchVideoStructuredDataJson({
      title: "Life < Jesus | Jesus Film Project",
      videoTitle: "Life < Jesus",
      description: "A story with <script> content.",
      canonicalUrl: "https://www.jesusfilm.org/watch/life.html/english.html",
      image: {
        url: "https://image.mux.com/pb/thumbnail.jpg",
        width: 1400,
        height: 933,
        alt: "Poster",
        type: "image/jpeg",
      },
      noIndex: false,
      inLanguage: "en",
      durationSeconds: 91.4,
      contentUrl: "https://cdn.example/life.m3u8",
      embedUrl: "https://www.jesusfilm.org/watch/life.html/english.html",
      uploadDate: "2026-06-01",
    })

    expect(json).not.toContain("<")
    expect(JSON.parse(json)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: "Life < Jesus",
      description: "A story with <script> content.",
      url: "https://www.jesusfilm.org/watch/life.html/english.html",
      embedUrl: "https://www.jesusfilm.org/watch/life.html/english.html",
      contentUrl: "https://cdn.example/life.m3u8",
      thumbnailUrl: ["https://image.mux.com/pb/thumbnail.jpg"],
      inLanguage: "en",
      uploadDate: "2026-06-01T00:00:00.000Z",
      duration: "PT91S",
      publisher: {
        "@type": "Organization",
        name: "Jesus Film Project",
        url: "https://www.jesusfilm.org",
      },
      potentialAction: {
        "@type": "WatchAction",
        target: "https://www.jesusfilm.org/watch/life.html/english.html",
      },
    })
  })
})
