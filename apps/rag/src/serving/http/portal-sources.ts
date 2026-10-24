import { readFile } from "node:fs/promises"
import { z } from "zod"
import {
  portalSourceBrands,
  type PortalSourceBrand,
} from "./portal-source-brands.js"

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const identity = z.object({
  key: z.string().min(1),
  source: z.string().min(1),
  host: z.string().nullable(),
  embedded_doc_count: count,
})
// Narrow read boundary; lifecycle and editorial notes never enter the portal response.
const snapshotSchema = z.object({
  schema_version: z.literal(1),
  provenance: z.object({
    target: z.literal("production-read"),
    fetched_at: z.string().datetime({ offset: true }),
  }),
  sources: z.array(identity.extend({ language: z.string().min(1) })),
  unclassified: z.array(identity),
  source_rows: z.array(z.object({ key: z.string(), docs_in_prod: count })),
})

export type SourceDeclaration = { key: string; languages: readonly string[] }
export type PortalSourceDomain = { host: string | null; documents: number }
export type PortalSourceLanguage = {
  code: string | null
  documents: number
  domains: (PortalSourceDomain & {
    unexpected: boolean
    expectationUnknown: boolean
  })[]
}
export type PortalSource = {
  id: string
  name: string
  documents: number
  domains: PortalSourceDomain[]
  languages: PortalSourceLanguage[]
}
export type PortalSources = {
  observedAt: string
  sources: PortalSource[]
  totals: { sources: number; documents: number; languages: number }
}
class PortalSnapshotError extends Error {
  constructor() {
    super("sources_snapshot_invalid")
    this.name = "PortalSnapshotError"
  }
}

/** Pure display projection. Constituent key/language counts are never rewritten. */
export function projectPortalSources(
  input: unknown,
  declarations: readonly SourceDeclaration[],
  brands: readonly PortalSourceBrand[] = portalSourceBrands,
): PortalSources {
  const parsed = snapshotSchema.safeParse(input)
  if (!parsed.success) throw new PortalSnapshotError()
  const snapshot = parsed.data
  const membership = new Map<string, PortalSourceBrand>()
  const ids = new Set<string>()
  for (const brand of brands) {
    if (
      ids.has(brand.id) ||
      !brand.id ||
      !brand.name ||
      !brand.sourceKeys.length
    )
      throw new PortalSnapshotError()
    ids.add(brand.id)
    for (const key of brand.sourceKeys) {
      if (membership.has(key)) throw new PortalSnapshotError()
      membership.set(key, brand)
    }
  }
  const expected = new Map(
    declarations.map((source) => [source.key, source.languages]),
  )
  const sources = new Map<string, PortalSource>()
  const seen = new Set<string>()
  const perKey = new Map<string, number>()
  const sourceIdentities = new Map<string, string>()
  const rows = [
    ...snapshot.sources.map((row) => ({
      ...row,
      code: row.language as string | null,
    })),
    ...snapshot.unclassified.map((row) => ({ ...row, code: null })),
  ]
  for (const row of rows) {
    const cell = JSON.stringify([row.key, row.code])
    const sourceIdentity = JSON.stringify([row.source, row.host])
    if (
      seen.has(cell) ||
      (sourceIdentities.has(row.key) &&
        sourceIdentities.get(row.key) !== sourceIdentity)
    )
      throw new PortalSnapshotError()
    seen.add(cell)
    sourceIdentities.set(row.key, sourceIdentity)
    perKey.set(row.key, (perKey.get(row.key) ?? 0) + row.embedded_doc_count)
    if (!row.embedded_doc_count) continue
    const brand = membership.get(row.key)
    // Namespaced display IDs cannot collide with an ungrouped ingestion key.
    const id = brand ? `brand:${brand.id}` : `source:${row.key}`
    let source = sources.get(id)
    if (!source) {
      source = {
        id,
        name: brand?.name ?? row.source,
        documents: 0,
        domains: [],
        languages: [],
      }
      sources.set(id, source)
    }
    source.documents += row.embedded_doc_count
    let domain = source.domains.find((entry) => entry.host === row.host)
    if (!domain) {
      domain = { host: row.host, documents: 0 }
      source.domains.push(domain)
    }
    domain.documents += row.embedded_doc_count
    let language = source.languages.find((entry) => entry.code === row.code)
    if (!language) {
      language = { code: row.code, documents: 0, domains: [] }
      source.languages.push(language)
    }
    language.documents += row.embedded_doc_count
    const declared = expected.get(row.key)
    const unexpected =
      row.code !== null &&
      declared !== undefined &&
      !declared.includes(row.code)
    const expectationUnknown = row.code !== null && declared === undefined
    let contribution = language.domains.find(
      (entry) =>
        entry.host === row.host &&
        entry.unexpected === unexpected &&
        entry.expectationUnknown === expectationUnknown,
    )
    if (!contribution) {
      contribution = {
        host: row.host,
        documents: 0,
        unexpected,
        expectationUnknown,
      }
      language.domains.push(contribution)
    }
    contribution.documents += row.embedded_doc_count
  }
  const ledgerKeys = new Set<string>()
  for (const row of snapshot.source_rows) {
    if (
      ledgerKeys.has(row.key) ||
      row.docs_in_prod !== (perKey.get(row.key) ?? 0)
    )
      throw new PortalSnapshotError()
    ledgerKeys.add(row.key)
  }
  if ([...perKey.keys()].some((key) => !ledgerKeys.has(key)))
    throw new PortalSnapshotError()
  const result = [...sources.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )
  for (const source of result) {
    source.domains.sort((a, b) =>
      (a.host ?? "").localeCompare(b.host ?? "", "en"),
    )
    source.languages.sort((a, b) =>
      (a.code ?? "~").localeCompare(b.code ?? "~", "en"),
    )
  }
  return {
    observedAt: snapshot.provenance.fetched_at,
    sources: result,
    totals: {
      sources: result.length,
      documents: result.reduce((sum, source) => sum + source.documents, 0),
      languages: new Set(
        result.flatMap((source) =>
          source.languages.flatMap((language) =>
            language.code === null ? [] : [language.code],
          ),
        ),
      ).size,
    },
  }
}

/** Lazy, release-scoped snapshot. A failed read can be retried; it never stops serving. */
export function createPortalSourcesReader(
  declarations: readonly SourceDeclaration[],
) {
  let pending: Promise<PortalSources> | undefined
  return () => {
    pending ??= readFile(
      new URL("../../../dashboard/compiled-data.json", import.meta.url),
      "utf8",
    )
      .then((text) => projectPortalSources(JSON.parse(text), declarations))
      .catch(() => {
        pending = undefined
        throw new PortalSnapshotError()
      })
    return pending
  }
}
