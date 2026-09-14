/**
 * The thumbnail fetch is gated on focus (feat-500). Under the native tab bar
 * every tab mounts at cold launch, so an ungated mount fires six WATCH_SEARCH
 * queries before the viewer has opened Search.
 *
 * No behavioural test could see this before: the hook had no `enabled` seam
 * and its one call site passed nothing.
 */
import { act } from "react"

import { TestRenderer } from "../../test-utils/rnTestRenderer"
import { useCategoryThumbnails } from "../useCategoryThumbnails"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockQuery = jest.fn(() => new Promise(() => {}))
jest.mock("../../lib/apolloClient", () => ({
  getApolloClient: () => ({ query: mockQuery }),
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { warn: () => {}, error: () => {}, info: () => {} },
  reportDatadogError: () => {},
}))

function Probe({ enabled }: { enabled: boolean }) {
  useCategoryThumbnails(enabled)
  return null
}

async function mount(enabled: boolean) {
  await act(async () => {
    TestRenderer.create(<Probe enabled={enabled} />)
  })
}

beforeEach(() => {
  mockQuery.mockClear()
})

it("fires NOTHING while the tab is unfocused", async () => {
  await mount(false)
  expect(mockQuery).not.toHaveBeenCalled()
})

it("fetches once the tab takes focus", async () => {
  // Anti-vacuous partner to the test above: without this, deleting the fetch
  // entirely would leave that assertion green. Falsified by hand — inverting
  // the guard to `if (enabled) return` turns both cases red.
  //
  // Keep this the ONLY enabled mount in the file. The hook's `inFlight` set is
  // module scope and the mocked query never settles, so a second enabled mount
  // finds every term already claimed and issues nothing.
  await mount(true)
  expect(mockQuery).toHaveBeenCalled()
})
