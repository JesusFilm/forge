import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ApolloClient } from "@apollo/client"

const ORIGINAL_ENV = { ...process.env }

function extractBearer(fetchSpy: ReturnType<typeof vi.fn>): string | undefined {
  const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined
  if (!init || typeof init.headers !== "object") return undefined
  const headers = init.headers as Record<string, string>
  return headers.Authorization || headers.authorization
}

function extractHeaders(fetchSpy: ReturnType<typeof vi.fn>): Headers {
  const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined
  return new Headers(init?.headers)
}

function extractSignal(
  fetchSpy: ReturnType<typeof vi.fn>,
  callIndex = 0,
): AbortSignal | null | undefined {
  const init = fetchSpy.mock.calls[callIndex]?.[1] as RequestInit | undefined
  return init?.signal
}

function mockSuccessfulFetch() {
  const fetchSpy = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    ),
  )
  vi.stubGlobal("fetch", fetchSpy)
  return fetchSpy
}

function mockAbortSignalTimeout() {
  const signals: AbortSignal[] = []
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const controller = new AbortController()
    signals.push(controller.signal)
    return controller.signal
  })
  return { signals, timeoutSpy }
}

async function runQuery(client: Pick<ApolloClient, "query">) {
  const { gql } = await import("@apollo/client")
  await client.query({
    query: gql`
      {
        ok
      }
    `,
    fetchPolicy: "no-cache",
  })
}

describe("admin-client env validation", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("uses the first CSV entry as the outbound bearer", async () => {
    process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "first-key,second-key,third-key"

    const fetchSpy = mockSuccessfulFetch()

    const { default: client } = await import("./admin-client")
    await runQuery(client)

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(extractBearer(fetchSpy)).toBe("Bearer first-key")
  })

  it("trims whitespace around the first CSV entry", async () => {
    process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "  padded-key , other-key "

    const fetchSpy = mockSuccessfulFetch()

    const { default: client } = await import("./admin-client")
    await runQuery(client)

    expect(extractBearer(fetchSpy)).toBe("Bearer padded-key")
  })
})

describe("admin-client timeout budgets", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("keeps the default Admin GraphQL client on the 15 second timeout", async () => {
    const fetchSpy = mockSuccessfulFetch()
    const { signals, timeoutSpy } = mockAbortSignalTimeout()

    const { default: client } = await import("./admin-client")
    await runQuery(client)

    expect(timeoutSpy).toHaveBeenCalledWith(15_000)
    expect(extractSignal(fetchSpy)).toBe(signals[0])
  })

  it("uses a longer bounded timeout for semantic search Admin GraphQL calls", async () => {
    const fetchSpy = mockSuccessfulFetch()
    const { signals, timeoutSpy } = mockAbortSignalTimeout()

    const { semanticSearchAdminClient } = await import("./admin-client")
    await runQuery(semanticSearchAdminClient)

    expect(timeoutSpy).toHaveBeenCalledWith(45_000)
    expect(extractSignal(fetchSpy)).toBe(signals[0])
  })

  it("keeps default and semantic search clients on independent timeouts", async () => {
    const fetchSpy = mockSuccessfulFetch()
    const { signals, timeoutSpy } = mockAbortSignalTimeout()

    const { default: client, semanticSearchAdminClient } =
      await import("./admin-client")
    await runQuery(client)
    await runQuery(semanticSearchAdminClient)

    expect(timeoutSpy.mock.calls.map(([timeoutMs]) => timeoutMs)).toEqual([
      15_000, 45_000,
    ])
    expect(extractSignal(fetchSpy, 0)).toBe(signals[0])
    expect(extractSignal(fetchSpy, 1)).toBe(signals[1])
  })

  it("keeps independent timeouts when semantic search is touched first", async () => {
    const fetchSpy = mockSuccessfulFetch()
    const { signals, timeoutSpy } = mockAbortSignalTimeout()

    const { default: client, semanticSearchAdminClient } =
      await import("./admin-client")
    await runQuery(semanticSearchAdminClient)
    await runQuery(client)

    expect(timeoutSpy.mock.calls.map(([timeoutMs]) => timeoutMs)).toEqual([
      45_000, 15_000,
    ])
    expect(extractSignal(fetchSpy, 0)).toBe(signals[0])
    expect(extractSignal(fetchSpy, 1)).toBe(signals[1])
  })
})

describe("admin-client User Playlist context", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("keeps the delegated bearer server-side and forwards only the signed context envelope", async () => {
    const fetchSpy = mockSuccessfulFetch()
    const { createUserPlaylistAdminClient } = await import("./admin-client")
    const client = createUserPlaylistAdminClient("delegated-user-token", {
      "x-forge-viewer-context": "opaque-context",
      "x-forge-viewer-context-signature": "opaque-signature",
    })

    await runQuery(client)

    const headers = extractHeaders(fetchSpy)
    expect(headers.get("authorization")).toBe("Bearer delegated-user-token")
    expect(headers.get("x-forge-viewer-context")).toBe("opaque-context")
    expect(headers.get("x-forge-viewer-context-signature")).toBe(
      "opaque-signature",
    )
  })
})
