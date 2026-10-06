// The pass runner shared by the reminder and widget writers.
import { attachPassTriggers, createPassRunner } from "../passRunner"

function idle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("createPassRunner", () => {
  it("runs the next pass after a failed one, and the failure reaches no caller", async () => {
    const runOnce = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error("native call failed"))
      .mockResolvedValue(undefined)
    const runPass = createPassRunner(runOnce)

    await expect(runPass()).resolves.toBeUndefined()
    await expect(runPass()).resolves.toBeUndefined()
    expect(runOnce).toHaveBeenCalledTimes(2)
  })

  it("folds requests before a pass starts into that pass", async () => {
    const runOnce = jest.fn(async () => {})
    const runPass = createPassRunner(runOnce)
    const first = runPass()
    expect(runPass()).toBe(first)
    await first
    expect(runOnce).toHaveBeenCalledTimes(1)
  })
})

describe("attachPassTriggers", () => {
  it("runs a pass now, on a return to the foreground, and on a store change, until it is detached", async () => {
    const runPass = jest.fn(async () => {})
    let appState: ((state: string) => void) | null = null
    let store: (() => void) | null = null
    const detach = attachPassTriggers({
      runPass,
      subscribeToAppState: (listener) => {
        appState = listener
        return () => {
          appState = null
        }
      },
      subscribeToStore: (listener) => {
        store = listener
        return () => {
          store = null
        }
      },
    })
    expect(runPass).toHaveBeenCalledTimes(1)
    appState!("background")
    appState!("active")
    store!()
    await idle()
    expect(runPass).toHaveBeenCalledTimes(3)

    detach()
    expect(appState).toBeNull()
    expect(store).toBeNull()
  })
})
