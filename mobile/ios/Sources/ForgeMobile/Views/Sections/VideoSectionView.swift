import AVKit
import SwiftUI

/// Standalone Video section renderer. Displays an inline video player with
/// optional poster image, title, and subtitle. Uses system `VideoPlayer`
/// controls for user-driven playback.
/// Reusable at top level, inside Container slots, and Section wrappers.
struct VideoSectionView: View {
  let section: VideoSection
  @State private var player: AVPlayer?
  @State private var isShowingPoster = true

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
    ZStack {
      if isShowingPoster {
        posterOverlay
      } else if let player {
        VideoPlayer(player: player)
          .accessibilityLabel(
            section.title ?? "Video player"
          )
          .accessibilityAddTraits(.startsMediaSession)
      }
    }
    .aspectRatio(16 / 9, contentMode: .fit)
    .background(Color.black)
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .onDisappear {
      player?.pause()
      player = nil
      isShowingPoster = true
    }
  }

  var posterOverlay: some View {
    ZStack {
      posterImage
      playButton
    }
    .contentShape(Rectangle())
    .onTapGesture {
      startPlayback()
    }
    .accessibilityLabel(
      section.title.map { "Play \($0)" } ?? "Play video"
    )
    .accessibilityAddTraits([.isButton, .startsMediaSession])
  }

  @ViewBuilder
  var posterImage: some View {
    let posterUrl = resolvePosterUrl()
    if let posterUrl {
      AsyncImage(url: posterUrl) { phase in
        switch phase {
        case .empty:
          posterPlaceholder
        case .success(let image):
          image
            .resizable()
            .aspectRatio(contentMode: .fill)
        case .failure:
          posterPlaceholder
        @unknown default:
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

  var playButton: some View {
    Circle()
      .fill(.ultraThinMaterial)
      .frame(width: 64, height: 64)
      .overlay {
        Image(systemName: "play.fill")
          .font(.title2)
          .foregroundStyle(.white)
          .offset(x: 2)
      }
      .shadow(color: .black.opacity(0.3), radius: 8, y: 2)
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

  func startPlayback() {
    guard let url = URL(string: section.streamingUrl) else { return }
    let avPlayer = AVPlayer(url: url)
    self.player = avPlayer
    isShowingPoster = false
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
    .padding()
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
    .padding()
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
    .padding()
  }
}
#endif
