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
      alternatesLanguages: {
        en: "https://www.jesusfilm.org/watch/life.html/english.html",
      },
    })

    expect(json).not.toContain("<")
    expect(JSON.parse(json)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: "Life < Jesus",
      description: "A story with <script> content.",
      url: "https://www.jesusfilm.org/watch/life.html/english.html",
      thumbnailUrl: ["https://image.mux.com/pb/thumbnail.jpg"],
      inLanguage: "en",
      duration: "PT91S",
    })
  })
})
