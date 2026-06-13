import { getWatchSeoManifest } from "@/lib/watch-seo-manifest"
import {
  normalizeWatchSitemapChunkId,
  renderWatchSitemapChunk,
} from "@/lib/watch-sitemap"

const XML_HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  "Content-Type": "application/xml; charset=utf-8",
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
    return new Response("Watch sitemap unavailable", {
      status: 503,
      headers: {
        "Cache-Control": "public, max-age=60",
        "Content-Type": "text/plain; charset=utf-8",
      },
    })
  }

  const xml = renderWatchSitemapChunk(manifest, id)
  if (!xml) {
    return new Response("Sitemap chunk not found", { status: 404 })
  }

  return new Response(xml, {
    status: 200,
    headers: XML_HEADERS,
  })
}
