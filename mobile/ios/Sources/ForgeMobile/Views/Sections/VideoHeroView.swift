import SwiftUI

struct VideoHeroView: View {
  let section: VideoHeroSection
  @Binding var isPlaying: Bool
  @State private var isMuted = true
  @State private var hasUnmutedOnce = false

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

  private var heroHeight: CGFloat {
    UIScreen.main.bounds.height * 0.85
  }
}

// MARK: - Video Background

private extension VideoHeroView {
  @ViewBuilder
  var videoBackground: some View {
    if let streamingUrl = section.streamingUrl,
       let url = URL(string: streamingUrl) {
      LoopingVideoPlayer(
        url: url,
        isMuted: $isMuted,
        isPlaying: $isPlaying,
        onFirstUnmute: nil
      )
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

// MARK: - Content Overlay

private extension VideoHeroView {
  var contentOverlay: some View {
    VStack(alignment: .leading, spacing: 4) {
      Spacer()
      headingRow
      subheadingLabel
      ctaButton
    }
    .padding(.horizontal, 20)
    .padding(.bottom, 24)
  }

  var headingRow: some View {
    HStack(alignment: .bottom) {
      if let heading = section.heading {
        Text(heading)
          .font(.system(size: 48, weight: .bold))
          .foregroundStyle(.white.opacity(0.9))
          .accessibilityAddTraits(.isHeader)
          .accessibilityLabel(heading)
      }
      Spacer()
      MuteToggleButton(isMuted: $isMuted) {
        handleMuteToggle()
      }
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

  @ViewBuilder
  var ctaButton: some View {
    if let ctaLabel = section.ctaLabel,
       let ctaLink = section.ctaLink,
       !ctaLabel.isEmpty,
       !ctaLink.isEmpty {
      Button {
        guard let url = URL(string: ctaLink) else { return }
        UIApplication.shared.open(url)
      } label: {
        Text(ctaLabel)
          .font(.system(size: 16, weight: .medium))
          .foregroundStyle(.white)
          .padding(.horizontal, 24)
          .padding(.vertical, 12)
          .background(.white.opacity(0.2))
          .clipShape(RoundedRectangle(cornerRadius: 8))
      }
      .padding(.top, 12)
      .accessibilityLabel(ctaLabel)
    }
  }
}

// MARK: - Actions

private extension VideoHeroView {
  func handleMuteToggle() {
    guard !hasUnmutedOnce, !isMuted else { return }
    hasUnmutedOnce = true
  }
}
