import { randomUUID } from "node:crypto"
import { parseArgs } from "node:util"
import {
  createRecommendationTesterLink,
  RecommendationTesterConfigurationError,
} from "../src/lib/recommendation-tester-token"

async function main() {
  const { values } = parseArgs({
    options: {
      origin: { type: "string" },
      "tester-id": { type: "string" },
    },
    strict: true,
  })
  const origin = values.origin ?? process.env.NEXT_PUBLIC_CANONICAL_ORIGIN
  if (!origin) throw new RecommendationTesterConfigurationError()
  const testerId = values["tester-id"] ?? randomUUID()
  const url = await createRecommendationTesterLink(
    {
      origin,
      secret: process.env.WATCH_RECOMMENDATION_TESTER_SECRET,
    },
    testerId,
  )
  // Intentional operator-only output. Never run this command in CI or retain
  // links in repository artifacts. The signing secret is never printed.
  process.stdout.write(
    JSON.stringify({ testerId, activationUrl: url }, null, 2) + "\n",
  )
}

main().catch(() => {
  process.stderr.write(
    "Cannot issue tester link. Check the origin, UUID, and WATCH_RECOMMENDATION_TESTER_SECRET (at least 32 characters).\n",
  )
  process.exitCode = 1
})
