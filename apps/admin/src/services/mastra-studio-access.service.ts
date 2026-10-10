import { env } from "@/config/env"

const MASTRA_STUDIO_ACCESS_TIMEOUT_MS = 5_000

export type MastraStudioAccessRole = "NO_ACCESS" | "STUDIO_ACCESS"

export type MastraStudioAccessLookup = {
  disabled: boolean
  helperText: string
  accessByEmail: Map<string, MastraStudioAccessRole>
}

type GatewayAccessRecord = {
  email: string
  status: "approved" | "pending" | "revoked"
  role: "admin" | "editor"
}

type GatewayAccessResponse = {
  records: GatewayAccessRecord[]
}

export async function loadMastraStudioAccessByEmail(
  emails: readonly string[],
): Promise<MastraStudioAccessLookup> {
  const config = getMastraGatewayAdminConfig()
  if (!config) {
    return disabledLookup("Configure")
  }

  const normalizedEmails = normalizeEmailList(emails)
  if (normalizedEmails.length === 0) {
    return backedLookup(new Map())
  }

  let response: Response
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ emails: normalizedEmails }),
      signal: AbortSignal.timeout(MASTRA_STUDIO_ACCESS_TIMEOUT_MS),
    })
  } catch {
    return disabledLookup("Unavailable")
  }

  if (!response.ok) {
    return disabledLookup(
      response.status === 401 ? "Auth failed" : "Unavailable",
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return disabledLookup("Unavailable")
  }

  if (!isGatewayAccessResponse(payload)) {
    return disabledLookup("Unavailable")
  }

  const accessByEmail = new Map<string, MastraStudioAccessRole>()
  for (const record of payload.records) {
    const email = normalizeEmail(record.email)
    if (!email) continue
    accessByEmail.set(
      email,
      record.status === "approved" ? "STUDIO_ACCESS" : "NO_ACCESS",
    )
  }

  return backedLookup(accessByEmail)
}

export async function updateMastraStudioAccessByEmail({
  email,
  name,
  role,
  approvedBy,
}: {
  email: string
  name?: string
  role: MastraStudioAccessRole
  approvedBy: string
}): Promise<void> {
  const config = getMastraGatewayAdminConfig()
  if (!config) {
    throw new Error("Mastra Studio gateway access API is not configured")
  }

  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    throw new Error("email is required")
  }

  const response = await fetch(config.url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: normalizedEmail,
      ...(name ? { name } : {}),
      role: role === "STUDIO_ACCESS" ? "editor" : "none",
      approvedBy,
    }),
    signal: AbortSignal.timeout(MASTRA_STUDIO_ACCESS_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(
      `Mastra Studio gateway access update failed with status ${response.status}`,
    )
  }
}

function getMastraGatewayAdminConfig() {
  if (!env.MASTRA_GATEWAY_BASE_URL || !env.MASTRA_GATEWAY_ADMIN_API_KEY) {
    return null
  }

  return {
    url: new URL(
      "/api/admin/studio-access",
      env.MASTRA_GATEWAY_BASE_URL,
    ).toString(),
    apiKey: env.MASTRA_GATEWAY_ADMIN_API_KEY,
  }
}

function backedLookup(
  accessByEmail: Map<string, MastraStudioAccessRole>,
): MastraStudioAccessLookup {
  return {
    disabled: false,
    helperText: "Backed",
    accessByEmail,
  }
}

function disabledLookup(helperText: string): MastraStudioAccessLookup {
  return {
    disabled: true,
    helperText,
    accessByEmail: new Map(),
  }
}

function normalizeEmailList(emails: readonly string[]) {
  return Array.from(
    new Set(
      emails
        .map(normalizeEmail)
        .filter((email): email is string => Boolean(email)),
    ),
  )
}

function normalizeEmail(email: string | undefined) {
  return email?.trim().toLowerCase() || undefined
}

function isGatewayAccessResponse(
  payload: unknown,
): payload is GatewayAccessResponse {
  if (!payload || typeof payload !== "object") return false
  const records = (payload as { records?: unknown }).records
  return Array.isArray(records) && records.every(isGatewayAccessRecord)
}

function isGatewayAccessRecord(record: unknown): record is GatewayAccessRecord {
  if (!record || typeof record !== "object") return false
  const candidate = record as Partial<GatewayAccessRecord>
  return (
    typeof candidate.email === "string" &&
    (candidate.status === "approved" ||
      candidate.status === "pending" ||
      candidate.status === "revoked") &&
    (candidate.role === "admin" || candidate.role === "editor")
  )
}
