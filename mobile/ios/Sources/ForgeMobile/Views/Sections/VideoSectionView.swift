import AVKit
import SwiftUI

/// Standalone Video section renderer. Displays an inline video player with
/// optional poster image, title, and subtitle. Autoplays muted when scrolled
/// into view; pauses when scrolled away. Full-screen is presented via a
/// separate `AVPlayerViewController` in a `.fullScreenCover` so the inline
/// view stays in the hierarchy and scroll position is preserved.
/// Reusable at top level, inside Container slots, and Section wrappers.
struct VideoSectionView: View {
  let section: VideoSection
  @State private var player: AVPlayer?
  @State private var isVisible = false
  @State private var isFullScreen = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      textHeader
      videoArea
    }
    .accessibilityElement(children: .contain)
  }
}

// MARK: - Text Header

private extension VideoSectionView {
  @ViewBuilder
  var textHeader: some View {
    let hasText = !(section.title?.isEmpty ?? true) || !(section.subtitle?.isEmpty ?? true)
    if hasText {
      VStack(alignment: .leading, spacing: 6) {
        subtitleLabel
        titleLabel
      }
      .padding(.horizontal, 16)
      .padding(.bottom, 12)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  @ViewBuilder
  var subtitleLabel: some View {
    if let subtitle = section.subtitle, !subtitle.isEmpty {
      Text(subtitle.uppercased())
        .font(.caption.weight(.semibold))
        .tracking(1.5)
        .foregroundStyle(.secondary)
        .accessibilityLabel(subtitle)
    }
  }

  @ViewBuilder
  var titleLabel: some View {
    if let title = section.title, !title.isEmpty {
      Text(title)
        .font(.title2.bold())
        .foregroundStyle(.primary)
        .accessibilityAddTraits(.isHeader)
    }
  }
}

// MARK: - Video Area

private extension VideoSectionView {
  var videoArea: some View {
    ZStack(alignment: .bottomLeading) {
      if let player {
        VideoPlayer(player: player)
          .accessibilityLabel(
            section.title ?? "Video player"
          )
          .accessibilityAddTraits(.startsMediaSession)

        fullScreenButton
      } else {
        posterFallback
      }
    }
    .aspectRatio(16 / 9, contentMode: .fit)
    .background(Color.black)
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .padding(.horizontal, 16)
    .fullScreenCover(isPresented: $isFullScreen) {
      FullScreenPlayerView(player: player) {
        isFullScreen = false
        player?.isMuted = true
      }
      .ignoresSafeArea()
    }
    .background(
      GeometryReader { geo in
        Color.clear
          .onChange(of: geo.frame(in: .global)) { _, newFrame in
            updateVisibility(frame: newFrame)
          }
          .onAppear {
            updateVisibility(frame: geo.frame(in: .global))
          }
      }
    )
    .onDisappear {
      player?.pause()
      player = nil
      isVisible = false
    }
  }

  var fullScreenButton: some View {
    Button {
      player?.isMuted = false
      isFullScreen = true
    } label: {
      Image(systemName: "arrow.up.left.and.arrow.down.right")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.white)
        .padding(6)
        .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 4))
    }
    .padding(.leading, 10)
    .padding(.bottom, 44)
    .accessibilityLabel("Full screen")
  }

  @ViewBuilder
  var posterFallback: some View {
    let posterUrl = resolvePosterUrl()
    if let posterUrl {
      AsyncImage(url: posterUrl) { phase in
        switch phase {
        case .success(let image):
          image
            .resizable()
            .aspectRatio(contentMode: .fill)
        default:
          posterPlaceholder
        }
      }
    } else {
      posterPlaceholder
    }
  }

  var posterPlaceholder: some View {
    Rectangle()
      .fill(Color(.tertiarySystemFill))
      .overlay {
        Image(systemName: "film")
          .font(.largeTitle)
          .foregroundStyle(.tertiary)
      }
  }
}

// MARK: - Helpers

private extension VideoSectionView {
  func resolvePosterUrl() -> URL? {
    if let urlString = section.media?.url {
      return URL(string: urlString)
    }
    if let urlString = section.video?.image?.url {
      return URL(string: urlString)
    }
    return nil
  }

  func updateVisibility(frame: CGRect) {
    let screenHeight = UIScreen.main.bounds.height
    let nowVisible = frame.maxY > 0 && frame.minY < screenHeight
    guard nowVisible != isVisible else { return }
    isVisible = nowVisible
    if nowVisible {
      startPlayback()
    } else {
      player?.pause()
    }
  }

  func startPlayback() {
    if let player {
      player.play()
      return
    }
    guard let url = URL(string: section.streamingUrl) else { return }
    let avPlayer = AVPlayer(url: url)
    avPlayer.isMuted = true
    self.player = avPlayer
    avPlayer.play()
  }
}

// MARK: - Full-Screen Player

/// Presents `AVPlayerViewController` in a modal full-screen cover.
/// The inline `VideoPlayer` stays in the hierarchy so scroll position
/// is preserved when this is dismissed.
private struct FullScreenPlayerView: UIViewControllerRepresentable {
  let player: AVPlayer?
  let onDismiss: () -> Void

  func makeUIViewController(context: Context) -> AVPlayerViewController {
    let controller = AVPlayerViewController()
    controller.player = player
    controller.allowsPictureInPicturePlayback = true
    return controller
  }

  func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
    controller.player = player
  }

  static func dismantleUIView(
    _ uiViewController: AVPlayerViewController,
    coordinator: ()
  ) {}
}

// MARK: - Previews

#if DEBUG
#Preview("Video – Full") {
  ScrollView {
    VideoSectionView(
      section: VideoSection(
        id: "preview-1",
        sectionKey: nil,
        streamingUrl: "https://stream.jesusfilm.org/example.m3u8",
        title: "Did Jesus Defeat Death?",
        subtitle: "Easter Documentary Series",
        media: UploadFileModel(
          url: "https://images.unsplash.com/photo-1507692049790-de58290a4334",
          alternativeText: "Easter sunrise"
        ),
        video: nil
      )
    )
  }
}

#Preview("Video – Minimal") {
  ScrollView {
    VideoSectionView(
      section: VideoSection(
        id: "preview-2",
        sectionKey: nil,
        streamingUrl: "https://stream.jesusfilm.org/example.m3u8",
        title: nil,
        subtitle: nil,
        media: nil,
        video: nil
      )
    )
  }
}

#Preview("Video – Title Only") {
  ScrollView {
    VideoSectionView(
      section: VideoSection(
        id: "preview-3",
        sectionKey: nil,
        streamingUrl: "https://stream.jesusfilm.org/example.m3u8",
        title: "The Story of Easter",
        subtitle: nil,
        media: nil,
        video: VideoModel(
          documentId: "doc-1",
          slug: "easter",
          title: "Easter Story",
          image: UploadFileModel(
            url: "https://images.unsplash.com/photo-1512389142860-9c449e58a814",
            alternativeText: "Easter video poster"
          )
        )
      )
    )
  }
}
#endif
