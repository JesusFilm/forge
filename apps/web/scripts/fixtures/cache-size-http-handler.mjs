import CacheSizeFixtureHandler from "./cache-size-handler.mjs"

// Next creates handler instances per request. Share the bounded probe's entries
// across those instances, as an external store would. No Redis or production data.
const entries = new Map()

export default class CacheSizeHttpFixtureHandler extends CacheSizeFixtureHandler {
  entries = entries
}
