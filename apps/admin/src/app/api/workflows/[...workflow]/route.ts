// Workflow endpoint — authenticates incoming workflow callbacks via
// HMAC-SHA256 signature + timestamp skew check.
//
// Contract:
//   - WORKFLOW_API_KEYS: comma-separated list for zero-downtime rotation
//   - X-Workflow-Timestamp: unix ms when the request was signed
//   - X-Workflow-Signature: HMAC-SHA256 of `${timestamp}\n${body}` with key
//   - Timestamp skew > 5 min → reject
//   - Key check uses timingSafeEqual across all valid keys

import { createHmac, timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"

const MAX_SKEW_MS = 5 * 60 * 1000

function getValidKeys(): string[] {
  if (!env.WORKFLOW_API_KEYS) return []
  return env.WORKFLOW_API_KEYS.split(",")
    .map((k) => k.trim())
    .filter(Boolean)
}

function verifySignature(
  body: string,
  timestamp: string,
  signature: string,
): boolean {
  const keys = getValidKeys()
  if (keys.length === 0) return false

  const payload = `${timestamp}\n${body}`

  for (const key of keys) {
    const expected = createHmac("sha256", key).update(payload).digest("hex")
    if (
      expected.length === signature.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      return true
    }
  }
  return false
}

function reject(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 })
}

export async function POST(request: Request): Promise<Response> {
  const timestamp = request.headers.get("x-workflow-timestamp")
  const signature = request.headers.get("x-workflow-signature")

  if (!timestamp || !signature) return reject()

  const skew = Math.abs(Date.now() - Number(timestamp))
  if (Number.isNaN(skew) || skew > MAX_SKEW_MS) return reject()

  const body = await request.text()
  if (!verifySignature(body, timestamp, signature)) return reject()

  // Signature verified — pass through to the workflow runtime.
  // The workflow SDK handles routing based on the URL path.
  // For now, return 200 with the body parsed as JSON.
  try {
    const parsed = JSON.parse(body)
    return Response.json({ ok: true, received: parsed })
  } catch {
    return Response.json({ error: "Bad Request" }, { status: 400 })
  }
}

export async function GET(): Promise<Response> {
  return reject()
}
