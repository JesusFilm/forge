import AVFoundation
import SwiftUI

struct LoopingVideoPlayer: UIViewRepresentable {
  let url: URL?
  @Binding var isMuted: Bool
  @Binding var isPlaying: Bool
  let onFirstUnmute: (() -> Void)?

  init(
    url: URL?,
    isMuted: Binding<Bool>,
    isPlaying: Binding<Bool>,
    onFirstUnmute: (() -> Void)? = nil
  ) {
    self.url = url
    _isMuted = isMuted
    _isPlaying = isPlaying
    self.onFirstUnmute = onFirstUnmute
  }

  func makeUIView(context: Context) -> PlayerContainerView {
    let container = PlayerContainerView()
    container.backgroundColor = .black
    context.coordinator.setupPlayer(in: container, url: url)
    return container
  }

  func updateUIView(_ uiView: PlayerContainerView, context: Context) {
    let coordinator = context.coordinator
    coordinator.player?.isMuted = isMuted

    if isPlaying {
      coordinator.player?.play()
    } else {
      coordinator.player?.pause()
    }
  }

  func makeCoordinator() -> Coordinator {
    Coordinator(parent: self)
  }

  // MARK: - Coordinator

  final class Coordinator {
    var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var parent: LoopingVideoPlayer
    private var hasUnmutedOnce = false

    init(parent: LoopingVideoPlayer) {
      self.parent = parent
    }

    func setupPlayer(in container: PlayerContainerView, url: URL?) {
      guard let url else { return }

      let item = AVPlayerItem(url: url)
      let queuePlayer = AVQueuePlayer(items: [item])
      queuePlayer.isMuted = parent.isMuted

      let templateItem = AVPlayerItem(url: url)
      looper = AVPlayerLooper(playerQueue: queuePlayer, templateItem: templateItem)

      container.playerLayer.player = queuePlayer
      container.playerLayer.videoGravity = .resizeAspectFill

      self.player = queuePlayer
      queuePlayer.play()
    }

    func handleUnmute() {
      guard !hasUnmutedOnce else { return }
      hasUnmutedOnce = true
      player?.seek(to: .zero)
      player?.play()
      parent.onFirstUnmute?()
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
