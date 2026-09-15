import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8")

describe("subtitle translation eval registration", () => {
  it("registers the one-cell workflow and exactly one protected service route", () => {
    expect(indexSource).toMatch(
      /workflows:\s*\{[\s\S]*subtitleTranslationEvalWorkflow,/u,
    )
    expect(
      indexSource.match(
        /registerApiRoute\("\/forge-subtitle-translation-eval"/gu,
      ) ?? [],
    ).toHaveLength(1)

    const start = indexSource.indexOf(
      'registerApiRoute("/forge-subtitle-translation-eval"',
    )
    const next = indexSource.indexOf("registerApiRoute(", start + 1)
    const route = indexSource.slice(start, next)
    expect(route).toContain("handleSubtitleTranslationEvalRouteRequest")
    expect(route).toContain("serviceKeys")
  })
})
