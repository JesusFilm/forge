import { NextResponse } from "next/server"
import {
  ExperienceGeneratorError,
  generateExperience,
  type CompactResult,
  type Experience,
  type ExperienceGeneratorErrorCode,
} from "@/lib/experience-generator"

export type GenerateExperienceResult =
  | { ok: true; experience: Experience; latencyMs: number }
  | { ok: false; code: ExperienceGeneratorErrorCode; message: string }

const USER_MESSAGES: Record<ExperienceGeneratorErrorCode, string> = {
  NOT_CONFIGURED: "AI generation is temporarily unavailable.",
  UPSTREAM_ERROR:
    "The AI generation service is unavailable right now. Give it a moment and try again.",
  SCHEMA_MISMATCH:
    "Couldn't parse the generated response. Try again — the model usually recovers on a second pass.",
  NO_VALID_SECTIONS:
    "The model couldn't find enough in-catalog videos for this query. Try a broader query or different phrasing.",
}

export async function POST(req: Request) {
  let body: { query?: string; results?: CompactResult[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json<GenerateExperienceResult>(
      {
        ok: false,
        code: "SCHEMA_MISMATCH",
        message: USER_MESSAGES.SCHEMA_MISMATCH,
      },
      { status: 400 },
    )
  }

  const { query, results } = body
  if (typeof query !== "string" || !Array.isArray(results)) {
    return NextResponse.json<GenerateExperienceResult>(
      {
        ok: false,
        code: "SCHEMA_MISMATCH",
        message: USER_MESSAGES.SCHEMA_MISMATCH,
      },
      { status: 400 },
    )
  }

  try {
    const { experience, latencyMs } = await generateExperience(query, results)
    return NextResponse.json<GenerateExperienceResult>({
      ok: true,
      experience,
      latencyMs,
    })
  } catch (err) {
    if (err instanceof ExperienceGeneratorError) {
      return NextResponse.json<GenerateExperienceResult>({
        ok: false,
        code: err.code,
        message: USER_MESSAGES[err.code],
      })
    }
    console.error("[generate route] unexpected error", err)
    return NextResponse.json<GenerateExperienceResult>({
      ok: false,
      code: "UPSTREAM_ERROR",
      message: USER_MESSAGES.UPSTREAM_ERROR,
    })
  }
}
