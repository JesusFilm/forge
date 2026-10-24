import { NextResponse } from "next/server"

import { env } from "@/config/env"
import { prisma } from "@/db/client"
import {
  mintAgentLoginHandle,
  AgentLoginError,
} from "@/services/agent-login.service"

const BEARER_PREFIX = /^Bearer\s+/i

type MintRequestBody = {
  clientId?: unknown
  redirectUri?: unknown
  scopes?: unknown
  ttlSeconds?: unknown
}

export async function POST(request: Request) {
  const mintingKey = getBearerToken(request.headers.get("authorization"))
  if (
    !env.AGENT_LOGIN_MINTING_KEY ||
    mintingKey !== env.AGENT_LOGIN_MINTING_KEY
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: MintRequestBody
  try {
    body = (await request.json()) as MintRequestBody
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  if (
    typeof body.clientId !== "string" ||
    typeof body.redirectUri !== "string"
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  const requestedScopes = parseScopes(body.scopes)
  if (!requestedScopes.valid) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  try {
    return NextResponse.json(
      await mintAgentLoginHandle(prisma, {
        clientId: body.clientId,
        redirectUri: body.redirectUri,
        requestedScopes: requestedScopes.value,
        ttlSeconds:
          typeof body.ttlSeconds === "number" ? body.ttlSeconds : undefined,
        ipAddress:
          request.headers.get("x-forwarded-for") ??
          request.headers.get("x-real-ip"),
        userAgent: request.headers.get("user-agent"),
      }),
    )
  } catch (error) {
    if (error instanceof AgentLoginError) {
      return NextResponse.json(
        {
          error:
            error.code === "invalid_minting_key" ? "Unauthorized" : "Forbidden",
        },
        { status: error.code === "invalid_minting_key" ? 401 : 403 },
      )
    }

    throw error
  }
}

function getBearerToken(header: string | null) {
  if (!header || !BEARER_PREFIX.test(header)) return undefined
  return header.replace(BEARER_PREFIX, "").trim()
}

function parseScopes(value: unknown) {
  if (value === undefined) return { valid: true, value: undefined }
  if (!Array.isArray(value)) return { valid: false, value: undefined }
  if (!value.every((scope) => typeof scope === "string")) {
    return { valid: false, value: undefined }
  }
  return { valid: true, value }
}
