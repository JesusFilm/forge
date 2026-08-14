/**
 * R11's non-route sheets (U7). The two sheets that own no route report their
 * own open state, so the only thing worth proving here is BALANCE: the count
 * must come back to zero however the sheet goes away, including an unmount
 * while it is still open. A stranded count hides every later window until the
 * app relaunches.
 */

// Loud, not inert: every case injects its own counter, so reaching the app-wide
// one is a defect in the test rather than a fallback.
jest.mock("../../lib/miniPlayer", () => ({
  getMiniPlayerSheets: () => {
    throw new Error("useMiniPlayerSheet test reached the singleton counter")
  },
}))

import { StrictMode, act } from "react"

import { useMiniPlayerSheet } from "../useMiniPlayerSheet"
import {
  createSheetCounter,
  type SheetCounter,
} from "../../lib/miniPlayer/suppression"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

let sheets: SheetCounter
let live: TestInstance[] = []

function Probe({ open, sheets }: { open: boolean; sheets: SheetCounter }) {
  useMiniPlayerSheet(open, sheets)
  return null
}

async function mount(open: boolean, strict = false) {
  const element = <Probe open={open} sheets={sheets} />
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      strict ? <StrictMode>{element}</StrictMode> : element,
    )
  })
  live.push(renderer)
  return {
    renderer,
    async set(next: boolean) {
      const nextElement = <Probe open={next} sheets={sheets} />
      await act(async () => {
        renderer.update(
          strict ? <StrictMode>{nextElement}</StrictMode> : nextElement,
        )
      })
    },
  }
}

beforeEach(() => {
  sheets = createSheetCounter()
  live = []
})

afterEach(async () => {
  for (const renderer of live) {
    await act(async () => {
      try {
        renderer.unmount()
      } catch {
        // Already unmounted by the test itself.
      }
    })
  }
  live = []
})

describe("useMiniPlayerSheet", () => {
  it("counts nothing while the sheet is closed", async () => {
    await mount(false)

    expect(sheets.getCount()).toBe(0)
  })

  it("counts the sheet while it is open", async () => {
    await mount(true)

    expect(sheets.getCount()).toBe(1)
  })

  it("releases the count when the sheet closes", async () => {
    const { set } = await mount(true)

    await set(false)

    expect(sheets.getCount()).toBe(0)
  })

  it("releases the count when the owner unmounts mid-sheet", async () => {
    // The case a close handler cannot cover, and the one that strands the
    // count: the screen goes away with its sheet still on screen.
    const { renderer } = await mount(true)

    await act(async () => {
      renderer.unmount()
    })

    expect(sheets.getCount()).toBe(0)
  })

  it("stays balanced through a StrictMode remount", async () => {
    // Dev StrictMode runs setup, cleanup, setup on the same hook instance. A
    // release that ran without a matching claim would leave this at zero.
    await mount(true, true)

    expect(sheets.getCount()).toBe(1)
  })

  it("re-asserts its claim after the host resets the counter", async () => {
    // The desync: the host resets on session end, but this sheet is still on
    // screen. The next session's window would otherwise float over it.
    await mount(true)
    expect(sheets.getCount()).toBe(1)

    await act(async () => {
      sheets.reset()
    })

    expect(sheets.getCount()).toBe(1)
  })

  it("re-asserts EVERY live claim, not just the first", async () => {
    // The re-entrancy case: the first re-assert notifies again mid-reset, and
    // a listener that read the raw count would then stand down.
    await mount(true)
    await mount(true)

    await act(async () => {
      sheets.reset()
    })

    expect(sheets.getCount()).toBe(2)
  })

  it("never re-asserts a claim whose owner has gone", async () => {
    // A reset must still clear a stranded count. Only a live sheet re-claims.
    const first = await mount(true)
    await mount(true)
    await act(async () => {
      first.renderer.unmount()
    })
    expect(sheets.getCount()).toBe(1)

    await act(async () => {
      sheets.reset()
    })

    expect(sheets.getCount()).toBe(1)
  })

  it("counts two overlapping sheets independently", async () => {
    const first = await mount(true)
    await mount(true)
    expect(sheets.getCount()).toBe(2)

    await first.set(false)

    // A boolean here would let the first close reveal the window under the
    // second, which is the reason U4 made this a counter.
    expect(sheets.getCount()).toBe(1)
  })
})
