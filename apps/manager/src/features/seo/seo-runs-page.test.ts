import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { SeoRunsPage } from "./seo-runs-page"

describe("SeoRunsPage", () => {
  it("renders the bounded all-jobs ledger without the mutation workspace", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SeoRunsPage, {
        page: {
          generatedAt: "2026-08-11T12:00:00.000Z",
          items: [],
          hasNextPage: false,
          nextCursor: null,
        },
        isDemo: false,
      }),
    )

    expect(markup).toContain("SEO workspace")
    expect(markup).toContain("Every job and its decisions")
    expect(markup).toContain("Admin ledger")
    expect(markup).toContain("No retained SEO runs")
  })
})
