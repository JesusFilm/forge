jest.mock("expo-video", () => ({
  useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn(), playing: false }),
  VideoView: "VideoView",
}))

jest.mock("expo", () => ({
  useEvent: () => ({ isPlaying: false }),
}))
