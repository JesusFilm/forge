import { prisma } from "@/db/client"
import { mintAgentLoginHandle } from "@/services/agent-login.service"

function parseCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export async function mintAgentLoginHandleFromEnv() {
  return mintAgentLoginHandle(prisma, {
    clientId: process.env.AGENT_LOGIN_CLIENT_ID ?? "jfp_admin_local",
    redirectUri:
      process.env.AGENT_LOGIN_REDIRECT_URI ??
      "http://localhost:3003/api/auth/callback",
    requestedScopes: parseCsv(process.env.AGENT_LOGIN_SCOPES),
    ttlSeconds: process.env.AGENT_LOGIN_TTL_SECONDS
      ? Number(process.env.AGENT_LOGIN_TTL_SECONDS)
      : undefined,
  })
}

if (process.argv[1]?.endsWith("mint-agent-login-handle.ts")) {
  mintAgentLoginHandleFromEnv()
    .then((result) => {
      console.log(result.handle)
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
