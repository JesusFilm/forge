export type RecommendationPlaybackProxyEvaluationInput = Readonly<{
  windowStart: string
  windowEnd: string
}>

export async function runRecommendationPlaybackProxyEvaluation(
  input: RecommendationPlaybackProxyEvaluationInput,
) {
  "use workflow"
  return stepRunRecommendationPlaybackProxyEvaluation(input)
}

async function stepRunRecommendationPlaybackProxyEvaluation(
  input: RecommendationPlaybackProxyEvaluationInput,
) {
  "use step"
  const [{ prisma }, { evaluatePlaybackProxyReadiness }] = await Promise.all([
    import("@/db/client"),
    import("@/services/recommendations/playback-proxy-evaluation.service"),
  ])
  const result = await evaluatePlaybackProxyReadiness(prisma, {
    windowStart: new Date(input.windowStart),
    windowEnd: new Date(input.windowEnd),
  })
  return {
    status: result.status,
    evaluationId: result.evaluation.id,
    revision: result.evaluation.revision,
    state: result.evaluation.state,
  }
}
