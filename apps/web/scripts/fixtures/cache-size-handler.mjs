import { Buffer } from "node:buffer"
import { setImmediate } from "node:timers"

// Synthetic storage seam: optional base64/JSON encoding approximates storage
// work. There is no Redis, network, invalidation or real Watch data in this fixture.
export default class CacheSizeFixtureHandler {
  entries = new Map()
  writes = []
  storageCodec = false

  async get(key) {
    await new Promise((resolve) => setImmediate(resolve))
    const entry = this.entries.get(key)
    if (!entry) return null
    if (!entry.serialized) return entry
    const value = JSON.parse(entry.serialized)
    value.rscData = Buffer.from(value.rscData, "base64")
    return { value, lastModified: entry.lastModified }
  }

  async set(key, value, context) {
    this.writes.push({ key, value, context })
    if (this.storageCodec) {
      const serialized = JSON.stringify({
        ...value,
        rscData: value.rscData.toString("base64"),
      })
      this.entries.set(key, { serialized, lastModified: Date.now() })
    } else {
      this.entries.set(key, { value, lastModified: Date.now() })
    }
  }
}
