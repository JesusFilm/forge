import { env } from "@/config/env"
import { studioMcpAudience } from "@/services/studio-agent/oauth"
import { studioOAuthScopes } from "@forge/studio-contracts/agent"
export function GET() {
  return Response.json({
    resource: studioMcpAudience(),
    authorization_servers: [env.AUTH_ISSUER_URL],
    scopes_supported: studioOAuthScopes,
    bearer_methods_supported: ["header"],
    resource_name: "Forge Studio",
  })
}
