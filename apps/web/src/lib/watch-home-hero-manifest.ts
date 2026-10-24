import { watchSurfaceItemPath } from "./watch-surface-path"
import type {
  SignedWatchSurfaceManifest,
  WatchSurfaceManifest,
} from "./watch-surface-manifest"

/** Public origin capabilities; only the active singleton enters delivery. */
export type WatchHomeHeroManifestCatalog = {
  manifest: Omit<WatchSurfaceManifest, "items">
  items: readonly (readonly [itemPath: string, signature: string])[]
}

/** Selecting a known entry transports authority; it never creates authority. */
export function selectWatchHomeHeroManifest(
  catalog: WatchHomeHeroManifestCatalog | null | undefined,
  href: string | null | undefined,
): SignedWatchSurfaceManifest | null {
  if (!catalog) return null
  const itemPath = watchSurfaceItemPath(href)
  if (!itemPath) return null
  const entry = catalog.items.find(([path]) => path === itemPath)
  if (!entry) return null
  return {
    manifest: {
      ...catalog.manifest,
      items: [{ position: 0, itemPath }],
    },
    signature: entry[1],
  }
}
