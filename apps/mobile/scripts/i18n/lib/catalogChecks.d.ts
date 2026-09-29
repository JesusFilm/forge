// Types for catalogChecks.js, for the TypeScript suites in src/i18n/__tests__/.

import type { FlatCatalog, SourceRecord, TranslationPolicy } from "./catalogOps"

export type CatalogProblem = {
  locale?: string
  key: string
  kind:
    | "missing"
    | "unexpected"
    | "untranslated"
    | "contract"
    | "unrecorded"
    | "stale"
    | "deleted"
    | "stale-placeholder"
  message?: string
}

export type Catalogs = Record<string, FlatCatalog>

export const API_MODEL_ID: RegExp
export const REAL_PATHS: {
  messagesDir: string
  policy: string
  contexts: string
  manifest: string
  provenance: string
  modelTable: string
  record: string
  nativeLocales: string
  webMessagesDir: string
  webManifest: string
}

export function catalogTagsIn(dir: string): string[]
export function readJson(file: string): unknown
export function readPolicy(file: string): TranslationPolicy
export function readRecord(file: string): SourceRecord
export function readCatalogDir(messagesDir: string): {
  source: FlatCatalog
  catalogs: Catalogs
}

export function contractError(
  key: string,
  source: string,
  value: unknown,
): string | null
export function pluralOperationError(
  key: string,
  source: string,
  value: unknown,
): string | null
export function describeProblem(problem: CatalogProblem): string

export function parityProblems(
  source: FlatCatalog,
  catalogs: Catalogs,
): CatalogProblem[]
export function untranslatedProblems(
  source: FlatCatalog,
  catalogs: Catalogs,
  policy: TranslationPolicy,
): CatalogProblem[]
export function contractProblems(
  source: FlatCatalog,
  catalogs: Catalogs,
): CatalogProblem[]
export function recordProblems(
  source: FlatCatalog,
  record: SourceRecord,
  policy: TranslationPolicy,
): CatalogProblem[]
export function stalePlaceholderProblems(
  source: FlatCatalog,
  catalogs: Catalogs,
  record: SourceRecord,
  policy: TranslationPolicy,
): CatalogProblem[]

export function policyProblems(
  raw: unknown,
  source: FlatCatalog,
  webTags: string[],
): string[]
export function contextProblems(raw: unknown, source: FlatCatalog): string[]
export function wordlessKeysNotNeutral(
  source: FlatCatalog,
  neutralKeys: string[],
): string[]
export function modelTableProblems(
  raw: unknown,
  webTags: string[],
  englishOnlyLocales: string[],
): string[]
export function manifestProblems(raw: unknown): string[]
export function provenanceProblems(
  raw: unknown,
  policy: TranslationPolicy,
): string[]

export function pendingSummary(
  source: FlatCatalog,
  catalogs: Catalogs,
  policy: TranslationPolicy,
): {
  count: number
  oldest: { key: string; since: string } | null
  keys: { key: string; since: string; englishIn: string[] }[]
}
