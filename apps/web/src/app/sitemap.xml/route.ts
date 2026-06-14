import { getWatchSeoManifest } from "@/lib/watch-seo-manifest"
import { renderWatchSitemapIndex } from "@/lib/watch-sitemap"

const XML_HEADERS = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  "Content-Type": "application/xml; charset=utf-8",
}

export async function GET(): Promise<Response> {
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

  return new Response(renderWatchSitemapIndex(manifest), {
    status: 200,
    headers: XML_HEADERS,
  })
}
