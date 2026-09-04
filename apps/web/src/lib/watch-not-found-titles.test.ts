import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  WATCH_NOT_FOUND_METADATA_TITLES,
  WATCH_NOT_FOUND_METADATA_TITLE_SOURCE_CATALOG_COUNT,
} from "@forge/watch-url-policy/not-found-titles"
import { describe, expect, it } from "vitest"

const messagesDirectory = join(__dirname, "../../messages")

type WatchMessages = {
  WatchNotFound?: {
    metadataTitle?: unknown
  }
}

function messageCatalogTitles(): { files: string[]; titles: string[] } {
  const files = readdirSync(messagesDirectory)
    .filter((file) => file.endsWith(".json"))
    .sort()
  const titles = files.map((file) => {
    const messages = JSON.parse(
      readFileSync(join(messagesDirectory, file), "utf8"),
    ) as WatchMessages
    const title = messages.WatchNotFound?.metadataTitle
    expect(title, `${file} WatchNotFound.metadataTitle`).toBeTypeOf("string")
    expect((title as string).trim(), file).not.toBe("")
    return title as string
  })
  return { files, titles }
}

describe("shared Watch not-found metadata-title catalog", () => {
  it("matches every Web message catalog without stale or duplicate values", () => {
    const { files, titles } = messageCatalogTitles()
    const uniqueTitles = [...new Set(titles)].sort()

    expect(WATCH_NOT_FOUND_METADATA_TITLE_SOURCE_CATALOG_COUNT).toBe(
      files.length,
    )
    expect(WATCH_NOT_FOUND_METADATA_TITLES).toEqual(uniqueTitles)
    expect(new Set(WATCH_NOT_FOUND_METADATA_TITLES).size).toBe(
      WATCH_NOT_FOUND_METADATA_TITLES.length,
    )
  })
})
