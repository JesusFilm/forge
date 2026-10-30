import { z } from "zod"
import { watchSurfaceItemPath } from "./watch-surface-path"
export {
  watchSurfaceHrefNeedsDocumentPathname,
  watchSurfaceItemPath,
} from "./watch-surface-path"

export const watchSurfaceManifestSchema = z
  .object({
    surface: z.enum([
      "watch-home",
      "watch-search",
      "watch-video",
      "watch-series",
    ]),
    block: z.enum([
      "hero",
      "collections",
      "authored",
      "results",
      "editorial",
      "chapters",
      "episodes",
    ]),
    presentation: z.enum([
      "hero-card",
      "carousel",
      "grid",
      "result-list",
      "authored-block",
      "episode-grid",
    ]),
    placement: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    policyVersion: z.literal("watch-exposure-v2"),
    items: z
      .array(
        z
          .object({
            position: z.number().int().min(0).max(99),
            itemPath: z
              .string()
              .regex(
                /^\/watch\/[a-zA-Z0-9_-]+\.html(?:\/[a-zA-Z0-9_-]+\.html){0,2}$/,
              ),
          })
          .strict(),
      )
      .max(100),
    sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.string().datetime(),
  })
  .strict()
export type WatchSurfaceManifest = z.infer<typeof watchSurfaceManifestSchema>
export type SignedWatchSurfaceManifest = {
  manifest: WatchSurfaceManifest
  signature: string
}
export const signedWatchSurfaceManifestSchema = z
  .object({
    manifest: watchSurfaceManifestSchema,
    signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()
export type WatchSurfaceConfig = Pick<
  WatchSurfaceManifest,
  "surface" | "block" | "presentation" | "placement"
>
export type WatchSurfaceManifestSource = WatchSurfaceConfig & {
  items: WatchSurfaceManifest["items"]
}

export function watchSurfaceSource(
  config: WatchSurfaceConfig,
  hrefs: readonly (string | null | undefined)[],
  nextLink = true,
): WatchSurfaceManifestSource {
  const paths = hrefs
    .flatMap((href) => {
      const path = watchSurfaceItemPath(href, nextLink)
      return path ? [path] : []
    })
    .slice(0, 100)
  return {
    ...config,
    items: paths.map((itemPath, position) => ({ position, itemPath })),
  }
}
