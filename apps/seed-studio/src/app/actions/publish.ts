"use server"

import type { GeneratedExperience } from "@/lib/ai/experience-schema"
import { publishExperience as publishToStrapi } from "@/lib/strapi-client"

type PublishResult = {
  success: boolean
  documentId?: string
  error?: string
}

export async function publishExperience(
  experience: GeneratedExperience,
): Promise<PublishResult> {
  return publishToStrapi(experience)
}
