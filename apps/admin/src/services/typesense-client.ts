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
  optional?: boolean
  sort?: boolean
  num_dim?: number
}

export type TypesenseCollectionSchema = {
  name: string
  fields: TypesenseCollectionField[]
  default_sorting_field?: string
  enable_nested_fields?: boolean
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
  text_match?: number
  text_match_info?: {
    score?: string
  }
  vector_distance?: number
}

export type TypesenseSearchResult<T> = {
  found: number
  out_of: number
  page: number
  search_time_ms: number
  hits: TypesenseSearchHit<T>[]
}

export type TypesenseAlias = {
  name: string
  collection_name: string
}

type TypesenseMultiSearchResponse<T> = {
  results: Array<TypesenseSearchResult<T> | { error: string; code?: number }>
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
    acceptedStatuses: readonly number[] = [],
    responseType: "json" | "text" = "json",
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
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
          `Typesense ${init.method ?? "GET"} ${path} timed out after ${this.timeoutMs}ms`,
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

  deleteCollection(name: string): Promise<void> {
    return this.request(
      `/collections/${encodeURIComponent(name)}`,
      { method: "DELETE" },
      [404],
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
    return this.request(`/aliases/${encodeURIComponent(alias)}`, {}, [404])
  }

  deleteAlias(alias: string): Promise<void> {
    return this.request(
      `/aliases/${encodeURIComponent(alias)}`,
      { method: "DELETE" },
      [404],
    )
  }

  async importDocuments<T extends object>(
    collection: string,
    documents: readonly T[],
  ): Promise<void> {
    if (documents.length === 0) return
    const responseText = await this.request<string>(
      `/collections/${encodeURIComponent(collection)}/documents/import?action=create`,
      {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: documents.map((document) => JSON.stringify(document)).join("\n"),
      },
      [],
      "text",
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

  async multiSearch<T>(
    searches: readonly TypesenseSearchRequest[],
  ): Promise<TypesenseSearchResult<T>[]> {
    const response = await this.request<TypesenseMultiSearchResponse<T>>(
      "/multi_search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ searches }),
      },
    )
    const failed = response.results.find(
      (result): result is { error: string; code?: number } => "error" in result,
    )
    if (failed) {
      throw new TypesenseRequestError(
        `Typesense search failed: ${failed.error}`,
        failed.code ?? null,
      )
    }
    return response.results as TypesenseSearchResult<T>[]
  }
}
