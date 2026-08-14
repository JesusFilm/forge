export type TypesenseClientOptions = {
  host: string
  apiKey: string
  timeoutMs?: number
  fetch?: typeof fetch
}

export type TypesenseCollectionField = {
  name: string
  type: string
  facet?: boolean
  index?: boolean
  locale?: string
  optional?: boolean
  sort?: boolean
  stem?: boolean
  num_dim?: number
}

export const TYPESENSE_COLLECTION_FIELD_CONTRACT_KEYS = [
  "facet",
  "index",
  "locale",
  "optional",
  "sort",
  "stem",
  "num_dim",
] as const satisfies readonly (keyof TypesenseCollectionField)[]

export type TypesenseCollectionSchema = {
  name: string
  fields: TypesenseCollectionField[]
  default_sorting_field?: string
  enable_nested_fields?: boolean
}

export type TypesenseCollection = TypesenseCollectionSchema & {
  num_documents?: number
}

export type TypesenseSearchRequest = Record<
  string,
  string | number | boolean | string[] | undefined
> & {
  collection: string
  q: string
}

export type TypesenseSearchHit<T> = {
  document: T
  highlights?: Array<{
    field: string
    matched_tokens?: string[]
    snippet?: string
    snippets?: string[]
    value?: string
    indices?: number[]
  }>
  text_match?: number
  text_match_info?: {
    score?: string
    tokens_matched?: number
    num_tokens_dropped?: number
    typo_prefix_score?: number
  }
  vector_distance?: number
}

export type TypesenseSearchGroup<T> = {
  group_key: string[]
  found: number
  hits: TypesenseSearchHit<T>[]
}

type TypesenseSearchResultBase = {
  found: number
  out_of: number
  page: number
  search_time_ms: number
}

export type TypesenseSearchResult<T> = TypesenseSearchResultBase &
  (
    | { hits: TypesenseSearchHit<T>[]; grouped_hits?: never }
    | { hits?: never; grouped_hits: TypesenseSearchGroup<T>[] }
  )

export type TypesenseAlias = {
  name: string
  collection_name: string
}

type TypesenseMultiSearchResponse<T> = {
  results: Array<TypesenseSearchResult<T> | { error: string; code?: number }>
}

export type TypesenseSettledSearchResult<T> =
  | { status: "fulfilled"; value: TypesenseSearchResult<T> }
  | { status: "rejected"; reason: TypesenseSearchResultError }

type TypesenseRequestOptions = {
  acceptedStatuses?: readonly number[]
  responseType?: "json" | "text"
  timeoutMs?: number
}

export class TypesenseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = "TypesenseRequestError"
  }
}

export class TypesenseSearchResultError extends TypesenseRequestError {
  constructor(
    readonly typesenseError: string,
    status: number | null,
    readonly resultIndex: number,
  ) {
    super(`Typesense search failed: ${typesenseError}`, status)
    this.name = "TypesenseSearchResultError"
  }
}

export class TypesenseImportError extends TypesenseRequestError {
  constructor(readonly failures: Array<{ error: string; document?: unknown }>) {
    super(
      `Typesense rejected ${failures.length} imported document${failures.length === 1 ? "" : "s"}`,
    )
    this.name = "TypesenseImportError"
  }
}

function normalizeHost(host: string): string {
  return host.replace(/\/+$/, "")
}

export class TypesenseClient {
  private readonly host: string
  private readonly apiKey: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: TypesenseClientOptions) {
    this.host = normalizeHost(options.host)
    this.apiKey = options.apiKey
    this.timeoutMs = options.timeoutMs ?? 2_000
    this.fetchImpl = options.fetch ?? fetch
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    options: TypesenseRequestOptions = {},
  ): Promise<T> {
    const {
      acceptedStatuses = [],
      responseType = "json",
      timeoutMs = this.timeoutMs,
    } = options
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.host}${path}`, {
        ...init,
        headers: {
          "x-typesense-api-key": this.apiKey,
          ...init.headers,
        },
        signal: controller.signal,
      })
      if (!response.ok && !acceptedStatuses.includes(response.status)) {
        const body = await response.text().catch(() => "")
        throw new TypesenseRequestError(
          `Typesense ${init.method ?? "GET"} ${path} returned ${response.status}${body ? `: ${body}` : ""}`,
          response.status,
        )
      }
      if (response.status === 204 || response.status === 404) {
        return undefined as T
      }
      return (
        responseType === "text" ? await response.text() : await response.json()
      ) as T
    } catch (error) {
      if (error instanceof TypesenseRequestError) throw error
      if (controller.signal.aborted) {
        throw new TypesenseRequestError(
          `Typesense ${init.method ?? "GET"} ${path} timed out after ${timeoutMs}ms`,
        )
      }
      throw new TypesenseRequestError(
        `Typesense ${init.method ?? "GET"} ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  health(): Promise<{ ok: boolean }> {
    return this.request("/health")
  }

  createCollection(schema: TypesenseCollectionSchema): Promise<unknown> {
    return this.request("/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(schema),
    })
  }

  listCollections(): Promise<TypesenseCollection[]> {
    return this.request("/collections")
  }

  getCollectionSchema(name: string): Promise<TypesenseCollection> {
    return this.request(`/collections/${encodeURIComponent(name)}`)
  }

  deleteCollection(name: string): Promise<void> {
    return this.request(
      `/collections/${encodeURIComponent(name)}`,
      { method: "DELETE" },
      { acceptedStatuses: [404] },
    )
  }

  upsertAlias(alias: string, collectionName: string): Promise<unknown> {
    return this.request(`/aliases/${encodeURIComponent(alias)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collection_name: collectionName }),
    })
  }

  getAlias(alias: string): Promise<TypesenseAlias | undefined> {
    return this.request(
      `/aliases/${encodeURIComponent(alias)}`,
      {},
      {
        acceptedStatuses: [404],
      },
    )
  }

  deleteAlias(alias: string): Promise<void> {
    return this.request(
      `/aliases/${encodeURIComponent(alias)}`,
      { method: "DELETE" },
      { acceptedStatuses: [404] },
    )
  }

  async importDocuments<T extends object>(
    collection: string,
    documents: readonly T[],
    action: "create" | "upsert" = "create",
  ): Promise<void> {
    if (documents.length === 0) return
    const responseText = await this.request<string>(
      `/collections/${encodeURIComponent(collection)}/documents/import?action=${action}`,
      {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: documents.map((document) => JSON.stringify(document)).join("\n"),
      },
      { responseType: "text" },
    )
    const response = responseText
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            success: boolean
            error?: string
            document?: unknown
          },
      )
    const failures = response
      .filter((entry) => !entry.success)
      .map((entry) => ({
        error: entry.error ?? "Unknown Typesense import failure",
        document: entry.document,
      }))
    if (failures.length > 0) throw new TypesenseImportError(failures)
  }

  async deleteDocumentsByFilter(
    collection: string,
    filterBy: string,
  ): Promise<number> {
    const result = await this.request<{ num_deleted?: number }>(
      `/collections/${encodeURIComponent(collection)}/documents?filter_by=${encodeURIComponent(filterBy)}`,
      { method: "DELETE" },
    )
    return result.num_deleted ?? 0
  }

  async updateDocumentsByFilter<T extends object>(
    collection: string,
    filterBy: string,
    document: T,
  ): Promise<number> {
    const result = await this.request<{ num_updated?: number }>(
      `/collections/${encodeURIComponent(collection)}/documents?filter_by=${encodeURIComponent(filterBy)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(document),
      },
    )
    return result.num_updated ?? 0
  }

  async multiSearchSettled<T>(
    searches: readonly TypesenseSearchRequest[],
    options: { timeoutMs?: number } = {},
  ): Promise<TypesenseSettledSearchResult<T>[]> {
    const response = await this.request<TypesenseMultiSearchResponse<T>>(
      "/multi_search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ searches }),
      },
      { timeoutMs: options.timeoutMs },
    )
    if (!response || !Array.isArray(response.results)) {
      throw new TypesenseRequestError(
        "Typesense multi-search response is malformed",
      )
    }
    return response.results.map((result, resultIndex) =>
      "error" in result
        ? {
            status: "rejected",
            reason: new TypesenseSearchResultError(
              result.error,
              result.code ?? null,
              resultIndex,
            ),
          }
        : { status: "fulfilled", value: result },
    )
  }

  async multiSearch<T>(
    searches: readonly TypesenseSearchRequest[],
    options: { timeoutMs?: number } = {},
  ): Promise<TypesenseSearchResult<T>[]> {
    const results = await this.multiSearchSettled<T>(searches, options)
    const failed = results.find(
      (
        result,
      ): result is {
        status: "rejected"
        reason: TypesenseSearchResultError
      } => result.status === "rejected",
    )
    if (failed) {
      throw failed.reason
    }
    return results.map((result) => {
      if (result.status !== "fulfilled") {
        throw result.reason
      }
      return result.value
    })
  }
}
