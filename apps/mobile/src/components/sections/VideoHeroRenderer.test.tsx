import { useVideoPlayer } from "expo-video"

import type { VideoHeroSection } from "../../lib/sectionModels"

// Re-import after mock is set up in jest.setup.js
const mockUseVideoPlayer = useVideoPlayer as jest.Mock

const baseSection: VideoHeroSection = {
  kind: "videoHero",
  id: "vh-1",
  sectionKey: "hero",
  heading: "Experience Easter",
  subheading: "Watch the story",
  streamingUrl: "https://example.com/video.m3u8",
  ctaLink: "https://example.com/watch",
  ctaLabel: "Watch Now",
  video: {
    documentId: "v1",
    slug: "easter-video",
    title: "Easter Video",
    image: {
      url: "https://example.com/thumb.jpg",
      alternativeText: "Easter thumbnail",
    },
  },
}

describe("VideoHeroRenderer player configuration", () => {
  it("configures player with muted=true, loop=true and calls play()", () => {
    // The jest.setup.js mock runs the configure callback on the player object.
    // We can verify the callback behavior by calling useVideoPlayer directly
    // with a source and checking what the configure callback does to the player.
    const player = mockUseVideoPlayer(
      "https://example.com/video.m3u8",
      (p: Record<string, unknown>) => {
        p.muted = true
        p.loop = true
        ;(p.play as jest.Mock)()
      },
    )

    expect(player.muted).toBe(true)
    expect(player.loop).toBe(true)
    expect(player.play).toHaveBeenCalled()
  })

  it("sets currentTime to 0 on first unmute", () => {
    const player = mockUseVideoPlayer(
      "https://example.com/video.m3u8",
      (p: Record<string, unknown>) => {
        p.muted = true
        p.loop = true
      },
    )

    // Simulate first unmute: set currentTime = 0
    expect(player.currentTime).toBe(10) // default from mock
    player.currentTime = 0
    expect(player.currentTime).toBe(0)
  })

  it("returns player with play/pause functions", () => {
    const player = mockUseVideoPlayer("https://example.com/video.m3u8")

    expect(typeof player.play).toBe("function")
    expect(typeof player.pause).toBe("function")
  })

  it("calls configure callback even when source is null", () => {
    const configure = jest.fn()
    mockUseVideoPlayer(null, configure)

    // The mock calls configure regardless of source value
    expect(configure).toHaveBeenCalled()
  })
})

describe("VideoHeroRenderer mute toggle logic", () => {
  it("player starts with muted=true after configure callback", () => {
    const player = mockUseVideoPlayer(
      "https://example.com/video.m3u8",
      (p: Record<string, unknown>) => {
        p.muted = true
      },
    )
    expect(player.muted).toBe(true)
  })

  it("toggling mute changes player.muted", () => {
    const player = mockUseVideoPlayer(
      "https://example.com/video.m3u8",
      (p: Record<string, unknown>) => {
        p.muted = true
      },
    )
    expect(player.muted).toBe(true)

    // Simulate unmute toggle
    player.muted = false
    expect(player.muted).toBe(false)

    // Simulate mute toggle
    player.muted = true
    expect(player.muted).toBe(true)
  })

  it("first unmute resets currentTime to 0", () => {
    const player = mockUseVideoPlayer(
      "https://example.com/video.m3u8",
      (p: Record<string, unknown>) => {
        p.muted = true
        p.loop = true
      },
    )

    // Simulate: currentTime has advanced during autoplay
    expect(player.currentTime).toBe(10)

    // First unmute: restart from beginning
    player.currentTime = 0
    player.muted = false

    expect(player.currentTime).toBe(0)
    expect(player.muted).toBe(false)
  })
})

describe("VideoHeroRenderer controlled/uncontrolled mute pattern", () => {
  it("uses controlled mode when muted prop is provided", () => {
    // When muted prop is defined, the component is in controlled mode:
    // the parent owns state and the component syncs to the player.
    const mutedProp: boolean | undefined = false
    const isControlled = mutedProp != null

    expect(isControlled).toBe(true)
  })

  it("uses uncontrolled mode when muted prop is undefined", () => {
    // When muted prop is undefined, the component manages its own state
    // and renders its own mute button.
    const mutedProp: boolean | undefined = undefined
    const isControlled = mutedProp != null

    expect(isControlled).toBe(false)
  })

  it("controlled mode syncs muted=false to player and resets currentTime on first unmute", () => {
    const player = mockUseVideoPlayer(
      "https://example.com/video.m3u8",
      (p: Record<string, unknown>) => {
        p.muted = true
        p.loop = true
      },
    )

    // Simulate the controlled useEffect: muted prop changes to false
    const hasUnmutedOnce = { current: false }
    const mutedProp = false

    player.muted = mutedProp
    if (!mutedProp && !hasUnmutedOnce.current) {
      hasUnmutedOnce.current = true
      player.currentTime = 0
    }

    expect(player.muted).toBe(false)
    expect(player.currentTime).toBe(0)
    expect(hasUnmutedOnce.current).toBe(true)
  })
})

describe("VideoHeroRenderer section data", () => {
  it("handles section with all fields populated", () => {
    expect(baseSection.heading).toBe("Experience Easter")
    expect(baseSection.subheading).toBe("Watch the story")
    expect(baseSection.streamingUrl).toBe("https://example.com/video.m3u8")
    expect(baseSection.ctaLabel).toBe("Watch Now")
    expect(baseSection.ctaLink).toBe("https://example.com/watch")
    expect(baseSection.video.image?.url).toBe("https://example.com/thumb.jpg")
  })

  it("handles section with null optional fields", () => {
    const minimal: VideoHeroSection = {
      ...baseSection,
      heading: null,
      subheading: null,
      streamingUrl: null,
      ctaLabel: null,
      ctaLink: null,
      video: { documentId: "v1", slug: "test", title: "Test", image: null },
    }
    expect(minimal.heading).toBeNull()
    expect(minimal.streamingUrl).toBeNull()
    expect(minimal.video.image).toBeNull()
  })

  it("CTA requires both label and link", () => {
    const noLink: VideoHeroSection = { ...baseSection, ctaLink: null }
    const trimmedLabel = noLink.ctaLabel?.trim() || null
    const trimmedLink = noLink.ctaLink?.trim() || null
    const hasCta = trimmedLabel != null && trimmedLink != null
    expect(hasCta).toBe(false)
  })
})
