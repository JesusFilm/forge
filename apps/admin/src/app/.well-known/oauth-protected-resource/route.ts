import { getAdminMcpProtectedResourceMetadata } from "@/mcp/admin-mcp-metadata"

export function GET() {
  return Response.json(getAdminMcpProtectedResourceMetadata(), {
    headers: {
      "cache-control": "public, max-age=300",
    },
  })
}
