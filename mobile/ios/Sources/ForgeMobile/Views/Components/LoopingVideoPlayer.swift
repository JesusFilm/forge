import AVFoundation
import SwiftUI

struct LoopingVideoPlayer: UIViewRepresentable {
  let url: URL?
  @Binding var isMuted: Bool
  @Binding var isPlaying: Bool

  init(url: URL?, isMuted: Binding<Bool>, isPlaying: Binding<Bool>) {
    self.url = url
    _isMuted = isMuted
    _isPlaying = isPlaying
  }

  func makeUIView(context: Context) -> PlayerContainerView {
    let container = PlayerContainerView()
    container.backgroundColor = .black
    context.coordinator.setupPlayer(in: container, url: url)
    return container
  }

  func updateUIView(_ uiView: PlayerContainerView, context: Context) {
    let coordinator = context.coordinator
    guard let player = coordinator.player else { return }

    let wasMuted = player.isMuted
    player.isMuted = isMuted

    if !isMuted, wasMuted {
      coordinator.handleFirstUnmute()
    }

    if isPlaying {
      player.play()
    } else {
      player.pause()
    }
  }

  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  // MARK: - Coordinator

  final class Coordinator {
    var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var hasUnmutedOnce = false

    func setupPlayer(in container: PlayerContainerView, url: URL?) {
      guard let url else { return }

      configureAudioSession()

      let queuePlayer = AVQueuePlayer()
      queuePlayer.isMuted = true

      let templateItem = AVPlayerItem(url: url)
      looper = AVPlayerLooper(player: queuePlayer, templateItem: templateItem)

      container.playerLayer.player = queuePlayer
      container.playerLayer.videoGravity = .resizeAspectFill

      self.player = queuePlayer
      queuePlayer.play()
    }

    func handleFirstUnmute() {
      guard !hasUnmutedOnce else { return }
      hasUnmutedOnce = true
      player?.seek(to: .zero)
      player?.play()
    }

    private func configureAudioSession() {
      let session = AVAudioSession.sharedInstance()
      try? session.setCategory(.playback, mode: .moviePlayback)
      try? session.setActive(true)
    }
  }
}

// MARK: - Player Container UIView

final class PlayerContainerView: UIView {
  let playerLayer = AVPlayerLayer()

  override init(frame: CGRect) {
    super.init(frame: frame)
    layer.addSublayer(playerLayer)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { nil }

  override func layoutSubviews() {
    super.layoutSubviews()
    playerLayer.frame = bounds
  }
}
