import { describe, expect, it } from "vitest"
import { assertHtmlContainsData } from "../scripts/lib/dashboard/verify.js"
import {
  buildCompiledData,
  renderHtml,
} from "../scripts/lib/dashboard/compile.js"
import {
  build,
  prod,
  registry,
  sourceMap,
  yaml,
} from "./dashboard-source-map.fixtures.js"

describe("documented — proposed / retired sources from source-map.yaml", () => {
  it("compiles documented sources with their method, size and note, proposed before retired", () => {
    const documented = build().documented
    expect(documented.map((d) => [d.key, d.state])).toEqual([
      ["gotquestions", "proposed"],
      ["powertochange", "retired"],
    ])
    const gq = documented[0]
    expect(gq.method).toBe("plain scrape")
    expect(gq.est_size).toBe("1.5k–100k+")
    expect(gq.note).toContain("crawl scope")
  })

  it("per-cell `sources` rows are still emitted unchanged (canonical data preserved)", () => {
    const cells = build()
      .sources.map((r) => `${r.key}/${r.language}`)
      .sort()
    expect(cells).toEqual([
      "cru/en",
      "cru/es",
      "cru/fr",
      "everystudent/en",
      "thelife-fr/fr",
      "thelife/en",
    ])
  })

  it("builds are deterministic", () => {
    expect(JSON.stringify(build())).toEqual(JSON.stringify(build()))
  })
})

describe("renderHtml — the ledger page", () => {
  const TEMPLATE = `<!doctype html><html><body>
    <p>Updated <!-- DASHBOARD_GENERATED_AT --></p><!-- DASHBOARD_SUMMARY -->
    <table><tbody><!-- DASHBOARD_ROWS --></tbody></table>
    <section><!-- DASHBOARD_UNCLASSIFIED --></section>
  </body></html>`

  it("renders one <tr data-key> per source row containing its chips with counts", () => {
    const html = renderHtml(TEMPLATE, build())
    expect(html).toContain('<tr data-key="cru"')
    const cruRow = html.slice(html.indexOf('<tr data-key="cru"'))
    const cruTr = cruRow.slice(0, cruRow.indexOf("</tr>"))
    expect(cruTr).toContain('data-language="en"')
    expect(cruTr).toContain("1,949")
    expect(cruTr).toContain('data-language="es"')
    expect(cruTr).toContain("494")
  })

  it("renders group separator rows and documented rows", () => {
    const html = renderHtml(TEMPLATE, build())
    expect(html).toContain("In production")
    expect(html).toContain("Blocked")
    expect(html).toContain("Proposed")
    expect(html).toContain("Retired")
    expect(html).toContain('data-documented-key="gotquestions"')
    expect(html).toContain("GotQuestions")
    expect(html).toContain('data-documented-key="powertochange"')
  })

  it("pending chips render with their label and detail", () => {
    const html = renderHtml(TEMPLATE, build())
    expect(html).toContain("51 sibling domains")
    expect(html).toContain("~2.9k")
  })

  it("renders no unclassified section at all when nothing is unclassified", () => {
    const html = renderHtml(TEMPLATE, build())
    expect(html).not.toContain("Unclassified documents")
    expect(html).not.toContain("data-unclassified-key")
  })

  it("still renders the secondary unclassified table when prod reports null-language docs (#86)", () => {
    const data = buildCompiledData({
      prod: {
        ...prod,
        unclassified: [
          {
            key: "cru",
            name: "Cru",
            host: "www.cru.org",
            embedded_doc_count: 190,
          },
        ],
      },
      yaml,
      registry,
      sourceMap,
      generatedAt: "2026-07-16",
    })
    const html = renderHtml(TEMPLATE, data)
    expect(html).toContain('data-unclassified-key="cru"')
    expect(html).toContain("190")
    expect(assertHtmlContainsData(html, data)).toEqual([])
  })
})

describe("assertHtmlContainsData — the merge gate on the new shape", () => {
  const TEMPLATE = `<!doctype html><html><body>
    <p><!-- DASHBOARD_GENERATED_AT --></p>
    <table><tbody><!-- DASHBOARD_ROWS --></tbody></table>
    <section><!-- DASHBOARD_UNCLASSIFIED --></section>
  </body></html>`

  it("passes on a faithfully rendered page", () => {
    const data = build()
    expect(assertHtmlContainsData(renderHtml(TEMPLATE, data), data)).toEqual([])
  })

  it("catches a language chip dropped from a source row", () => {
    const data = build()
    const html = renderHtml(TEMPLATE, data).replace(
      /<span[^>]*data-language="es"[\s\S]*?<\/span><\/span>/,
      "",
    )
    const misses = assertHtmlContainsData(html, data)
    expect(misses.join(" ")).toContain("cru")
    expect(misses.join(" ")).toContain("es")
  })

  it("catches a dropped documented row", () => {
    const data = build()
    const html = renderHtml(TEMPLATE, data).replace(
      /<tr data-documented-key="gotquestions"[\s\S]*?<\/tr>/,
      "",
    )
    expect(assertHtmlContainsData(html, data).join(" ")).toContain(
      "gotquestions",
    )
  })

  it("catches a dropped source row", () => {
    const data = build()
    const html = renderHtml(TEMPLATE, data).replace(
      /<tr data-key="thelife"[\s\S]*?<\/tr>/,
      "",
    )
    expect(assertHtmlContainsData(html, data).join(" ")).toContain("thelife")
  })

  it("catches a pending chip whose detail annotation was dropped", () => {
    const data = build()
    // "~2.9k" is the fa pending chip's detail and appears nowhere else.
    const html = renderHtml(TEMPLATE, data).replace("~2.9k", "")
    const misses = assertHtmlContainsData(html, data)
    expect(misses.join(" ")).toContain("thelife/fa")
    expect(misses.join(" ")).toContain("detail")
  })

  it("catches a documented row whose est_size / note drifted from the HTML", () => {
    const data = build()
    const sized = renderHtml(TEMPLATE, data).replace("1.5k–100k+", "")
    expect(assertHtmlContainsData(sized, data).join(" ")).toContain(
      "documented/gotquestions",
    )
    const noted = renderHtml(TEMPLATE, data).replace(
      "crawl scope",
      "different text",
    )
    expect(assertHtmlContainsData(noted, data).join(" ")).toContain(
      "documented/gotquestions",
    )
  })
})
