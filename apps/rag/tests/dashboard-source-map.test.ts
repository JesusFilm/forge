/**
 * Unit tests for the source-ledger extension of the dashboard compile step
 * (issue #100): one row per SOURCE with per-language chips, plus the
 * documented-only sources (proposed / retired) curated in docs/source-map.yaml.
 *
 * Written TDD-first: these pin the new grouped `source_rows` + `documented`
 * sections of compiled-data.json, the chip semantics (language + count only;
 * stage as a state string), the gap notes, and the merge-gate coverage of the
 * new HTML shape — while the existing per-cell `sources` rows and the
 * secondary Unclassified table (#86) stay intact.
 */
import { describe, it, expect } from "vitest"
import {
  buildCompiledData,
  renderHtml,
  assertHtmlContainsData,
} from "../scripts/lib/dashboard/compile.js"
import type {
  ProdStatusData,
  RegistrySource,
  SourceMap,
  YamlSources,
} from "../scripts/lib/dashboard/types.js"

const registry: RegistrySource[] = [
  {
    key: "cru",
    name: "Cru",
    domain: "www.cru.org",
    languages: ["en", "es", "fr"],
  },
  { key: "thelife", name: "thelife", domain: "thelife.com", languages: ["en"] },
  {
    key: "thelife-fr",
    name: "thelife — French",
    domain: "laviejenparle.com",
    languages: ["fr"],
  },
  {
    key: "everystudent",
    name: "EveryStudent",
    domain: "www.everystudent.com",
    languages: ["en"],
  },
]

const yaml: YamlSources = {
  cru: {
    name: "Cru",
    status: "done",
    languages: {
      en: { evaluateGreen: true, status: "done", note: null },
      es: { evaluateGreen: true, status: "done", note: null },
      fr: { evaluateGreen: false, status: "done", note: "n=1 marketing doc" },
    },
  },
  thelife: {
    name: "thelife (Cru Canada)",
    status: "done",
    languages: { en: { evaluateGreen: true, status: "done", note: null } },
  },
  "thelife-fr": {
    name: "thelife — French (La Vie J'en Parle)",
    status: "in-progress",
    languages: {
      fr: { evaluateGreen: false, status: "in-progress", note: null },
    },
  },
  everystudent: {
    name: "EveryStudent",
    status: "blocked",
    languages: {
      en: {
        evaluateGreen: false,
        status: "blocked",
        note: "Cloudflare challenge",
      },
    },
  },
}

const prod: ProdStatusData = {
  schema_version: 1,
  target: "production-read",
  fetched_at: "2026-07-16T12:00:00.000Z",
  source_commit: "0123456789abcdef0123456789abcdef01234567",
  schema_digest:
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ingested: [
    {
      key: "cru",
      name: "Cru",
      host: "www.cru.org",
      language: "en",
      embedded_doc_count: 1949,
    },
    {
      key: "cru",
      name: "Cru",
      host: "www.cru.org",
      language: "es",
      embedded_doc_count: 494,
    },
    {
      key: "cru",
      name: "Cru",
      host: "www.cru.org",
      language: "fr",
      embedded_doc_count: 1,
    },
    {
      key: "thelife",
      name: "thelife",
      host: "thelife.com",
      language: "en",
      embedded_doc_count: 4513,
    },
  ],
  acquired_keys: ["cru", "thelife", "thelife-fr"],
  unclassified: [],
}

const sourceMap: SourceMap = {
  gaps: {
    thelife: {
      missing:
        "fa = shagerdan.com, Cloudflare-walled — Firecrawl or Cru allowlist (#8).",
      pending: [{ label: "fa", state: "blocked", detail: "~2.9k" }],
    },
    everystudent: {
      host: "www.everystudent.com",
      missing: "English flagship behind a Cloudflare JS challenge.",
      pending: [
        { label: "51 sibling domains", state: "proposed", detail: "≤15k" },
      ],
    },
  },
  documented: {
    gotquestions: {
      name: "GotQuestions",
      host: "www.gotquestions.org",
      state: "proposed",
      method: "plain scrape",
      languages: "en",
      est_size: "1.5k–100k+",
      note: "No wall (jfa: 342 chunks @ 1,500-page cap). Decision needed: crawl scope.",
    },
    powertochange: {
      name: "Power to Change",
      host: "powertochange.com",
      state: "retired",
      method: "plain scrape",
      languages: "en",
      est_size: "—",
      note: "Superseded — decommissioned; content migrated to thelife.com.",
    },
  },
}

function build() {
  return buildCompiledData({
    prod,
    yaml,
    registry,
    sourceMap,
    generatedAt: "2026-07-16",
  })
}

function sourceRow(key: string) {
  const row = build().source_rows.find((r) => r.key === key)
  if (!row) throw new Error(`no source row for ${key}`)
  return row
}

describe("source_rows — one row per source with language chips", () => {
  it("groups all of a source's languages into one row with per-language chips", () => {
    const cru = sourceRow("cru")
    expect(cru.languages.map((c) => c.label)).toEqual(["en", "es", "fr"])
    expect(cru.docs_in_prod).toBe(2444)
  })

  it("chip state: evaluated when the cell evaluates; ingested when in prod without eval", () => {
    const cru = sourceRow("cru")
    const byLabel = new Map(cru.languages.map((c) => [c.label, c]))
    expect(byLabel.get("en")?.state).toBe("evaluated")
    expect(byLabel.get("en")?.embedded_doc_count).toBe(1949)
    expect(byLabel.get("fr")?.state).toBe("ingested") // ingested, evaluate not green
    expect(byLabel.get("fr")?.embedded_doc_count).toBe(1)
  })

  it("chip state: acquired-only cell gets an acquired chip with no doc count", () => {
    const fr = sourceRow("thelife-fr")
    expect(fr.languages).toEqual([
      {
        label: "fr",
        language: "fr",
        state: "acquired",
        embedded_doc_count: null,
        detail: null,
      },
    ])
    expect(fr.docs_in_prod).toBe(0)
  })

  it("chips are ordered by doc count desc, pending chips last", () => {
    const thelife = sourceRow("thelife")
    expect(thelife.languages.map((c) => c.label)).toEqual(["en", "fa"])
    expect(thelife.languages[1]).toEqual({
      label: "fa",
      language: null, // a pending chip is not a pipeline cell
      state: "blocked",
      embedded_doc_count: null,
      detail: "~2.9k",
    })
  })

  it("a blocked source with nothing in prod is state=blocked in the blocked group, with 0 docs", () => {
    const es = sourceRow("everystudent")
    expect(es.state).toBe("blocked")
    expect(es.group).toBe("blocked")
    expect(es.docs_in_prod).toBe(0)
    // pending chip from source-map lands after the blocked en cell
    expect(es.languages.map((c) => [c.label, c.state])).toEqual([
      ["en", "blocked"],
      ["51 sibling domains", "proposed"],
    ])
    // display host falls back to the source-map gap host when registry/prod have none
    expect(es.host).toBe("www.everystudent.com")
  })

  it("gap notes land as the row's missing text; sources without gaps get null", () => {
    expect(sourceRow("thelife").missing).toContain("shagerdan.com")
    expect(sourceRow("cru").missing).toBeNull()
  })

  it("groups: production rows sort by docs desc; production before blocked", () => {
    const rows = build().source_rows
    const production = rows
      .filter((r) => r.group === "production")
      .map((r) => r.key)
    expect(production).toEqual(["thelife", "cru"]) // 4,513 > 2,444
    const groups = rows.map((r) => r.group)
    expect(groups.indexOf("blocked")).toBeGreaterThan(
      groups.lastIndexOf("production"),
    )
  })

  it("source state pill is the furthest stage any language reached", () => {
    expect(sourceRow("cru").state).toBe("evaluated")
    expect(sourceRow("thelife-fr").state).toBe("acquired")
  })

  it("counts unclassified live documents in the source total without creating a language chip", () => {
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
    const cru = data.source_rows.find((row) => row.key === "cru")

    expect(cru?.docs_in_prod).toBe(2634)
    expect(cru?.group).toBe("production")
    expect(cru?.languages.map((chip) => chip.label)).toEqual(["en", "es", "fr"])
    expect(data.unclassified).toHaveLength(1)
  })

  it("shows a source with only unclassified live documents as ingested production", () => {
    const data = buildCompiledData({
      prod: {
        ...prod,
        unclassified: [
          {
            key: "everystudent",
            name: "EveryStudent",
            host: "www.everystudent.com",
            embedded_doc_count: 7,
          },
        ],
      },
      yaml,
      registry,
      sourceMap,
      generatedAt: "2026-07-16",
    })
    const unclassifiedOnly = data.source_rows.find(
      (row) => row.key === "everystudent",
    )

    expect(unclassifiedOnly).toMatchObject({
      source: "EveryStudent",
      host: "www.everystudent.com",
      state: "ingested",
      group: "production",
      docs_in_prod: 7,
    })
    expect(
      unclassifiedOnly?.languages.map((chip) => [chip.label, chip.state]),
    ).toEqual([
      ["en", "blocked"],
      ["51 sibling domains", "proposed"],
    ])
  })
})

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
