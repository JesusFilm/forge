/**
 * The first composition-root test in this app.
 *
 * `ExperienceProvider` is the section index both SDUI routes resolve through —
 * `app/video/[sectionKey].tsx` and `app/collection/[sectionKey].tsx` each call
 * `useSectionByKey`. Nothing exercised it before: 2,207 tests and this was one
 * of the seven contexts that no suite ever mounted. Its indexing logic is not
 * extractable into a pure function, so a pure test cannot reach it.
 *
 * It takes its data as PROPS, so it needs no Apollo. Only `useVideoThumbnails`
 * is faked, because it fetches.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests").
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})

// Fetches on mount; the section index under test does not depend on it.
jest.mock("../../hooks/useVideoThumbnails", () => ({
  useVideoThumbnails: () => new Map(),
}))

import { act } from "react"
import type React from "react"

import {
  ExperienceProvider,
  useSectionByKey,
  useExperienceContext,
} from "../ExperienceProvider"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

type Block = Record<string, unknown>

function videoBlock(sectionKey: string, title: string): Block {
  return { __typename: "VideoBlock", sectionKey, title }
}

/** Mounts the provider over a probe that resolves one key. */
function resolve(blocks: unknown[], key: string) {
  let seen: unknown
  function Probe() {
    seen = useSectionByKey(key)
    return null
  }
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      (
        <ExperienceProvider
          experience={{ blocks } as never}
          loading={false}
          error={null}
          refetch={() => {}}
        >
          <Probe />
        </ExperienceProvider>
      ) as unknown as React.ReactElement,
    )
  })
  act(() => renderer.unmount())
  return seen as Block | undefined
}

describe("ExperienceProvider section index", () => {
  it("resolves a top-level block by its sectionKey", () => {
    const found = resolve([videoBlock("a", "Alpha")], "a")
    expect(found?.title).toBe("Alpha")
  })

  it("returns undefined for a key nothing carries", () => {
    expect(resolve([videoBlock("a", "Alpha")], "missing")).toBeUndefined()
  })

  it("ignores a block with no sectionKey rather than indexing it as empty", () => {
    const found = resolve(
      [{ __typename: "TextBlock", body: "no key here" }, videoBlock("a", "A")],
      "",
    )
    expect(found).toBeUndefined()
  })

  // KNOWN LIMITATION, pinned deliberately. Admin sectionKeys are NOT unique —
  // PR #1705 fixed a collision on the Home rails and never touched this file.
  // `map.set` means the LAST block wins and the first becomes unreachable, so
  // a viewer tapping the first card opens the second card's video. If anyone
  // makes these keys collision-safe, this is the test that should change.
  it("collapses two blocks that share a sectionKey, keeping the last", () => {
    const found = resolve(
      [videoBlock("dup", "First"), videoBlock("dup", "Second")],
      "dup",
    )
    expect(found?.title).toBe("Second")
  })

  it("indexes children nested inside a SectionBlock", () => {
    const found = resolve(
      [
        {
          __typename: "SectionBlock",
          sectionKey: "outer",
          sectionContent: [videoBlock("inner", "Nested")],
        },
      ],
      "inner",
    )
    expect(found?.title).toBe("Nested")
  })

  it("gives a SectionBlock child its siblings, so a detail route can list them", () => {
    const found = resolve(
      [
        {
          __typename: "SectionBlock",
          sectionKey: "outer",
          sectionContent: [videoBlock("one", "One"), videoBlock("two", "Two")],
        },
      ],
      "one",
    )
    const siblings = found?.siblingContent as Block[] | undefined
    expect(siblings?.map((s) => s.sectionKey)).toEqual(["one", "two"])
  })

  it("walks a ContainerBlock's flat content and skips the slot markers", () => {
    const found = resolve(
      [
        {
          __typename: "ContainerBlock",
          sectionKey: "grid",
          content: [
            { __typename: "ContainerSlotBlock", sectionKey: "slot-marker" },
            videoBlock("in-container", "Inside"),
          ],
        },
      ],
      "in-container",
    )
    expect(found?.title).toBe("Inside")
  })

  it("never indexes a ContainerSlotBlock, even though it carries a sectionKey", () => {
    const found = resolve(
      [
        {
          __typename: "ContainerBlock",
          sectionKey: "grid",
          content: [
            { __typename: "ContainerSlotBlock", sectionKey: "slot-marker" },
          ],
        },
      ],
      "slot-marker",
    )
    expect(found).toBeUndefined()
  })

  it("survives a null experience without throwing", () => {
    let seen: unknown = "unset"
    function Probe() {
      seen = useSectionByKey("anything")
      return null
    }
    let renderer!: TestInstance
    act(() => {
      renderer = TestRenderer.create(
        (
          <ExperienceProvider
            experience={null}
            loading
            error={null}
            refetch={() => {}}
          >
            <Probe />
          </ExperienceProvider>
        ) as unknown as React.ReactElement,
      )
    })
    expect(seen).toBeUndefined()
    act(() => renderer.unmount())
  })

  it("passes loading, error and refetch straight through to consumers", () => {
    const refetch = jest.fn()
    let ctx: ReturnType<typeof useExperienceContext> | undefined
    function Probe() {
      ctx = useExperienceContext()
      return null
    }
    let renderer!: TestInstance
    act(() => {
      renderer = TestRenderer.create(
        (
          <ExperienceProvider
            experience={null}
            loading
            error="boom"
            refetch={refetch}
          >
            <Probe />
          </ExperienceProvider>
        ) as unknown as React.ReactElement,
      )
    })
    expect(ctx?.loading).toBe(true)
    expect(ctx?.error).toBe("boom")
    ctx?.refetch()
    expect(refetch).toHaveBeenCalledTimes(1)
    act(() => renderer.unmount())
  })
})
