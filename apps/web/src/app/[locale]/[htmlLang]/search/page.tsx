import type { Metadata } from "next"
import type { Route } from "next"
import { redirect } from "next/navigation"

/**
 * /search is deprecated. The canonical search surface is now the global
 * floating search modal, which opens automatically on any route when the
 * URL contains ?q=. Redirect visitors to the home route and forward the
 * query so existing shareable links keep working.
 *
 * SearchInput and SearchResults components under apps/web/src/components/search/
 * are intentionally preserved because /demo-search transitively imports them.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

type PageProps = {
  searchParams: Promise<{ q?: string }>
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams
  // Clamp to the same 200-char cap the provider enforces so a crafted
  // /search?q=<huge string> can't produce an unbounded Location header.
  const trimmed = (q ?? "").trim().slice(0, 200)
  const target = trimmed.length > 0 ? `/?q=${encodeURIComponent(trimmed)}` : "/"
  redirect(target as Route)
}
