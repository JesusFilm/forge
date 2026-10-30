// Local-only qualification bootstrap. Never imported by the application.
import { readFile } from "node:fs/promises"
async function main() {
  Object.assign(
    process.env,
    JSON.parse(await readFile(process.argv[2], "utf8")),
  )
  const { installLoopbackFetchGuard, serve } =
    await import("../../../scripts/studio-agent-local/http.mjs")
  installLoopbackFetchGuard()
  const { createManagerSessionCookie } =
    await import("../src/lib/manager-session-cookie")
  const mcp = await import("../src/app/mcp/route")
  const metadata =
    await import("../src/app/.well-known/oauth-protected-resource/route")
  serve(
    55471,
    {
      "POST /mcp": mcp.POST,
      "GET /local-session": async () => {
        const cookie = await createManagerSessionCookie({
          id: "shorts-local-qualification",
          subject: "shorts-local-qualification",
          email: "shorts-local-qualification@example.test",
          name: "Local qualification operator",
          managerRole: "OPERATOR",
          scopes: ["shorts:read", "shorts:edit"],
        })
        return new Response(null, {
          status: 302,
          headers: {
            location: "http://127.0.0.1:55473/dashboard/shorts",
            "set-cookie": `manager-session=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
            "cache-control": "no-store",
          },
        })
      },
      "GET /mcp": mcp.GET,
      "GET /.well-known/oauth-protected-resource": metadata.GET,
    },
    process.argv[3],
  )
}
void main()
