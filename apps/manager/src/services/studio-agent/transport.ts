import { env } from "@/config/env"
import { STUDIO_AGENT_LIMITS } from "@forge/studio-contracts/agent"
import {
  signStudioRequest,
  readStudioBytes,
  StudioBoundaryError,
  type StudioCaller,
} from "@forge/studio-server"
export async function studioServiceRequest(
  target: "admin" | "mastra",
  caller: StudioCaller,
  payload: unknown,
  signal?: AbortSignal,
) {
  const base = target === "admin" ? env.ADMIN_GRAPHQL_URL : env.MASTRA_BASE_URL
  if (
    !base ||
    !env.STUDIO_INTERACTIVE_PRIVATE_KEY ||
    !env.STUDIO_INTERACTIVE_KEY_ID
  )
    throw new StudioBoundaryError("Studio service is not configured", 503)
  const body = JSON.stringify(payload)
  const assertion = await signStudioRequest(
    body,
    target === "admin" ? "forge-admin:studio:delegated" : "forge-mastra:studio",
    caller,
    {
      privateKey: env.STUDIO_INTERACTIVE_PRIVATE_KEY,
      keyId: env.STUDIO_INTERACTIVE_KEY_ID,
      environment: env.STUDIO_ENVIRONMENT,
    },
  )
  const response = await fetch(
    new URL(
      target === "admin" ? "/api/studio/delegated" : "/forge-studio",
      base,
    ),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forge-studio-service": assertion,
      },
      body,
      redirect: "error",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(
              target === "mastra" ? STUDIO_AGENT_LIMITS.managerMs : 100000,
            ),
          ])
        : AbortSignal.timeout(
            target === "mastra" ? STUDIO_AGENT_LIMITS.managerMs : 100000,
          ),
    },
  )
  if (!response.ok) {
    const data = JSON.parse(await readStudioBytes(response, 8192)) as {
      error?: string
    }
    throw new StudioBoundaryError(
      data.error ?? "Studio service failed",
      response.status,
    )
  }
  return response
}
export async function studioServiceCall(
  target: "admin" | "mastra",
  caller: StudioCaller,
  payload: unknown,
) {
  const response = await studioServiceRequest(target, caller, payload)
  const data = JSON.parse(await readStudioBytes(response, 2097152)) as {
    result: unknown
  }
  return data.result
}

export async function studioToolGrant(
  caller: StudioCaller,
  projectId: string,
  revision: number,
) {
  if (!env.STUDIO_INTERACTIVE_PRIVATE_KEY || !env.STUDIO_INTERACTIVE_KEY_ID)
    throw new StudioBoundaryError("Studio service unavailable", 503)
  const body = JSON.stringify({ projectId, revision })
  const assertion = await signStudioRequest(
    body,
    "forge-admin:studio:tools",
    { ...caller, authority: "delegated" },
    {
      privateKey: env.STUDIO_INTERACTIVE_PRIVATE_KEY,
      keyId: env.STUDIO_INTERACTIVE_KEY_ID,
      environment: env.STUDIO_ENVIRONMENT,
    },
  )
  return { body, assertion }
}
