jest.mock("expo-video", () => ({
  useVideoPlayer: (_source, configure) => {
    const player = {
      play: jest.fn(),
      pause: jest.fn(),
      playing: false,
      muted: false,
      loop: false,
      currentTime: 10,
    }
    if (configure) configure(player)
    return player
  },
  VideoView: "VideoView",
}))

jest.mock("expo", () => ({
  useEvent: () => ({ isPlaying: false }),
}))

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}))
