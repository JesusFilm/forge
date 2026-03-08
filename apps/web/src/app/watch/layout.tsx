import type { ReactNode } from "react"

/**
 * Shared layout for /watch/* routes. Wraps children so watch pages share a consistent shell.
 */
export default function WatchLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
