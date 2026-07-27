import { env } from "@/config/env"
import { ADMIN_MCP_TOOLS } from "@/mcp/admin-mcp-tools"

export function getAdminMcpResourceUrl() {
  return new URL(
    "/mcp",
    env.ADMIN_BASE_URL ?? "http://localhost:3003",
  ).toString()
}

export function getAdminMcpProtectedResourceMetadata() {
  return {
    resource: getAdminMcpResourceUrl(),
    authorization_servers: [getAuthIssuerUrl()],
    bearer_methods_supported: ["header"],
    scopes_supported: [
      "offline_access",
      ...new Set(ADMIN_MCP_TOOLS.flatMap((tool) => tool.requiredScopes)),
    ],
    resource_name: "Jesus Film Admin MCP",
    resource_documentation:
      "https://github.com/JesusFilm/forge/blob/main/plugins/jfp-admin/skills/forge-bulk-locale-factory/SKILL.md",
  }
}

function getAuthIssuerUrl() {
  return (env.AUTH_ISSUER_URL ?? "http://localhost:3004").replace(/\/$/, "")
}
