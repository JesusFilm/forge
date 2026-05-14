import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

function extractBearer(fetchSpy: ReturnType<typeof vi.fn>): string | undefined {
  const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined
  if (!init || typeof init.headers !== "object") return undefined
  const headers = init.headers as Record<string, string>
  return headers.Authorization || headers.authorization
}

describe("admin-client env validation", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("imports cleanly when ADMIN_GRAPHQL_URL and WEB_ADMIN_API_KEYS are both set", async () => {
    process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"

    await expect(import("./admin-client")).resolves.toBeDefined()
  })

  it("throws at import when ADMIN_GRAPHQL_URL is unset", async () => {
    delete process.env.ADMIN_GRAPHQL_URL
    process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"

    await expect(import("./admin-client")).rejects.toThrow()
  })

  it("throws at import when WEB_ADMIN_API_KEYS is unset", async () => {
    process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
    delete process.env.WEB_ADMIN_API_KEYS

    await expect(import("./admin-client")).rejects.toThrow()
  })

  it("throws at import when ADMIN_GRAPHQL_URL points at the auth host", async () => {
    // PR #909 trap — auth.jesusfilm.org passes the soft suffix allowlist but
    // is not the GraphQL surface. Hard-reject in the schema prevents the
    // misconfiguration from silently 404ing in prod. t3-env wraps the
    // underlying refine message in a generic "Invalid environment variables"
    // throw; we capture the inner detail via console.error.
    process.env.ADMIN_GRAPHQL_URL = "https://auth.jesusfilm.org/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(import("./admin-client")).rejects.toThrow()

    const auditedAuthHostMention = errorSpy.mock.calls
      .flat()
      .some((arg) =>
        typeof arg === "string"
          ? /auth host/i.test(arg)
          : JSON.stringify(arg).match(/auth host/i),
      )
    expect(auditedAuthHostMention).toBe(true)

    errorSpy.mockRestore()
  })
})

describe("admin-client bearer parsing", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("uses the first CSV entry as the outbound bearer", async () => {
    process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "first-key,second-key,third-key"

    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
      ),
    )
    vi.stubGlobal("fetch", fetchSpy)

    const { default: client } = await import("./admin-client")
    const { gql } = await import("@apollo/client")
    await client.query({
      query: gql`
        {
          ok
        }
      `,
      fetchPolicy: "no-cache",
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(extractBearer(fetchSpy)).toBe("Bearer first-key")

    vi.unstubAllGlobals()
  })

  it("trims whitespace around the first CSV entry", async () => {
    process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "  padded-key , other-key "

    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
      ),
    )
    vi.stubGlobal("fetch", fetchSpy)

    const { default: client } = await import("./admin-client")
    const { gql } = await import("@apollo/client")
    await client.query({
      query: gql`
        {
          ok
        }
      `,
      fetchPolicy: "no-cache",
    })

    expect(extractBearer(fetchSpy)).toBe("Bearer padded-key")

    vi.unstubAllGlobals()
  })
})
