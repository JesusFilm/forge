/**
 * The collapse-and-expand state behind the Explore clip's "more" and the watch
 * page's "Read more". The first case reproduces the Galaxy S20 order: the
 * hidden copy's layout event arrives before React runs the mount's effects.
 */

import { act, useLayoutEffect } from "react"

import { useTextOverflow, type TextLayoutEvent } from "../useTextOverflow"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

type Probe = ReturnType<typeof useTextOverflow>

const probe: { current: Probe | null } = { current: null }
const mounted: TestInstance[] = []

function overflowsOneLine(e: TextLayoutEvent): boolean {
  return e.nativeEvent.lines.length > 1
}

function Harness({
  text,
  measureOnCommit = false,
}: {
  text: string | null
  measureOnCommit?: boolean
}) {
  const state = useTextOverflow(text, overflowsOneLine)
  probe.current = state
  // A layout effect runs after the commit and before the passive effects,
  // the same window a fast native layout event lands in on a device.
  // Mount only, as the first layout event of the hidden copy.
  useLayoutEffect(() => {
    if (measureOnCommit) state.handleMeasureLayout(layout(3))
  }, [])
  return null
}

function layout(lineCount: number): TextLayoutEvent {
  return {
    nativeEvent: {
      lines: Array.from({ length: lineCount }, () => ({})),
    },
  } as unknown as TextLayoutEvent
}

function current(): Probe {
  if (probe.current == null) throw new Error("the harness has not rendered")
  return probe.current
}

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  probe.current = null
})

describe("useTextOverflow", () => {
  it("keeps an overflow measured before the mount's effects run", () => {
    let renderer!: TestInstance
    act(() => {
      renderer = TestRenderer.create(
        <Harness text="A long line" measureOnCommit />,
      )
    })
    mounted.push(renderer)

    expect(current().overflows).toBe(true)
  })

  it("is unmeasured and collapsed for new text, then measures it", () => {
    let renderer!: TestInstance
    act(() => {
      renderer = TestRenderer.create(<Harness text="First" />)
    })
    mounted.push(renderer)
    act(() => {
      current().handleMeasureLayout(layout(3))
      current().setExpanded(true)
    })
    expect(current()).toMatchObject({ overflows: true, expanded: true })

    act(() => {
      renderer.update(<Harness text="Second" />)
    })
    // A stale true would show a dead toggle over text that fits.
    expect(current()).toMatchObject({ overflows: null, expanded: false })

    act(() => {
      current().handleMeasureLayout(layout(1))
    })
    expect(current().overflows).toBe(false)
  })

  it("toggles with an updater, as the watch page does", () => {
    let renderer!: TestInstance
    act(() => {
      renderer = TestRenderer.create(<Harness text="Text" />)
    })
    mounted.push(renderer)

    act(() => {
      current().setExpanded((open) => !open)
    })
    expect(current().expanded).toBe(true)
    act(() => {
      current().setExpanded((open) => !open)
    })
    expect(current().expanded).toBe(false)
  })
})
