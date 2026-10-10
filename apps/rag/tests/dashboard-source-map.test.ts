import { describe, expect, it } from "vitest"
import { buildCompiledData } from "../scripts/lib/dashboard/compile.js"
import {
  build,
  prod,
  registry,
  sourceMap,
  sourceRow,
  yaml,
} from "./dashboard-source-map.fixtures.js"

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
