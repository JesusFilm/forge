// Behavioural coverage for watchProgressSync's WIRING — the review found the
// completion drain fully undiscriminated (deleting it reverted todo 025 with a
// green suite). The Apollo client is mocked at the module boundary, so the
// real submit/remove functions run against a fake `mutate` — this is the one
// place their ordering rules (drain rides the push, clear only after accept,
// local removal never waits on the network) can go red.

// `mock`-prefixed so jest's out-of-scope guard admits them into the factories.
const mockMutate = jest.fn()
const mockQuery = jest.fn()
const mockGetValidAccessToken = jest.fn(
  async (): Promise<string | null> => "tok",
)

jest.mock("../apolloClient", () => ({
  getApolloClient: () => ({
    mutate: mockMutate,
    query: mockQuery,
    clearStore: jest.fn(),
  }),
}))

jest.mock("../auth/session", () => ({
  getValidAccessToken: () => mockGetValidAccessToken(),
}))

import { _resetStorageForTests } from "../safeStorage"
import { writeLocalUserMarker } from "../auth/anonymousMerge"
import {
  readPendingCompletions,
  loadContinueWatching,
  saveResumeSnapshot,
} from "./continueWatching"
import {
  removeFromContinueWatching,
  submitContinueWatchingToAccount,
} from "./watchProgressSync"

beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
})

beforeEach(() => {
  _resetStorageForTests()
  mockMutate.mockReset()
  mockQuery.mockReset()
  mockGetValidAccessToken.mockReset()
  mockGetValidAccessToken.mockResolvedValue("tok")
})

const CARD = {
  videoId: "video-1",
  slug: "stunned",
  title: "Stunned",
  imageUrl: null,
  updatedAt: "2026-08-10T00:00:00.000Z",
}

async function seedCompletion(): Promise<void> {
  await saveResumeSnapshot(CARD, { positionSeconds: 600, durationSeconds: 600 })
  expect(await readPendingCompletions()).toHaveLength(1)
}

describe("submitContinueWatchingToAccount — completion drain (todo 025)", () => {
  it("rides pending completions on the push even with an empty shelf", async () => {
    await seedCompletion()
    mockMutate.mockResolvedValueOnce({ data: { upsertMyWatchProgress: [] } })

    await expect(submitContinueWatchingToAccount([])).resolves.toBe(true)

    // Deleting the drain makes THIS red: the mutate must carry the terminal
    // completion row, not just the (empty) shelf.
    expect(mockMutate).toHaveBeenCalledTimes(1)
    const variables = mockMutate.mock.calls[0]![0].variables as {
      entries: Array<{ videoId: string; positionSeconds: number }>
    }
    expect(variables.entries).toEqual([
      expect.objectContaining({
        videoId: "video-1",
        videoSlug: "stunned",
        positionSeconds: 600,
        durationSeconds: 600,
      }),
    ])
    // ...and the bucket clears only because the server ACCEPTED.
    expect(await readPendingCompletions()).toEqual([])
  })

  it("retains the completion when the server does not accept", async () => {
    await seedCompletion()
    mockMutate.mockResolvedValueOnce({ data: {} })

    await expect(submitContinueWatchingToAccount([])).resolves.toBe(false)
    expect(await readPendingCompletions()).toHaveLength(1)
  })

  it("retains the completion when the mutation throws", async () => {
    await seedCompletion()
    mockMutate.mockRejectedValueOnce(new Error("network"))

    await expect(submitContinueWatchingToAccount([])).resolves.toBe(false)
    expect(await readPendingCompletions()).toHaveLength(1)
  })

  it("retains the completion when signed out, without calling the network", async () => {
    await seedCompletion()
    mockGetValidAccessToken.mockResolvedValueOnce(null)

    await expect(submitContinueWatchingToAccount([])).resolves.toBe(false)
    expect(mockMutate).not.toHaveBeenCalled()
    expect(await readPendingCompletions()).toHaveLength(1)
  })

  it("reports success with nothing to send and never touches the network", async () => {
    await expect(submitContinueWatchingToAccount([])).resolves.toBe(true)
    expect(mockMutate).not.toHaveBeenCalled()
  })
})

describe("removeFromContinueWatching", () => {
  it("resolves after the LOCAL removal even while the account clear hangs", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 120,
      durationSeconds: 600,
    })
    await writeLocalUserMarker("user-a")
    // A mutate that never settles — the caller must not wait on it (the
    // pressed card lingered for the transport ceiling when it did).
    mockMutate.mockReturnValueOnce(new Promise(() => {}))

    await removeFromContinueWatching("video-1")

    expect(await loadContinueWatching()).toEqual([])
  })

  it("clears the account row when the shelf is OWNED", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 120,
      durationSeconds: 600,
    })
    await writeLocalUserMarker("user-a")
    mockMutate.mockResolvedValueOnce({ data: { clearMyWatchProgress: true } })

    await removeFromContinueWatching("video-1")
    // The clear is detached; drain the microtask queue before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockMutate).toHaveBeenCalledTimes(1)
    expect(mockMutate.mock.calls[0]![0].variables).toEqual({
      videoId: "video-1",
    })
  })

  it("does NOT touch the account for an UNOWNED shelf (previous viewer's leftovers)", async () => {
    await saveResumeSnapshot(CARD, {
      positionSeconds: 120,
      durationSeconds: 600,
    })
    // No marker: interrupted sign-out state. Clearing MY account's row
    // because of THEIR card is the wrong direction.
    mockMutate.mockResolvedValueOnce({ data: { clearMyWatchProgress: true } })

    await removeFromContinueWatching("video-1")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(await loadContinueWatching()).toEqual([])
    expect(mockMutate).not.toHaveBeenCalled()
  })
})
