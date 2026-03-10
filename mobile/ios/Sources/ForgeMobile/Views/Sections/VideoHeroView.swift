import SwiftUI

struct VideoHeroView: View {
  let section: VideoHeroSection
  let heroHeight: CGFloat
  @Binding var isPlaying: Bool
  @Binding var isMuted: Bool

  var body: some View {
    ZStack(alignment: .bottomLeading) {
      videoBackground
      gradientOverlay
      contentOverlay
    }
    .frame(maxWidth: .infinity)
    .frame(height: heroHeight)
    .clipped()
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Video hero")
  }
}

// MARK: - Video Background

private extension VideoHeroView {
  @ViewBuilder
  var videoBackground: some View {
    if let streamingUrl = section.streamingUrl,
       let url = URL(string: streamingUrl) {
      LoopingVideoPlayer(url: url, isMuted: $isMuted, isPlaying: $isPlaying)
      .ignoresSafeArea()
    } else {
      posterFallback
    }
  }

  @ViewBuilder
  var posterFallback: some View {
    if let imageUrlString = section.video.image?.url,
       let imageUrl = URL(string: imageUrlString) {
      AsyncImage(url: imageUrl) { phase in
        switch phase {
        case .success(let image):
          image
            .resizable()
            .aspectRatio(contentMode: .fill)
        case .failure:
          Color.black
        default:
          Color.black
        }
      }
      .ignoresSafeArea()
    } else {
      Color.black
        .ignoresSafeArea()
    }
  }
}

// MARK: - Gradient Overlay

private extension VideoHeroView {
  var gradientOverlay: some View {
    LinearGradient(
      colors: [.black.opacity(0.7), .black.opacity(0.3), .clear],
      startPoint: .bottom,
      endPoint: .top
    )
    .ignoresSafeArea()
  }
}

// MARK: - Content Overlay (text only, no interactive controls)

private extension VideoHeroView {
  var contentOverlay: some View {
    VStack(alignment: .leading, spacing: 4) {
      Spacer()
      headingLabel
      subheadingLabel
    }
    .padding(.horizontal, 20)
    .padding(.bottom, 24)
    .allowsHitTesting(false)
  }

  @ViewBuilder
  var headingLabel: some View {
    if let heading = section.heading {
      Text(heading)
        .font(.system(size: 48, weight: .bold))
        .foregroundStyle(.white.opacity(0.9))
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(heading)
    }
  }

  @ViewBuilder
  var subheadingLabel: some View {
    if let subheading = section.subheading {
      Text(subheading.uppercased())
        .font(.system(size: 11, weight: .regular))
        .tracking(2)
        .foregroundStyle(.white.opacity(0.5))
        .accessibilityLabel(subheading)
    }
  }
}
