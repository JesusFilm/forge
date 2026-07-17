// Pure paging loop for the global language list (React-free, fetcher-injected
// so jest exercises the paging contract without Apollo).

import type { RawChildDubLanguage } from "./normalizeVideo"

/** Mirrors the server-side cap on Query.languages (apps/admin reference.ts). */
export const LANGUAGES_PAGE_SIZE = 500

// Defensive ceiling: ~6k rows ≫ the ~2.2k real language corpus, so a server
// that ignored `offset` can't loop the client forever.
export const MAX_LANGUAGE_PAGES = 12

/**
 * Collect every language page until a short page marks the end. Rejects when
 * any page fetch rejects — the caller surfaces one retryable error state.
 */
export async function collectAllLanguages(
  fetchPage: (offset: number) => Promise<readonly RawChildDubLanguage[]>,
): Promise<RawChildDubLanguage[]> {
  const all: RawChildDubLanguage[] = []
  for (let page = 0; page < MAX_LANGUAGE_PAGES; page++) {
    const rows = await fetchPage(page * LANGUAGES_PAGE_SIZE)
    all.push(...rows)
    if (rows.length < LANGUAGES_PAGE_SIZE) break
  }
  return all
}
