import { getWatchSeoManifest } from "@/lib/watch-seo-manifest"
import { logWatchServerEvent } from "@/lib/watch-observability"
import {
  WatchSitemapGenerationError,
  renderWatchSitemapIndex,
  watchSitemapXmlHeaders,
} from "@/lib/watch-sitemap"

function unavailableResponse(): Response {
  return new Response("Watch sitemap unavailable", {
    status: 503,
    headers: {
      "Cache-Control": "public, max-age=60",
      "Content-Type": "text/plain; charset=utf-8",
    },
  })
}

export async function GET(): Promise<Response> {
  const manifest = await getWatchSeoManifest()
  if (!manifest) {
    return unavailableResponse()
  }

  try {
    return new Response(renderWatchSitemapIndex(manifest), {
      status: 200,
      headers: watchSitemapXmlHeaders(manifest.version),
    })
  } catch (error) {
    logWatchServerEvent(
      "watch_sitemap.generation.failed",
      {
        actual:
          error instanceof WatchSitemapGenerationError
            ? error.details.actual
            : undefined,
        code:
          error instanceof WatchSitemapGenerationError
            ? error.code
            : "unexpected",
        limit:
          error instanceof WatchSitemapGenerationError
            ? error.details.limit
            : undefined,
        manifest_version: manifest.version,
        route: "index",
      },
      { level: "error" },
    )
    return unavailableResponse()
  }
}
