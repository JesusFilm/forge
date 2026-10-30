/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ExperienceSectionRenderer } from "./index"

afterEach(() => vi.unstubAllEnvs())

describe("WatchAudienceBlock dispatch", () => {
  it("recognises the authored block but mounts nothing: the audience frame is the one shared band", async () => {
    // Development is where the dispatch warns about an unhandled or
    // out-of-sync typename, so that is the environment that proves it is both
    // known and handled.
    vi.stubEnv("NODE_ENV", "development")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const container = document.createElement("div")
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <ExperienceSectionRenderer
          section={
            {
              __typename: "WatchAudienceBlock",
              t: "watchAudience",
              sectionKey: "watch-audience",
              configurationJson: '{"roles":[]}',
            } as never
          }
          languageSlug="english"
        />,
      )
    })

    expect(container.innerHTML).toBe("")
    expect(warn).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})
