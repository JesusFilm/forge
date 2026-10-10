import http from "node:http"
import { appendFileSync, readFileSync } from "node:fs"
const base = {
  contractVersion: "semantic-recommendation-v1",
  surfaceVersion: "watch-below-player-v1",
  strategyVersion: "semantic-candidate-platform-v1",
  classifierVersion: "active-watch-proxy-v1",
  requestId: "browser-fixture-empty",
  result: "empty",
  reason: "no_candidates",
  expiresAt: null,
  requestedCount: 6,
  composedCount: 0,
  shortfallReason: "insufficient_candidates",
  personalization: null,
  items: [],
}
http
  .createServer(async (req, res) => {
    let body = ""
    for await (const part of req) body += part
    let input = {}
    try {
      input = JSON.parse(body)
    } catch {}
    const query = input.query ?? ""
    const delivery = query.includes("semanticRecommendationDelivery")
    const mode = readFileSync("/tmp/feat589-browser-mode", "utf8").trim()
    appendFileSync(
      "/tmp/feat589-browser-upstream.jsonl",
      JSON.stringify({
        at: Date.now(),
        operation: input.operationName ?? null,
        delivery,
        locale: input.variables?.locale,
        audioLanguageSlug: input.variables?.audioLanguageSlug,
      }) + "\n",
    )
    if (delivery)
      await new Promise((resolve) =>
        setTimeout(resolve, mode === "slow" ? 5000 : 600),
      )
    res.setHeader("content-type", "application/json")
    if (mode === "error" || !delivery)
      res.end(
        JSON.stringify({
          errors: [{ message: "local upstream fixture unavailable" }],
        }),
      )
    else
      res.end(
        JSON.stringify({
          data: {
            semanticRecommendationDelivery: {
              ...base,
              ...(mode === "timeout"
                ? { result: "unavailable", reason: "retrieval_timeout" }
                : {}),
            },
          },
        }),
      )
  })
  .listen(3136, "127.0.0.1")
