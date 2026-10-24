/**
 * The one re-check both push write paths call when admin refuses the viewer
 * handle. The callers inject or mock it, so this suite is what pins that it
 * really reaches the store, scoped to the refused token, and never throws.
 */

const mockInvalidate = jest.fn<Promise<void>, [string?]>(async () => undefined)

jest.mock("../../recommendations/viewerIdentityClient", () => ({
  getRecommendationViewerStore: () => ({ invalidate: mockInvalidate }),
}))

import { recheckPushViewerHandle } from "../viewerHandle"

const REFUSED = "r".repeat(43)

beforeEach(() => {
  mockInvalidate.mockReset()
  mockInvalidate.mockResolvedValue(undefined)
})

it("asks the viewer store to re-check exactly the refused token", async () => {
  await recheckPushViewerHandle(REFUSED)

  expect(mockInvalidate).toHaveBeenCalledTimes(1)
  expect(mockInvalidate).toHaveBeenCalledWith(REFUSED)
})

it("resolves when the store's re-check rejects", async () => {
  mockInvalidate.mockRejectedValue(new Error("store unavailable"))

  await expect(recheckPushViewerHandle(REFUSED)).resolves.toBeUndefined()
})
