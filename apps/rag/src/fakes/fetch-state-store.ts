/**
 * In-memory FetchStateStore fake — the http-cache + robots-cache state
 * Acquisition reads/writes, with no Postgres. Entries are copied on write so
 * callers can't mutate stored state by reference.
 */
import type {
  FetchStateStore,
  HttpCacheEntry,
  RobotsEntry,
} from "../contracts/index.js"

export class FakeFetchStateStore implements FetchStateStore {
  private readonly httpCache = new Map<string, HttpCacheEntry>()
  private readonly robotsCache = new Map<string, RobotsEntry>()

  async getHttpCache(url: string): Promise<HttpCacheEntry | null> {
    const entry = this.httpCache.get(url)
    return entry ? { ...entry } : null
  }

  async putHttpCache(entry: HttpCacheEntry): Promise<void> {
    this.httpCache.set(entry.url, { ...entry })
  }

  async getRobots(robotsUrl: string): Promise<RobotsEntry | null> {
    const entry = this.robotsCache.get(robotsUrl)
    return entry ? { ...entry } : null
  }

  async putRobots(entry: RobotsEntry): Promise<void> {
    this.robotsCache.set(entry.robotsUrl, { ...entry })
  }
}
