import SwiftUI

/// Renders a MediaCollection section with variant-based layouts.
/// Supports carousel, grid, collection, hero, and player variants.
/// Reusable at top level, inside Container slots, and Section wrappers.
struct MediaCollectionView: View {
  let section: MediaCollectionSection

  // subtitle and description are not yet rendered; will be addressed in a follow-up.

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      headerView
      variantContent
      footerView
    }
    .padding(.vertical, 24)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
  }
}

// MARK: - Header

private extension MediaCollectionView {
  @ViewBuilder
  var headerView: some View {
    let category = section.categoryLabel.flatMap { $0.isEmpty ? nil : $0 }
    let title = section.title.flatMap { $0.isEmpty ? nil : $0 }
    let cta = section.ctaLink.flatMap { $0.isEmpty ? nil : $0 }

    if category != nil || title != nil {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 4) {
          if let category {
            Text(category.uppercased())
              .font(.caption.weight(.semibold))
              .foregroundStyle(.secondary)
              .tracking(1.2)
          }
          if let title {
            Text(title)
              .font(.title2.bold())
              .foregroundStyle(.primary)
              .accessibilityAddTraits(.isHeader)
          }
        }
        Spacer()
        if let cta, let url = URL(string: cta) {
          Link(destination: url) {
            HStack(spacing: 4) {
              Image(systemName: "play.fill")
                .font(.caption2)
              // swiftlint:disable:next todo
              // TODO: localize
              Text("WATCH")
                .font(.caption.weight(.semibold))
                .tracking(0.5)
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .overlay(
              Capsule().stroke(.primary.opacity(0.3), lineWidth: 1)
            )
          }
          .accessibilityLabel("Watch")
          .accessibilityAddTraits(.isLink)
        }
      }
      .padding(.horizontal, 24)
    }
  }
}

// MARK: - Variant Content

private extension MediaCollectionView {
  @ViewBuilder
  var variantContent: some View {
    switch section.variant {
    case .carousel, .player:
      horizontalLayout(style: .standard)
    case .grid:
      gridLayout
    case .collection:
      horizontalLayout(style: .collection)
    case .hero:
      horizontalLayout(style: .hero)
    }
  }

  func horizontalLayout(style: MediaCollectionItemStyle) -> some View {
    ScrollView(.horizontal, showsIndicators: false) {
      LazyHStack(spacing: 16) {
        ForEach(Array(section.items.enumerated()), id: \.element.id) { index, item in
          MediaCollectionItemView(
            item: item,
            itemNumber: itemNumber(at: index),
            style: style
          )
        }
      }
      .padding(.horizontal, 24)
    }
  }

  var gridLayout: some View {
    let columns = [
      GridItem(.flexible(), spacing: 16),
      GridItem(.flexible(), spacing: 16)
    ]
    return LazyVGrid(columns: columns, spacing: 16) {
      ForEach(Array(section.items.enumerated()), id: \.element.id) { index, item in
        MediaCollectionItemView(
          item: item,
          itemNumber: itemNumber(at: index),
          style: .compact
        )
      }
    }
    .padding(.horizontal, 24)
  }

  func itemNumber(at index: Int) -> Int? {
    section.showItemNumbers == true ? index + 1 : nil
  }
}

// MARK: - Footer

private extension MediaCollectionView {
  @ViewBuilder
  var footerView: some View {
    if let footer = section.footerText, !footer.isEmpty {
      Text(footer)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 24)
    }
  }
}
