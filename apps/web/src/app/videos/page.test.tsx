/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import VideosPage, { metadata } from "@/app/videos/page"

describe("/videos route", () => {
  it("renders 200 with All Videos heading", () => {
    const html = renderToString(<VideosPage />)
    expect(html).toContain("All Videos")
  })

  it("declares canonical URL with .html-free /videos shape", () => {
    expect(metadata.alternates?.canonical).toMatch(/\/watch\/videos$/)
  })

  it("does not include .html suffix in canonical (production contract)", () => {
    const canonical = metadata.alternates?.canonical
    expect(String(canonical)).not.toContain(".html")
  })
})
