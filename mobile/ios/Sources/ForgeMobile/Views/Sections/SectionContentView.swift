import SwiftUI

/// Dispatches leaf `SectionContent` to the appropriate renderer view.
/// Unimplemented section types show a debug placeholder in DEBUG builds
/// and render nothing in release.
struct SectionContentView: View {
  let content: SectionContent

  var body: some View {
    switch content {
    case .cta(let section):
      CTAView(section: section)
    case .relatedQuestions(let section):
      RelatedQuestionsView(section: section)
    case .mediaCollection,
         .videoHero,
         .text,
         .bibleQuotesCarousel,
         .card,
         .video,
         .container:
      UnsupportedSectionView(typeName: content.typeName)
    }
  }
}

/// Renders a debug-only placeholder for section types not yet implemented.
struct UnsupportedSectionView: View {
  let typeName: String

  var body: some View {
    #if DEBUG
    Text("[\(typeName)] — renderer not implemented")
      .font(.caption)
      .foregroundStyle(.tertiary)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 8)
      .accessibilityLabel("\(typeName) section, renderer not implemented")
    #endif
  }
}

// MARK: - SectionContent type name helper

extension SectionContent {
  var typeName: String {
    switch self {
    case .mediaCollection: return "MediaCollection"
    case .cta: return "CTA"
    case .videoHero: return "VideoHero"
    case .text: return "Text"
    case .relatedQuestions: return "RelatedQuestions"
    case .bibleQuotesCarousel: return "BibleQuotesCarousel"
    case .card: return "Card"
    case .video: return "Video"
    case .container: return "Container"
    }
  }
}
