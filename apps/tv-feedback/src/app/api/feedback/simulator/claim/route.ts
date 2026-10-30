import { NextResponse } from "next/server"
import { z } from "zod"

import { activeGrantForSession } from "@/server/feedbackState"
import { readJsonLimited } from "@/server/request"
import { createSignedSimulatorSession, currentSession } from "@/server/session"
import {
  signedSimulatorConfig,
  SimulatorTokenError,
  verifySimulatorToken,
} from "@/server/signedSimulator"

export const runtime = "nodejs"
const schema = z.object({ token: z.string().min(100).max(4096) }).strict()
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  const config = signedSimulatorConfig()
  if (!config) return json({ error: "not_found" }, 404)
  if (request.headers.get("origin") !== config.audience)
    return json({ error: "invalid_origin" }, 403)
  const input = schema.safeParse(
    await readJsonLimited(request).catch(() => null),
  )
  if (!input.success)
    return json({ error: "invalid_or_expired_simulator_token" }, 403)
  try {
    const claims = verifySimulatorToken(input.data.token, config)
    const authorization = await createSignedSimulatorSession(
      claims,
      config.keyId,
    )
    return json({ ...authorization, simulator: true }, 201)
  } catch (error) {
    return json(
      {
        error:
          error instanceof SimulatorTokenError ? error.message : "unavailable",
      },
      error instanceof SimulatorTokenError ? 403 : 503,
    )
  }
}

export async function GET() {
  if (!signedSimulatorConfig()) return json({ error: "not_found" }, 404)
  const id = await currentSession()
  const grant = id ? await activeGrantForSession(id) : null
  if (!grant || grant.source !== "signed-simulator")
    return json({ error: "simulator_grant_required" }, 403)
  return json({
    referenceCode: grant.reference,
    expiresAt: new Date(grant.sessionExpiresAt ?? 0).toISOString(),
    simulator: true,
  })
}
