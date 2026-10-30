import type { CacheValueSerializer } from "@fortedigital/nextjs-cache-handler/redis-strings"

type CacheStore = {
  name: string
  get(key: string, meta: { implicitTags: string[] }): Promise<unknown>
  set(key: string, value: unknown, ctx?: unknown): Promise<void>
}

export const timedJsonSerializer: CacheValueSerializer

export function instrumentStore<Store extends CacheStore>(store: Store): Store

// Narrow view for tests; Next constructs the class with its full context.
export class InstrumentedCacheHandler {
  constructor(context: { dev: boolean; serverDistDir: string })
  get(
    cacheKey: string,
    ctx?: { kind?: string; softTags?: string[] },
  ): Promise<unknown>
  set(cacheKey: string, value: unknown, ctx?: unknown): Promise<void>
}

export default InstrumentedCacheHandler
