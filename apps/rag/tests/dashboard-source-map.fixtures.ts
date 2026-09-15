import { buildCompiledData } from "../scripts/lib/dashboard/compile.js"
import type {
  ProdStatusData,
  RegistrySource,
  SourceMap,
  YamlSources,
} from "../scripts/lib/dashboard/types.js"

export const registry: RegistrySource[] = [
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

export const yaml: YamlSources = {
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

export const prod: ProdStatusData = {
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

export const sourceMap: SourceMap = {
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

export function build() {
  return buildCompiledData({
    prod,
    yaml,
    registry,
    sourceMap,
  })
}

export function sourceRow(key: string) {
  const row = build().source_rows.find((r) => r.key === key)
  if (!row) throw new Error(`no source row for ${key}`)
  return row
}
