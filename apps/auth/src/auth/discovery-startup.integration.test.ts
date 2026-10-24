import { createServer } from "node:http"
import { afterAll, describe, expect, it, vi } from "vitest"

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL
const describeIntegration = databaseUrl ? describe : describe.skip

describeIntegration("Auth discovery at cold startup", () => {
  const server = createServer(async (request, response) => {
    try {
      const { GET } =
        await import("@/app/.well-known/openid-configuration/route")
      const result = await GET(new Request(`${origin}${request.url}`))
      response.writeHead(result.status, Object.fromEntries(result.headers))
      response.end(await result.text())
    } catch {
      response.writeHead(500).end()
    }
  })
  let origin: string
  let auth: typeof import("@/auth/config").auth

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const { prisma } = await import("@/db/client")
    await prisma.$disconnect()
  })

  it("initializes with the public origin unavailable and preserves discovery metadata", async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("No test port")
    origin = `http://127.0.0.1:${address.port}`
    vi.stubEnv("AUTH_BASE_URL", "https://auth.example.invalid")
    vi.stubEnv("PORT", String(address.port))
    vi.stubEnv("DATABASE_URL", databaseUrl!)
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      process.env.BETTER_AUTH_SECRET ??
        "discovery-startup-local-test-secret-only",
    )
    ;({ auth } = await import("@/auth/config"))
    // Consume a late rejection too: a failed startup must not escape cleanup.
    const ready = auth.$context.then(
      () => true,
      () => false,
    )
    const timeout = AbortSignal.timeout(3000)
    const completed = await Promise.race([
      ready,
      new Promise<boolean>((resolve) =>
        timeout.addEventListener("abort", () => resolve(false)),
      ),
    ])
    expect(
      completed,
      "Auth must initialize without awaiting its own discovery handler",
    ).toBe(true)

    const provider = (await auth.$context).socialProviders.find(
      ({ id }) => id === "jfp",
    )
    expect(provider).toMatchObject({
      issuer: "https://auth.example.invalid/api/auth",
      accountIssuer: "https://auth.example.invalid/api/auth",
      requiresIdTokenNonce: true,
      idToken: {
        issuer: "https://auth.example.invalid/api/auth",
        audience: "jfp_mobile_local",
        algorithms: ["EdDSA"],
      },
    })
    const { GET: health } = await import("@/app/api/health/route")
    expect((await health()).status).toBe(200)
    const discovery = await fetch(`${origin}/.well-known/openid-configuration`)
    expect(discovery.status).toBe(200)
    expect(await discovery.json()).toEqual(await auth.api.getOpenIdConfig())
    const session = await auth.handler(
      new Request("https://auth.example.invalid/api/auth/get-session"),
    )
    expect(session.status).toBe(200)
    expect(await session.json()).toBeNull()
  }, 10000)
})
