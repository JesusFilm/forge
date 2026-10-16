export type WatchSearchUrlState = {
  query: string
  languageSlug: string | null
}

export function readWatchSearchUrl(search: string): WatchSearchUrlState | null {
  const params = new URLSearchParams(search)
  const query = params.get("q")?.trim() ?? ""
  if (!query) return null
  return { query, languageSlug: params.get("lang") }
}

export function writeWatchSearchUrl(
  mode: "push" | "replace",
  query: string,
  languageSlug: string | null,
): void {
  const url = new URL(window.location.href)
  const trimmedQuery = query.trim()
  if (trimmedQuery) {
    url.searchParams.set("q", trimmedQuery)
    if (languageSlug) url.searchParams.set("lang", languageSlug)
    else url.searchParams.delete("lang")
  } else {
    url.searchParams.delete("q")
    url.searchParams.delete("lang")
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (nextUrl === currentUrl) return
  const state = window.history.state
  window.history[`${mode}State`](state, "", nextUrl)
}
