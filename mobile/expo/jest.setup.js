jest.mock("expo-video", () => ({
  useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn() }),
  VideoView: "VideoView",
}))
