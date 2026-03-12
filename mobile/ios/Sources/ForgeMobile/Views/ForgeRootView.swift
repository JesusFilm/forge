import SwiftUI

public struct ForgeRootView: View {
  private let contentRepository: ContentRepository?
  @State private var viewModel: WatchHomeViewModel?

  public init(contentRepository: ContentRepository? = nil) {
    self.contentRepository = contentRepository
    _viewModel = State(
      initialValue: contentRepository.map { WatchHomeViewModel(repository: $0) }
    )
  }

  public var body: some View {
    if let viewModel {
      ExperiencePageView(viewModel: viewModel)
    } else {
      Text("Forge iOS")
        .accessibilityLabel("Forge iOS")
    }
  }
}

// MARK: - Experience Page View

private struct ExperiencePageView: View {
  let viewModel: WatchHomeViewModel
  @State private var isVideoPlaying = true
  @State private var isMuted = true

  var body: some View {
    Group {
      if viewModel.isLoading {
        ProgressView("Loading Experience…")
          .accessibilityLabel("Loading experience")
      } else if let experience = viewModel.experienceContent {
        experienceContent(experience)
      } else if let error = viewModel.homeError {
        Text("Error: \(error)")
          .foregroundStyle(.red)
          .accessibilityLabel("Error: \(error)")
      } else {
        Text("No experience loaded")
          .accessibilityLabel("No experience loaded")
      }
    }
    .task {
      await viewModel.loadExperience(slug: "easter", locale: "en")
    }
  }

  @ViewBuilder
  private func experienceContent(_ experience: ExperienceContent) -> some View {
    let heroSection = extractVideoHero(from: experience.sections)
    let remainingSections = filterNonVideoHero(from: experience.sections)

    if let heroSection {
      stickyHeroLayout(hero: heroSection, sections: remainingSections)
    } else {
      noHeroFallback(experience)
    }
  }
}

// MARK: - Sticky Hero Layout

private extension ExperiencePageView {
  func stickyHeroLayout(
    hero: VideoHeroSection,
    sections: [ExperienceSection]
  ) -> some View {
    GeometryReader { geo in
      let heroHeight = geo.size.height * 0.85

      ZStack(alignment: .top) {
        Color.black.ignoresSafeArea()

        VideoHeroView(
          section: hero,
          heroHeight: heroHeight,
          isPlaying: $isVideoPlaying,
          isMuted: $isMuted,
          showOverlayContent: false
        )
        .frame(height: heroHeight)
        .overlay(alignment: .bottom) {
          LinearGradient(
            colors: [.black, .clear],
            startPoint: .bottom,
            endPoint: .top
          )
          .frame(height: 60)
          .allowsHitTesting(false)
        }
        .ignoresSafeArea()

        ScrollView {
          VStack(spacing: 0) {
            heroScrollableContent(hero: hero, heroHeight: heroHeight)

            ExperienceSectionListView(sections: sections)
              .background(.ultraThinMaterial)
          }
          .background(
            ScrollOffsetObserver { offset in
              handleScrollOffset(offset)
            }
            .frame(height: 0)
          )
        }
      }
      .ignoresSafeArea()
    }
  }

  func heroScrollableContent(
    hero: VideoHeroSection,
    heroHeight: CGFloat
  ) -> some View {
    ZStack(alignment: .bottom) {
      Color.clear

      Rectangle()
        .fill(.black.opacity(0.5))
        .overlay(Rectangle().fill(.ultraThinMaterial))
        .frame(height: heroHeight * 0.5)
        .mask(
          LinearGradient(
            colors: [.black, .black.opacity(0.3), .clear],
            startPoint: .bottom,
            endPoint: .top
          )
        )
        .allowsHitTesting(false)

      HStack(alignment: .bottom) {
        VStack(alignment: .leading, spacing: 4) {
          heroHeading(hero: hero)
          heroSubheading(hero: hero)
          ctaButton(hero: hero)
        }
        Spacer()
        if hero.streamingUrl != nil {
          MuteToggleButton(isMuted: $isMuted)
        }
      }
      .padding(.horizontal, 20)
      .padding(.bottom, 24)
    }
    .frame(height: heroHeight)
  }

  @ViewBuilder
  func heroHeading(hero: VideoHeroSection) -> some View {
    if let heading = hero.heading {
      Text(heading)
        .font(.system(size: 48, weight: .bold))
        .foregroundStyle(.white.opacity(0.9))
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(heading)
    }
  }

  @ViewBuilder
  func heroSubheading(hero: VideoHeroSection) -> some View {
    if let subheading = hero.subheading {
      Text(subheading.uppercased())
        .font(.system(size: 11, weight: .regular))
        .tracking(2)
        .foregroundStyle(.white.opacity(0.5))
        .accessibilityLabel(subheading)
    }
  }

  @ViewBuilder
  func ctaButton(hero: VideoHeroSection) -> some View {
    if let ctaLabel = hero.ctaLabel,
       let ctaLink = hero.ctaLink,
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
      .accessibilityLabel(ctaLabel)
    }
  }

  func handleScrollOffset(_ offset: CGFloat) {
    if offset > 10 {
      isVideoPlaying = false
    } else if offset <= 2 {
      isVideoPlaying = true
    }
  }
}

// MARK: - Section Extraction

private extension ExperiencePageView {
  func extractVideoHero(from sections: [ExperienceSection]) -> VideoHeroSection? {
    for section in sections {
      if case .leaf(.videoHero(let hero)) = section {
        return hero
      }
    }
    return nil
  }

  func filterNonVideoHero(from sections: [ExperienceSection]) -> [ExperienceSection] {
    sections.filter { section in
      if case .leaf(.videoHero) = section { return false }
      return true
    }
  }
}

// MARK: - No-Hero Fallback

private extension ExperiencePageView {
  func noHeroFallback(_ experience: ExperienceContent) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        Text(experience.title)
          .font(.title2.bold())
          .accessibilityLabel(experience.title)

        ExperienceSectionListView(sections: experience.sections)
      }
      .padding()
    }
  }
}
