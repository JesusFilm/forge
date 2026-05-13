/**
 * U9 (plan-003 PR-B) — slug-page feature-flag short-circuit tests.
 *
 * Runs in the default `node` environment (NOT jsdom): the page module
 * reads `env.FORGE_DISABLE_WATCH_ROUTES` at module scope, and t3-oss's
 * `@t3-oss/env-nextjs` throws "Attempted to access a server-side
 * environment variable on the client" when `window` is defined (the
 * jsdom env defines it). `react-dom/server`'s `renderToStaticMarkup`
 * works in node without DOM globals.
 *
 * Verifies that `FORGE_DISABLE_WATCH_ROUTES`:
 *   - When set and the route matches: <MaintenanceFallback> renders BEFORE
 *     any data fetch (`resolveWatchPage` MUST NOT be called).
 *   - When unset: normal rendering proceeds through `resolveWatchPage`.
 *   - When malformed (entries missing the leading "/"): warns and
 *     falls-through to normal rendering (a typo'd entry MUST NOT brick
 *     the route).
 *
 * The `DISABLED_ROUTES` set is built at module scope, so each test
 * uses `vi.resetModules()` + `vi.doMock()` to re-evaluate the page module
 * with the appropriate env value.
 */

import { renderToStaticMarkup } from "react-dom/server"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest"

const ORIGINAL_FORGE_DISABLE_WATCH_ROUTES =
  process.env.FORGE_DISABLE_WATCH_ROUTES

async function loadPageWithEnv(envValue: string | undefined): Promise<{
  SlugPage: (props: {
    params: Promise<{ slug: string }>
  }) => Promise<React.ReactElement>
  resolveWatchPageMock: Mock
}> {
  // Reset modules so the page module re-evaluates its module-scope
  // DISABLED_ROUTES initializer against the new env value.
  vi.resetModules()
  if (envValue === undefined) {
    delete process.env.FORGE_DISABLE_WATCH_ROUTES
  } else {
    process.env.FORGE_DISABLE_WATCH_ROUTES = envValue
  }

  const resolveWatchPageMock = vi.fn().mockResolvedValue({
    data: { kind: "experience", experience: { blocks: [] } },
    error: null,
  })

  vi.doMock("@/lib/content", () => ({
    resolveWatchPage: resolveWatchPageMock,
    isWatchPageMissingError: (_e: unknown) => false,
  }))
  vi.doMock("@/lib/experience-metadata", () => ({
    getWatchPageMetadata: vi.fn().mockResolvedValue({}),
  }))
  vi.doMock("@/components/sections", () => ({
    SectionRenderer: () => null,
  }))

  const mod = await import("./page")
  return {
    SlugPage: mod.default as (props: {
      params: Promise<{ slug: string }>
    }) => Promise<React.ReactElement>,
    resolveWatchPageMock,
  }
}

describe("SlugPage — FORGE_DISABLE_WATCH_ROUTES short-circuit", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.doUnmock("@/lib/content")
    vi.doUnmock("@/lib/experience-metadata")
    vi.doUnmock("@/components/sections")
    if (ORIGINAL_FORGE_DISABLE_WATCH_ROUTES === undefined) {
      delete process.env.FORGE_DISABLE_WATCH_ROUTES
    } else {
      process.env.FORGE_DISABLE_WATCH_ROUTES =
        ORIGINAL_FORGE_DISABLE_WATCH_ROUTES
    }
  })

  // ---------------------------------------------------------------------------
  // Happy path: flag set + route matches → MaintenanceFallback renders
  // ---------------------------------------------------------------------------

  it("renders MaintenanceFallback when FORGE_DISABLE_WATCH_ROUTES matches the slug", async () => {
    const { SlugPage, resolveWatchPageMock } =
      await loadPageWithEnv("/broken-slug")

    const element = await SlugPage({
      params: Promise.resolve({ slug: "broken-slug" }),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain("Temporarily unavailable")
    expect(html).toContain("undergoing maintenance")
    // Data fetch MUST be short-circuited BEFORE resolveWatchPage runs.
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })

  it("renders MaintenanceFallback for an entry mid-CSV (whitespace tolerated)", async () => {
    const { SlugPage, resolveWatchPageMock } = await loadPageWithEnv(
      "/other, /broken-slug ,/another",
    )

    const element = await SlugPage({
      params: Promise.resolve({ slug: "broken-slug" }),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain("Temporarily unavailable")
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })

  it("does NOT short-circuit non-matching slugs even when the flag is set", async () => {
    const { SlugPage, resolveWatchPageMock } =
      await loadPageWithEnv("/broken-slug")

    await SlugPage({
      params: Promise.resolve({ slug: "ok-slug" }),
    })

    // resolveWatchPage IS called for non-matching slugs.
    expect(resolveWatchPageMock).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // Flag unset → normal rendering
  // ---------------------------------------------------------------------------

  it("renders normally (no short-circuit) when FORGE_DISABLE_WATCH_ROUTES is unset", async () => {
    const { SlugPage, resolveWatchPageMock } = await loadPageWithEnv(undefined)

    await SlugPage({
      params: Promise.resolve({ slug: "any-slug" }),
    })

    expect(resolveWatchPageMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("renders normally when FORGE_DISABLE_WATCH_ROUTES is an empty string", async () => {
    const { SlugPage, resolveWatchPageMock } = await loadPageWithEnv("")

    await SlugPage({
      params: Promise.resolve({ slug: "any-slug" }),
    })

    expect(resolveWatchPageMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Malformed CSV → warn-and-fall-through (typo does NOT brick the route)
  // ---------------------------------------------------------------------------

  it("warns and falls through when CSV entries are missing the leading '/'", async () => {
    // Note: "broken-slug" (no leading slash) is the operator typo. The
    // page-module match key is `/${slug}` so this entry can never match —
    // the warn surfaces the misconfig in deploy logs.
    const { SlugPage, resolveWatchPageMock } =
      await loadPageWithEnv("broken-slug")

    await SlugPage({
      params: Promise.resolve({ slug: "broken-slug" }),
    })

    // Falls through to normal rendering.
    expect(resolveWatchPageMock).toHaveBeenCalledTimes(1)
    // Operator-visible warn emitted at module import time.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("do not start with"),
    )
  })

  it("warns about the malformed entry but still honors well-formed entries on the same CSV", async () => {
    const { SlugPage, resolveWatchPageMock } = await loadPageWithEnv(
      "bad-no-slash,/good-slash",
    )

    // Well-formed entry still short-circuits.
    const element = await SlugPage({
      params: Promise.resolve({ slug: "good-slash" }),
    })
    const html = renderToStaticMarkup(element)
    expect(html).toContain("Temporarily unavailable")
    expect(resolveWatchPageMock).not.toHaveBeenCalled()

    // Warn fired for the malformed entry.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("bad-no-slash"),
    )
  })
})
