/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import {
  READER_ONBOARDING_STORAGE_KEY,
  createReaderOnboardingStore,
  parseStoredReaderOnboarding,
  serializeReaderOnboarding,
} from "../store"

function memoryStorage(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed))
  return {
    items,
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

describe("the reader onboarding store (R15, R16)", () => {
  it("starts with the hint live and the demo unplayed", async () => {
    const store = createReaderOnboardingStore(memoryStorage())
    expect(store.getSnapshot()).toMatchObject({
      status: "loading",
      hintRetired: false,
      demoPlayed: false,
    })
    await store.hydrate()
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      hintRetired: false,
      demoPlayed: false,
    })
  })

  it("keeps a retired hint and a played demo across a restart", async () => {
    const storage = memoryStorage()
    const first = createReaderOnboardingStore(storage)
    await first.hydrate()
    first.retireHint()
    first.markDemoPlayed()
    await settle()

    const restarted = createReaderOnboardingStore(storage)
    await restarted.hydrate()
    expect(restarted.getSnapshot()).toMatchObject({
      hintRetired: true,
      demoPlayed: true,
    })
  })

  it("keeps a live retire over the saved record that the read returns", async () => {
    const storage = memoryStorage({
      [READER_ONBOARDING_STORAGE_KEY]: serializeReaderOnboarding({
        hintRetired: false,
        demoPlayed: true,
      }),
    })
    const store = createReaderOnboardingStore(storage)
    store.retireHint()
    await store.hydrate()
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      hintRetired: true,
      demoPlayed: true,
    })
    expect(
      parseStoredReaderOnboarding(
        storage.items.get(READER_ONBOARDING_STORAGE_KEY) ?? null,
      ),
    ).toEqual({ hintRetired: true, demoPlayed: true })
  })

  it("reads junk, another version, and a bad field as the defaults", () => {
    expect(parseStoredReaderOnboarding(null)).toBeNull()
    expect(parseStoredReaderOnboarding("{")).toBeNull()
    expect(
      parseStoredReaderOnboarding(
        JSON.stringify({ version: 99, hintRetired: true, demoPlayed: true }),
      ),
    ).toBeNull()
    expect(
      parseStoredReaderOnboarding(
        JSON.stringify({ version: 1, hintRetired: "yes", demoPlayed: true }),
      ),
    ).toEqual({ hintRetired: false, demoPlayed: true })
  })
})
