import type { PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import {
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "./token.service"
import { readEmergencyRevokedRecommendationKids } from "./manifest.service"

export function createRuntimeRecommendationTokenService(prisma: PrismaClient) {
  try {
    const keyring = parseRecommendationKeyring(
      env.RECOMMENDATION_CAPABILITY_KEYRING,
    )
    let revokedKids: Promise<string[]> | undefined
    return {
      activeKid: keyring.active.kid,
      ...createRecommendationTokenService({
        keyring,
        readRevokedKids: () =>
          (revokedKids ??= readEmergencyRevokedRecommendationKids(prisma)),
      }),
    }
  } catch {
    return null
  }
}
