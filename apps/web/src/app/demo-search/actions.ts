"use server"

import {
  ExperienceGeneratorError,
  generateExperience,
  type CompactResult,
  type Experience,
  type ExperienceGeneratorErrorCode,
} from "@/lib/experience-generator"

export type GenerateExperienceResult =
  | { ok: true; experience: Experience }
  | { ok: false; code: ExperienceGeneratorErrorCode; message: string }

const USER_MESSAGES: Record<ExperienceGeneratorErrorCode, string> = {
  NOT_CONFIGURED:
    "AI generation isn't configured for this deployment. Ask Nisal to wire OPENROUTER_API_KEY on the web service.",
  UPSTREAM_ERROR:
    "The AI generation service is unavailable right now. Give it a moment and try again.",
  SCHEMA_MISMATCH:
    "Couldn't parse the generated response. Try again — the model usually recovers on a second pass.",
  NO_VALID_SECTIONS:
    "The model couldn't find enough in-catalog videos for this query. Try a broader query or different phrasing.",
}

export async function generateExperienceAction(input: {
  query: string
  results: CompactResult[]
}): Promise<GenerateExperienceResult> {
  try {
    const experience = await generateExperience(input.query, input.results)
    return { ok: true, experience }
  } catch (err) {
    if (err instanceof ExperienceGeneratorError) {
      return {
        ok: false,
        code: err.code,
        message: USER_MESSAGES[err.code],
      }
    }
    return {
      ok: false,
      code: "UPSTREAM_ERROR",
      message: USER_MESSAGES.UPSTREAM_ERROR,
    }
  }
}
