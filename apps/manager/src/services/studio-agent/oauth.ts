import { createRemoteJWKSet, jwtVerify } from "jose"
import { env } from "@/config/env"
import { StudioBoundaryError, type StudioCaller } from "@forge/studio-server"
import { validateAdminManagerSession } from "@/lib/admin-manager-session"
export const studioMcpAudience = () =>
  env.STUDIO_MCP_AUDIENCE ??
  new URL("/mcp", env.MANAGER_BASE_URL ?? "http://localhost:3002").toString()
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
export async function authenticateStudioMcp(
  request: Request,
  requiredScope: string,
): Promise<StudioCaller> {
  try {
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer ([^ ]+)$/i)?.[1]
    if (!token || token.length > 8192 || !env.AUTH_ISSUER_URL)
      throw new StudioBoundaryError("OAuth bearer required", 401)
    jwks ??= createRemoteJWKSet(new URL("/api/auth/jwks", env.AUTH_ISSUER_URL))
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.AUTH_ISSUER_URL.replace(/\/$/, ""),
      audience: studioMcpAudience(),
      algorithms: ["RS256", "ES256", "EdDSA"],
    })
    if (
      !payload.sub ||
      typeof payload.client_id !== "string" ||
      !payload.client_id ||
      payload["https://jesusfilm.org/claims/app"] !== "studio-mcp" ||
      payload["https://jesusfilm.org/claims/environment"] !==
        env.STUDIO_ENVIRONMENT ||
      typeof payload.exp !== "number"
    )
      throw new StudioBoundaryError("Invalid Studio OAuth identity")
    if (
      env.STUDIO_MCP_CLIENT_IDS &&
      !env.STUDIO_MCP_CLIENT_IDS.split(",")
        .map((s) => s.trim())
        .includes(payload.client_id)
    )
      throw new StudioBoundaryError("Studio client not allowed")
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ") : []
    if (!scopes.includes(requiredScope))
      throw new StudioBoundaryError("insufficient_scope")
    const session = await validateAdminManagerSession({ subject: payload.sub })
    if (!session)
      throw new StudioBoundaryError(
        "Current Studio operator membership required",
      )
    return {
      sub: session.user.id,
      authority: "delegated",
      clientId: payload.client_id,
      scopes,
    }
  } catch (e) {
    if (e instanceof StudioBoundaryError) throw e
    throw new StudioBoundaryError("Invalid Studio OAuth token", 401)
  }
}
