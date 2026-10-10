const retiredSceneEmbeddingPipeline = {
  error: "Legacy scene embedding ingest has been retired",
  reason: "legacy_scene_embedding_pipeline_removed",
  retryable: false,
  replacement:
    "Search uses transcript embeddings; historical scene data is retained for feat-199.",
} as const

function retired(): Response {
  return Response.json(retiredSceneEmbeddingPipeline, { status: 410 })
}

export async function POST(): Promise<Response> {
  return retired()
}

export async function GET(): Promise<Response> {
  return retired()
}
