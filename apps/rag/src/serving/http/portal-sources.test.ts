import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { allSources } from "../../registry/index.js"
import { fixture } from "./portal-fixture.test-support.js"
import { createPortal } from "./portal.js"
import {
  projectPortalSources,
  createPortalSourcesReader,
} from "./portal-sources.js"
import { portalSourceBrands } from "./portal-source-brands.js"

const row = (
  key: string,
  host: string,
  language: string,
  documents: number,
) => ({ key, source: key, host, language, embedded_doc_count: documents })
const snapshot = () => ({
  schema_version: 1,
  provenance: {
    target: "production-read",
    fetched_at: "2026-09-22T03:52:08.959Z",
  },
  sources: [
    row("one", "one.example", "en", 5),
    row("one", "one.example", "fr", 2),
    row("two", "two.example", "fr", 3),
    row("two", "two.example", "nl", 4),
    row("new", "new.example", "en", 0),
  ],
  unclassified: [
    { key: "one", source: "one", host: "one.example", embedded_doc_count: 1 },
  ],
  source_rows: [
    { key: "one", docs_in_prod: 8 },
    { key: "two", docs_in_prod: 7 },
    { key: "new", docs_in_prod: 0 },
  ],
})
const declarations = [
  { key: "one", languages: ["en", "fr", "nl"] },
  { key: "two", languages: ["fr"] },
]
const brands = [{ id: "brand", name: "Brand", sourceKeys: ["one", "two"] }]

describe("portal source facade", () => {
  it("folds domains and languages independently, preserving totals and per-domain anomalies", () => {
    const input = snapshot()
    const before = structuredClone(input)
    const result = projectPortalSources(input, declarations, brands)
    expect(input).toEqual(before)
    expect(result.observedAt).toBe(input.provenance.fetched_at)
    expect(result.totals).toEqual({ sources: 1, documents: 15, languages: 3 })
    const source = result.sources[0]
    expect(source.domains).toEqual([
      { host: "one.example", documents: 8 },
      { host: "two.example", documents: 7 },
    ])
    expect(
      source.languages.find((language) => language.code === "fr"),
    ).toMatchObject({
      documents: 5,
      domains: [{ documents: 2 }, { documents: 3 }],
    })
    // Dutch expected on one member must not conceal unexpected Dutch on another.
    expect(
      source.languages.find((language) => language.code === "nl")?.domains,
    ).toEqual([
      {
        host: "two.example",
        documents: 4,
        unexpected: true,
        expectationUnknown: false,
      },
    ])
    expect(
      source.languages.find((language) => language.code === null)?.documents,
    ).toBe(1)
    expect(JSON.stringify(result)).not.toMatch(
      /evaluate|ingest|lifecycle|sourceKeys|one"/,
    )
  })
  it("keeps unmapped brands independent and includes production with unidentified documents only", () => {
    const input = snapshot()
    input.unclassified.push({
      key: "brand",
      source: "New brand",
      host: "another.example",
      embedded_doc_count: 2,
    })
    input.source_rows.push({ key: "brand", docs_in_prod: 2 })
    const result = projectPortalSources(input, declarations, brands)
    expect(result.totals).toEqual({ sources: 2, documents: 17, languages: 3 })
    expect(result.sources.map((source) => source.id)).toEqual([
      "brand:brand",
      "source:brand",
    ])
    expect(
      projectPortalSources(snapshot(), declarations, []).sources,
    ).toHaveLength(2)
  })
  it("does not infer grouping from prefixes and marks missing declarations honestly", () => {
    const input = snapshot()
    input.sources.push(row("one-fr", "elsewhere.example", "fr", 1))
    input.source_rows.push({ key: "one-fr", docs_in_prod: 1 })
    const result = projectPortalSources(input, declarations, brands)
    expect(result.sources).toHaveLength(2)
    expect(
      result.sources.find((source) => source.id === "source:one-fr")
        ?.languages[0].domains[0],
    ).toMatchObject({ expectationUnknown: true, unexpected: false })
  })
  it("refuses duplicate membership, duplicate cells, contradictory identities and inconsistent totals", () => {
    expect(() =>
      projectPortalSources(snapshot(), declarations, [
        ...brands,
        { id: "other", name: "Other", sourceKeys: ["two"] },
      ]),
    ).toThrow("sources_snapshot_invalid")
    for (const corrupt of [
      (input: ReturnType<typeof snapshot>) =>
        input.sources.push(input.sources[0]),
      (input: ReturnType<typeof snapshot>) => {
        input.sources[0].host = "wrong.example"
      },
      (input: ReturnType<typeof snapshot>) => {
        input.source_rows[0].docs_in_prod++
      },
      (input: ReturnType<typeof snapshot>) => {
        input.source_rows.pop()
      },
    ]) {
      const input = snapshot()
      corrupt(input)
      expect(() => projectPortalSources(input, declarations, brands)).toThrow(
        "sources_snapshot_invalid",
      )
    }
  })
  it("reads the packaged committed snapshot and conserves all counts without inferred memberships", async () => {
    const input = JSON.parse(
      readFileSync(
        new URL("../../../dashboard/compiled-data.json", import.meta.url),
        "utf8",
      ),
    )
    const result = await createPortalSourcesReader(allSources())()
    expect(result.totals.documents).toBe(
      input.source_rows.reduce(
        (sum: number, source: { docs_in_prod: number }) =>
          sum + source.docs_in_prod,
        0,
      ),
    )
    expect(result.totals.sources).toBeLessThan(input.source_rows.length)
    expect(result.totals.languages).toBe(
      new Set(
        input.sources
          .filter(
            (row: { embedded_doc_count: number }) => row.embedded_doc_count > 0,
          )
          .map((row: { language: string }) => row.language),
      ).size,
    )
    expect(result.sources.map((source) => source.name)).toEqual(
      expect.arrayContaining(["EveryStudent", "thelife", "Cru", "FamilyLife"]),
    )
    // A future translation must be reviewed into membership, not silently guessed.
    const members = new Set(
      portalSourceBrands.flatMap((brand) => brand.sourceKeys),
    )
    expect(
      allSources()
        .filter(
          (source) =>
            source.key.startsWith("everystudent") ||
            source.key.startsWith("thelife"),
        )
        .every((source) => members.has(source.key)),
    ).toBe(true)
  })
})

describe("portal sources HTTP", () => {
  it("requires current admission before loading the snapshot and revokes access immediately", async () => {
    const f = fixture()
    const read = vi.fn(async () =>
      projectPortalSources(snapshot(), declarations, brands),
    )
    const app = createPortal({ ...f.deps, sources: read })
    expect((await app.request("/sources")).status).toBe(401)
    expect(read).not.toHaveBeenCalled()
    f.sessions.set("fixture", { login: "engineer", id: 42 })
    const init = { headers: { Cookie: "__Host-rag_portal=fixture" } }
    const response = await app.request("/sources", init)
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toMatchObject({ totals: { documents: 15 } })
    f.setEligible(false)
    expect((await app.request("/sources", init)).status).toBe(401)
    expect(read).toHaveBeenCalledTimes(1)
    f.setEligible(true)
    f.setAllowed(false)
    expect((await app.request("/sources", init)).status).toBe(401)
    expect(read).toHaveBeenCalledTimes(1)
  })
  it("contains snapshot failures and keeps identity and other portal assets available", async () => {
    const f = fixture()
    f.sessions.set("fixture", { login: "engineer", id: 42 })
    const init = { headers: { Cookie: "__Host-rag_portal=fixture" } }
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("internal-path-do-not-disclose"))
      .mockResolvedValue(projectPortalSources(snapshot(), declarations, brands))
    const app = createPortal({ ...f.deps, sources: read })
    const failed = await app.request("/sources", init)
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({
      error: "sources_snapshot_unavailable",
    })
    expect((await app.request("/identity", init)).status).toBe(200)
    expect((await app.request("/", init)).status).toBe(200)
    expect((await app.request("/sources", init)).status).toBe(200)
    expect((await f.app.request("/sources", init)).status).toBe(503)
    expect(
      (await app.request("/sources", { ...init, method: "POST" })).status,
    ).toBe(404)
  })
})
