import { env } from "../config/env"
import { sampleRecommendationWaits } from "../db/recommendation-wait-sampler"

const controller = new AbortController()
process.once("SIGINT", () => controller.abort())
process.once("SIGTERM", () => controller.abort())

sampleRecommendationWaits({
  connectionString: env.DATABASE_URL,
  durationMs:
    process.argv[2] === undefined ? undefined : Number(process.argv[2]),
  intervalMs:
    process.argv[3] === undefined ? undefined : Number(process.argv[3]),
  signal: controller.signal,
}).then(
  (result) => {
    if (result.stopped === "error") process.exitCode = 1
  },
  () => {
    console.error(
      "Recommendation database observer failed; no credentials or query payloads are logged",
    )
    process.exitCode = 1
  },
)
