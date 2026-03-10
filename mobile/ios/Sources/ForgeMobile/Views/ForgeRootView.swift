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

// MARK: - Scroll Offset Tracking

private struct ScrollOffsetKey: PreferenceKey {
  static let defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = nextValue()
  }
}

// MARK: - Experience Page View

private struct ExperiencePageView: View {
  let viewModel: WatchHomeViewModel
  @State private var isVideoPlaying = true
  @State private var isMuted = true
  @State private var hasUnmutedOnce = false

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
      debugFallback(experience)
    }
  }
}

// MARK: - Sticky Hero Layout

private extension ExperiencePageView {
  func stickyHeroLayout(
    hero: VideoHeroSection,
    sections: [ExperienceSection]
  ) -> some View {
    let heroHeight = UIScreen.main.bounds.height * 0.85

    return ZStack(alignment: .top) {
      VideoHeroView(section: hero, isPlaying: $isVideoPlaying, isMuted: $isMuted)
        .frame(height: heroHeight)
        .ignoresSafeArea()

      ScrollView {
        VStack(spacing: 0) {
          scrollOffsetTracker
            .frame(height: heroHeight)

          sectionsList(sections)
            .background(Color(.systemBackground))
        }
      }
      .coordinateSpace(name: "scroll")
      .onPreferenceChange(ScrollOffsetKey.self) { offset in
        handleScrollOffset(offset)
      }

      heroControlsOverlay(hero: hero, heroHeight: heroHeight)
    }
    .ignoresSafeArea()
  }

  func heroControlsOverlay(hero: VideoHeroSection, heroHeight: CGFloat) -> some View {
    VStack {
      Spacer()
      HStack(alignment: .bottom) {
        ctaButton(hero: hero)
        Spacer()
        MuteToggleButton(isMuted: $isMuted) {
          handleMuteToggle()
        }
      }
      .padding(.horizontal, 20)
      .padding(.bottom, 24)
    }
    .frame(height: heroHeight)
    .allowsHitTesting(true)
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

  func handleMuteToggle() {
    guard !hasUnmutedOnce, !isMuted else { return }
    hasUnmutedOnce = true
  }

  var scrollOffsetTracker: some View {
    GeometryReader { geo in
      Color.clear
        .preference(
          key: ScrollOffsetKey.self,
          value: geo.frame(in: .named("scroll")).minY
        )
    }
  }

  func handleScrollOffset(_ offset: CGFloat) {
    if offset < -100 {
      isVideoPlaying = false
    } else if offset > -50 {
      isVideoPlaying = true
    }
  }
}

// MARK: - Sections List

private extension ExperiencePageView {
  func sectionsList(_ sections: [ExperienceSection]) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
        sectionPlaceholder(section)
      }
    }
    .padding()
  }

  func sectionPlaceholder(_ section: ExperienceSection) -> some View {
    let label = sectionLabel(for: section)
    return Text(label)
      .font(.caption)
      .foregroundStyle(.secondary)
      .padding(.vertical, 8)
      .accessibilityLabel(label)
  }

  func sectionLabel(for section: ExperienceSection) -> String {
    switch section {
    case .leaf(let content):
      return leafLabel(for: content)
    case .container:
      return "[Container]"
    case .section:
      return "[Section wrapper]"
    }
  }

  func leafLabel(for content: SectionContent) -> String {
    switch content {
    case .mediaCollection: return "[MediaCollection]"
    case .cta: return "[CTA]"
    case .videoHero: return "[VideoHero]"
    case .text: return "[Text]"
    case .relatedQuestions: return "[RelatedQuestions]"
    case .bibleQuotesCarousel: return "[BibleQuotesCarousel]"
    case .card: return "[Card]"
    case .video: return "[Video]"
    case .container: return "[Container]"
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

// MARK: - Debug Fallback

private extension ExperiencePageView {
  func debugFallback(_ experience: ExperienceContent) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        Text(experience.title)
          .font(.title2.bold())
          .accessibilityLabel("Title: \(experience.title)")
        Text("\(experience.sections.count) sections (no VideoHero found)")
          .font(.caption)
          .foregroundStyle(.secondary)
          .accessibilityLabel("\(experience.sections.count) sections")
      }
      .padding()
    }
  }
}
