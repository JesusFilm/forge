import { createHmac, randomUUID } from "node:crypto"
import { createClient } from "redis"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  RECOMMENDATION_MUTATION_CLIENT_LIMIT,
  createRecommendationMutationAdmission,
  resetRecommendationMutationAdmissionForTests,
  type RecommendationAdmissionNamespace,
} from "./recommendation-mutation-admission"

const RUN_REDIS_TEST =
  process.env.RECOMMENDATION_REDIS_TEST === "1" &&
  Boolean(process.env.REDIS_URL?.trim())

function hmacKey(secret: string, namespace: string, value: string): string {
  return createHmac("sha256", secret)
    .update(namespace)
    .update("\0")
    .update(value)
    .digest("hex")
}

function admissionKeys(
  secret: string,
  namespace: RecommendationAdmissionNamespace,
  address: string,
): string[] {
  const clientDigest = hmacKey(
    secret,
    `recommendation-admission-client-v2:${namespace}`,
    address,
  )
  const aggregateDigest = hmacKey(
    secret,
    `recommendation-admission-aggregate-v2:${namespace}`,
    "all",
  )
  return [
    `recommendation:admission:${namespace}:client:${clientDigest}`,
    `recommendation:admission:${namespace}:aggregate:${aggregateDigest}`,
  ]
}

describe.skipIf(!RUN_REDIS_TEST)("Watch recommendation Redis admission", () => {
  const secret = `recommendation-admission-test-${randomUUID()}`
  const address = "198.51.100.240"
  const keys = [
    ...admissionKeys(secret, "profile-status", address),
    ...admissionKeys(secret, "privacy-control", address),
  ]
  let cleanupClient: ReturnType<typeof createClient>

  beforeAll(async () => {
    cleanupClient = createClient({ url: process.env.REDIS_URL })
    await cleanupClient.connect()
    await cleanupClient.del(keys)
  })

  afterAll(async () => {
    resetRecommendationMutationAdmissionForTests()
    await cleanupClient.del(keys)
    await cleanupClient.quit()
  })

  it("executes the atomic Lua limit while preserving privacy-control capacity", async () => {
    const admit = createRecommendationMutationAdmission({
      production: true,
      secret,
    })
    const headers = new Headers({ "cf-connecting-ip": address })

    for (
      let attempt = 0;
      attempt < RECOMMENDATION_MUTATION_CLIENT_LIMIT;
      attempt += 1
    ) {
      await expect(admit(headers, "profile-status")).resolves.toEqual({
        allowed: true,
      })
    }

    await expect(admit(headers, "profile-status")).resolves.toEqual({
      allowed: false,
      reason: "rate_limited",
    })
    await expect(admit(headers, "privacy-control")).resolves.toEqual({
      allowed: true,
    })
    await expect(cleanupClient.mGet(keys)).resolves.toEqual([
      String(RECOMMENDATION_MUTATION_CLIENT_LIMIT),
      String(RECOMMENDATION_MUTATION_CLIENT_LIMIT),
      "1",
      "1",
    ])
  })
})
