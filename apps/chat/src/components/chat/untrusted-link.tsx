import { type ReactNode } from "react"

import { isHttpsUrl } from "@/lib/is-https-url"

type UntrustedLinkProps = {
  href: string | undefined
  // Rendered when the gate rejects `href`; defaults to the bare children.
  fallback?: ReactNode
  children: ReactNode
}

/**
 * The ONE anchor for untrusted URLs (RAG sources, Seeker markdown links —
 * feat-205/feat-268): https-only via the shared isHttpsUrl gate, opens in a
 * new tab with rel="noopener noreferrer". A failing or absent href renders
 * `fallback` (default: the children as plain text) — never a link. Shared by
 * sources-list and assistant-markdown so the two surfaces cannot drift.
 */
export function UntrustedLink({
  href,
  fallback,
  children,
}: UntrustedLinkProps) {
  if (typeof href === "string" && isHttpsUrl(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-vellum underline underline-offset-2 hover:text-linen"
      >
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    )
  }
  return <>{fallback ?? children}</>
}
