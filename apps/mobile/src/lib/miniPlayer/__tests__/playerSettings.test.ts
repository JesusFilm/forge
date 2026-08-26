import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_QUALITY_TIER,
  PLAYBACK_SPEEDS,
  createPlayerSettingsStore,
  effectivePlayerSettings,
  getPlayerSettingsStore,
  type PlaybackSpeed,
} from "../playerSettings"

describe("defaults", () => {
  it("starts at 1x speed, auto quality, and no content key (R4, R6)", () => {
    expect(createPlayerSettingsStore().getSnapshot()).toEqual({
      speed: 1,
      qualityTier: "auto",
      contentKey: null,
    })
    expect(DEFAULT_PLAYBACK_SPEED).toBe(1)
    expect(DEFAULT_QUALITY_TIER).toBe("auto")
  })

  it("offers exactly the seven speed steps (R4)", () => {
    expect(PLAYBACK_SPEEDS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])
  })
})

describe("setSpeed", () => {
  it.each(PLAYBACK_SPEEDS.map((speed) => [speed] as [PlaybackSpeed]))(
    "accepts %s",
    (speed) => {
      const store = createPlayerSettingsStore()
      store.setSpeed(speed)
      expect(store.getSnapshot().speed).toBe(speed)
    },
  )

  it.each([[0], [0.9], [3], [-1], [Number.NaN]])(
    "rejects the out-of-set value %s",
    (speed) => {
      const store = createPlayerSettingsStore()
      store.setSpeed(1.5)
      store.setSpeed(speed)
      expect(store.getSnapshot().speed).toBe(1.5)
    },
  )
})

describe("setQualityTier / setContentKey", () => {
  it("stores the tier and the content key", () => {
    const store = createPlayerSettingsStore()
    store.setContentKey("id:video-1")
    store.setQualityTier("high")
    expect(store.getSnapshot()).toEqual({
      speed: 1,
      qualityTier: "high",
      contentKey: "id:video-1",
    })
  })
})

describe("subscribe", () => {
  it("notifies on a change and stops after unsubscribe", () => {
    const store = createPlayerSettingsStore()
    let notified = 0
    const unsubscribe = store.subscribe(() => {
      notified += 1
    })
    store.setQualityTier("low")
    expect(notified).toBe(1)
    unsubscribe()
    store.setSpeed(2)
    expect(notified).toBe(1)
  })

  it("does not notify when the value does not change", () => {
    const store = createPlayerSettingsStore()
    store.setSpeed(1.25)
    let notified = 0
    store.subscribe(() => {
      notified += 1
    })
    store.setSpeed(1.25)
    store.setQualityTier("auto")
    expect(notified).toBe(0)
  })
})

describe("resetFor", () => {
  it("clears both settings when a different content key takes over (R13)", () => {
    const store = createPlayerSettingsStore()
    store.resetFor("id:video-1")
    store.setSpeed(1.75)
    store.setQualityTier("highest")
    store.resetFor("id:video-2")
    expect(store.getSnapshot()).toEqual({
      speed: 1,
      qualityTier: "auto",
      contentKey: "id:video-2",
    })
  })

  it("preserves both settings when the key matches (AE5)", () => {
    const store = createPlayerSettingsStore()
    store.resetFor("id:video-1")
    store.setSpeed(0.75)
    store.setQualityTier("low")
    store.resetFor("id:video-1")
    expect(store.getSnapshot()).toEqual({
      speed: 0.75,
      qualityTier: "low",
      contentKey: "id:video-1",
    })
  })
})

describe("effectivePlayerSettings", () => {
  it("returns the stored settings for the matching content key", () => {
    const store = createPlayerSettingsStore()
    store.resetFor("id:video-1")
    store.setSpeed(1.5)
    store.setQualityTier("high")
    expect(effectivePlayerSettings(store.getSnapshot(), "id:video-1")).toEqual({
      speed: 1.5,
      qualityTier: "high",
    })
  })

  it("returns defaults when the stored key names a different video", () => {
    const store = createPlayerSettingsStore()
    store.resetFor("id:video-1")
    store.setSpeed(2)
    store.setQualityTier("highest")
    expect(effectivePlayerSettings(store.getSnapshot(), "id:video-2")).toEqual({
      speed: 1,
      qualityTier: "auto",
    })
  })

  it("returns defaults when no content key is established on either side", () => {
    const store = createPlayerSettingsStore()
    store.setSpeed(2)
    expect(effectivePlayerSettings(store.getSnapshot(), null)).toEqual({
      speed: 1,
      qualityTier: "auto",
    })
    expect(effectivePlayerSettings(store.getSnapshot(), "id:video-1")).toEqual({
      speed: 1,
      qualityTier: "auto",
    })
  })
})

describe("getPlayerSettingsStore", () => {
  it("returns the same instance", () => {
    expect(getPlayerSettingsStore()).toBe(getPlayerSettingsStore())
  })
})
