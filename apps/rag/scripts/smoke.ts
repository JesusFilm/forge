import { searchResponseSchema } from "@forge/rag-contracts"

import { parseSmokeEnv } from "../src/config/env.js"

const env = parseSmokeEnv(process.env)
const query = process.argv.slice(2).join(" ").trim() || "hope"
const forbiddenSourceKey = process.env.SMOKE_FORBIDDEN_SOURCE_KEY?.trim()

function fail(message: string): never {
  console.error(`smoke: FAIL — ${message}`)
  process.exit(1)
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, env.SMOKE_BASE_URL), {
    ...init,
    signal: AbortSignal.timeout(env.SMOKE_MAX_MS),
  })
}

async function authenticatedSearch(body: unknown): Promise<Response> {
  return request("/v1/search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.SMOKE_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

async function main(): Promise<void> {
  const health = await request("/v1/health")
  if (health.status !== 200) {
    fail(`GET /v1/health returned ${health.status}`)
  }

  const unauthenticated = await request("/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  })
  if (unauthenticated.status !== 401) {
    fail(`unauthenticated POST /v1/search returned ${unauthenticated.status}`)
  }

  const search = await authenticatedSearch({ query, policy: { topK: 5 } })
  if (search.status !== 200) {
    fail(`authenticated POST /v1/search returned ${search.status}`)
  }
  const parsed = searchResponseSchema.safeParse(await search.json())
  if (!parsed.success) {
    fail(`search response violated the contract: ${parsed.error.message}`)
  }

  if (forbiddenSourceKey) {
    const narrowed = await authenticatedSearch({
      query,
      policy: { allowedSourceKeys: [forbiddenSourceKey] },
    })
    if (narrowed.status !== 200) {
      fail(`out-of-scope search returned ${narrowed.status}`)
    }
    const narrowedBody = searchResponseSchema.safeParse(await narrowed.json())
    if (!narrowedBody.success || narrowedBody.data.results.length !== 0) {
      fail("the bearer token widened into the forbidden source scope")
    }
  }

  console.error(
    `smoke: PASS — health, auth rejection, scoped search, and contract (${parsed.data.results.length} results)`,
  )
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
