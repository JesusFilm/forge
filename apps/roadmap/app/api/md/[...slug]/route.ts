import {
  getAllFeatures,
  getFeaturesByLane,
  getFeaturesByOwner,
  getFeatureById,
  getAllOwners,
  ALL_LANES,
  type Lane,
} from "@/lib/features"
import {
  renderRoadmapMarkdown,
  renderLaneMarkdown,
  renderPersonMarkdown,
  renderTicketMarkdown,
} from "@/lib/markdown"

const HEADERS = {
  "Content-Type": "text/markdown; charset=utf-8",
  "Cache-Control": "public, max-age=60, s-maxage=60",
}

function notFound(message: string) {
  return new Response(message, {
    status: 404,
    headers: { "Content-Type": "text/plain" },
  })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params
  const [type, ...rest] = slug

  switch (type) {
    case "roadmap": {
      const features = getAllFeatures()
      return new Response(renderRoadmapMarkdown(features), {
        headers: HEADERS,
      })
    }

    case "lane": {
      const laneName = rest[0] as Lane
      if (!ALL_LANES.includes(laneName)) {
        return notFound(`Unknown lane: ${rest[0]}`)
      }
      const features = getFeaturesByLane(laneName)
      return new Response(renderLaneMarkdown(laneName, features), {
        headers: HEADERS,
      })
    }

    case "person": {
      const personName = rest[0]
      const owners = getAllOwners()
      if (!owners.includes(personName)) {
        return notFound(`Unknown person: ${personName}`)
      }
      const features = getFeaturesByOwner(personName)
      return new Response(renderPersonMarkdown(personName, features), {
        headers: HEADERS,
      })
    }

    case "ticket": {
      const id = rest.join("/")
      const feature = getFeatureById(id)
      if (!feature) {
        return notFound(`Feature not found: ${id}`)
      }
      return new Response(renderTicketMarkdown(feature), {
        headers: HEADERS,
      })
    }

    default:
      return notFound(`Unknown path: /${slug.join("/")}`)
  }
}
