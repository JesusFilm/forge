import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const routeDirectory = __dirname
const previewLayout = readFileSync(
  join(routeDirectory, "../../layout.tsx"),
  "utf8",
)
const page = readFileSync(join(routeDirectory, "page.tsx"), "utf8")
const proxy = readFileSync(join(routeDirectory, "../../../../proxy.ts"), "utf8")
const renderer = readFileSync(
  join(
    routeDirectory,
    "../../../../components/user-playlists/PublicUserPlaylistPage.tsx",
  ),
  "utf8",
)

describe("public playlist route privacy contract", () => {
  it("uses the analytics-free preview root and imports no browser telemetry", () => {
    expect(routeDirectory).toContain("(preview)/p/[capability]")
    for (const source of [previewLayout, page]) {
      expect(source).not.toMatch(/DatadogRum|GoogleAnalytics|datadog|gtag/i)
    }
  })

  it("uses hard no-referrer navigation and never initializes the Next client router", () => {
    expect(renderer).not.toMatch(/from ["']next\/link["']/)
    expect(renderer).toContain('referrerPolicy="no-referrer"')
    expect(renderer).toContain("<a")
  })

  it("rewrites to a stable internal segment and never reads the dynamic route params", () => {
    expect(proxy).toContain('PUBLIC_USER_PLAYLIST_INTERNAL_PATH = "/p/_render"')
    expect(page).not.toMatch(/\bparams\b/)
    expect(page).toContain("PUBLIC_USER_PLAYLIST_CAPABILITY_HEADER")
  })

  it("is dynamic, no-store, noindex, no-referrer, and emits no discovery metadata", () => {
    expect(page).toContain('dynamic = "force-dynamic"')
    expect(page).toContain("revalidate = 0")
    expect(page).toContain('fetchCache = "force-no-store"')
    expect(page).toContain('referrer: "no-referrer"')
    expect(page).toContain("index: false")
    expect(page).toContain("follow: false")
    expect(page).not.toMatch(/alternates|canonical|openGraph|twitter|jsonLd/i)
  })
})
