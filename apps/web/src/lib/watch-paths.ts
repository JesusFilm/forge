import { WATCH_BASE_PATH } from "../../watch-base-path.mjs"

export { WATCH_BASE_PATH }

export function watchPath(path = ""): string {
  if (!path) return WATCH_BASE_PATH
  return `${WATCH_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`
}

export function normalizeWatchRootHref(href: string | null | undefined) {
  if (href == null) return undefined
  return href?.trim() === "/" ? watchPath() : href
}
