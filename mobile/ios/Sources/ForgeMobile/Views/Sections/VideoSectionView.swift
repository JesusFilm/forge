import AVKit
import SwiftUI

/// Standalone Video section renderer. Displays an inline video player with
/// optional poster image, title, and subtitle. Autoplays muted when scrolled
/// into view; pauses when scrolled away. Uses SwiftUI `VideoPlayer` for
/// inline playback and `.fullScreenCover` for full-screen — no
/// `AVPlayerViewController` in the scroll hierarchy, so scroll position
/// is preserved on full-screen dismiss.
///
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
    GeometryReader { geo in
      ZStack(alignment: .topLeading) {
        if let player {
          VideoPlayer(player: player)
            .accessibilityLabel(
              section.title ?? "Video player"
            )
            .accessibilityAddTraits(.startsMediaSession)

          fullScreenButton(playerHeight: geo.size.height)
        } else {
          posterFallback
        }
      }
    }
    .aspectRatio(16 / 9, contentMode: .fit)
    .background(Color.black)
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .padding(.horizontal, 16)
    .fullScreenCover(isPresented: $isFullScreen) {
      fullScreenPlayer
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
      guard !isFullScreen else { return }
      player?.pause()
      player = nil
      isVisible = false
    }
  }

  func fullScreenButton(playerHeight: CGFloat) -> some View {
    let iconSize = max(10, playerHeight * 0.06)
    let iconPadding = max(4, playerHeight * 0.03)
    let edgePadding = max(6, playerHeight * 0.04)
    return Button {
      player?.isMuted = false
      isFullScreen = true
    } label: {
      Image(systemName: "arrow.up.left.and.arrow.down.right")
        .font(.system(size: iconSize, weight: .semibold))
        .foregroundStyle(.white)
        .padding(iconPadding)
        .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 4))
    }
    .padding(edgePadding)
    .accessibilityLabel("Full screen")
  }

  var fullScreenPlayer: some View {
    ZStack(alignment: .topLeading) {
      Color.black.ignoresSafeArea()

      if let player {
        VideoPlayer(player: player)
          .ignoresSafeArea()
      }

      Button {
        player?.isMuted = true
        isFullScreen = false
      } label: {
        Image(systemName: "xmark")
          .font(.system(size: 16, weight: .bold))
          .foregroundStyle(.white)
          .padding(10)
          .background(.black.opacity(0.5), in: Circle())
      }
      .padding(.top, 16)
      .padding(.leading, 16)
      .accessibilityLabel("Close full screen")
    }
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
    guard !isFullScreen else { return }
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
    avPlayer.allowsExternalPlayback = false
    self.player = avPlayer
    avPlayer.play()
  }
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
