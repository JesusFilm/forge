// Types for catalogOps.js, for the TypeScript suites in src/i18n/__tests__/.

export type FlatCatalog = Record<string, string>

export type TranslationPolicy = {
  humanReviewedLocales: string[]
  intentionallyLocaleNeutral: string[]
  englishOnlyLocales: string[]
  /** Key to the YYYY-MM-DD date that it went pending. */
  pendingKeys: Record<string, string>
}

export type SourceRecord = {
  /** Key to the first 16 hex characters of the SHA-256 of its English text. */
  englishHashes: Record<string, string>
}

export const SOURCE_LOCALE: "en"
export function englishHash(text: string): string
export function flattenCatalog(tree: unknown): FlatCatalog
export function unflattenCatalog(flat: FlatCatalog): Record<string, unknown>
export function normalizePolicy(raw: unknown, label?: string): TranslationPolicy
export function normalizeRecord(raw: unknown, label?: string): SourceRecord
export function renderJson(value: unknown): string
