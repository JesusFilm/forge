/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import VideosPage, { metadata } from "@/app/[locale]/[htmlLang]/videos/page"

describe("/videos route", () => {
  it("renders 200 with All Videos heading", async () => {
    const page = await VideosPage({
      params: Promise.resolve({ locale: "en", htmlLang: "en" }),
    })
    const html = renderToString(page)
    expect(html).toContain("All Videos")
  })

  it("declares canonical URL with .html-free /videos shape", () => {
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/videos",
    )
  })

  it("does not include .html suffix in canonical (production contract)", () => {
    const canonical = metadata.alternates?.canonical
    expect(String(canonical)).not.toContain(".html")
  })
})
