/**
 * The link-protocol gate for UNTRUSTED content (RAG sources, Seeker markdown):
 * only an absolute https: URL may become an anchor — everything else (http:,
 * javascript:, data:, relative paths, garbage) renders as plain text. Shared
 * by sources-list and assistant-markdown so the discipline cannot diverge.
 */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:"
  } catch {
    return false
  }
}
