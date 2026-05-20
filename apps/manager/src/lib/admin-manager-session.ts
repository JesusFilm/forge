import { env } from "@/config/env"

export type AdminManagerSession = {
  user: {
    id: string
    email: string
    name?: string
  }
  managerRole: "OPERATOR"
}

export async function validateAdminManagerSession({
  subject,
  email,
  name,
}: {
  subject: string
  email?: string
  name?: string
}): Promise<AdminManagerSession | null> {
  const sessionUrl = getAdminManagerSessionUrl()
  if (!sessionUrl || !env.ADMIN_MANAGER_API_KEY) {
    throw new Error(
      "ADMIN_GRAPHQL_URL and ADMIN_MANAGER_API_KEY are required for Manager access validation",
    )
  }

  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.ADMIN_MANAGER_API_KEY}`,
    },
    body: JSON.stringify({ subject, email, name }),
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error("Admin Manager access validation failed.")
  }

  const payload = (await response.json()) as {
    allowed?: boolean
    user?: { id?: unknown; email?: unknown; name?: unknown }
    managerRole?: unknown
  }

  if (
    payload.allowed !== true ||
    payload.managerRole !== "OPERATOR" ||
    typeof payload.user?.id !== "string" ||
    typeof payload.user.email !== "string"
  ) {
    return null
  }

  return {
    user: {
      id: payload.user.id,
      email: payload.user.email,
      name:
        typeof payload.user.name === "string" ? payload.user.name : undefined,
    },
    managerRole: "OPERATOR",
  }
}

function getAdminManagerSessionUrl() {
  if (env.ADMIN_MANAGER_SESSION_URL) {
    return env.ADMIN_MANAGER_SESSION_URL
  }
  if (!env.ADMIN_GRAPHQL_URL) {
    return undefined
  }

  return new URL("/api/manager/session", env.ADMIN_GRAPHQL_URL).toString()
}
