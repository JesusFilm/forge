import { getWatchSeoManifest } from "@/lib/watch-seo-manifest"
import { logWatchServerEvent } from "@/lib/watch-observability"
import {
  WatchSitemapGenerationError,
  normalizeWatchSitemapChunkId,
  renderWatchSitemapChunk,
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: rawId } = await context.params
  const id = normalizeWatchSitemapChunkId(rawId)
  if (id === null) {
    return new Response("Sitemap chunk not found", { status: 404 })
  }

  const manifest = await getWatchSeoManifest()
  if (!manifest) {
    return unavailableResponse()
  }

  try {
    const xml = renderWatchSitemapChunk(manifest, id)
    if (!xml) {
      return new Response("Sitemap chunk not found", { status: 404 })
    }

    return new Response(xml, {
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
        chunk_id: id,
        code:
          error instanceof WatchSitemapGenerationError
            ? error.code
            : "unexpected",
        limit:
          error instanceof WatchSitemapGenerationError
            ? error.details.limit
            : undefined,
        manifest_version: manifest.version,
        route: "child",
      },
      { level: "error" },
    )
    return unavailableResponse()
  }
}
