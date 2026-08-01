import {
  isValidServiceBearer,
  unauthorizedJson,
} from "../server/service-bearer"
import {
  DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
  DEVOTIONAL_WIDE_ARTIFACT_TYPE,
  fetchDevotionalWorkerArtifact,
  type DevotionalVideoArtifact,
} from "../services/devotional/devotional-worker-client"

export async function handleDevotionalAssetRequest(input: {
  authHeader?: string | null
  serviceKeys: readonly string[]
  assetId: string
  artifactType: string
  ext: string
  range?: string
  fetchArtifact?: typeof fetchDevotionalWorkerArtifact
}): Promise<Response> {
  if (
    !isValidServiceBearer({
      authHeader: input.authHeader,
      allowlist: input.serviceKeys,
    })
  ) {
    return unauthorizedJson()
  }
  const valid =
    input.ext === "mp4" &&
    (input.artifactType === DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE ||
      input.artifactType === DEVOTIONAL_WIDE_ARTIFACT_TYPE)
  if (!valid) return Response.json({ error: "not_found" }, { status: 404 })

  const artifact: DevotionalVideoArtifact = {
    assetId: input.assetId,
    artifactType: input.artifactType as DevotionalVideoArtifact["artifactType"],
    ext: "mp4",
  }
  const upstream = await (input.fetchArtifact ?? fetchDevotionalWorkerArtifact)(
    artifact,
    input.range,
  )
  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    })
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "video/mp4",
      "cache-control": "private, max-age=31536000, immutable",
      ...(upstream.headers.get("content-length")
        ? { "content-length": upstream.headers.get("content-length")! }
        : {}),
      ...(upstream.headers.get("accept-ranges")
        ? { "accept-ranges": upstream.headers.get("accept-ranges")! }
        : {}),
      ...(upstream.headers.get("content-range")
        ? { "content-range": upstream.headers.get("content-range")! }
        : {}),
    },
  })
}
