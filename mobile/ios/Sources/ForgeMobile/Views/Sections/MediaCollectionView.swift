import SwiftUI

/// Renders a MediaCollection section with variant-based layouts.
/// Supports carousel, grid, collection, hero, and player variants.
/// Reusable at top level, inside Container slots, and Section wrappers.
struct MediaCollectionView: View {
  let section: MediaCollectionSection

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
    let hasCategory = section.categoryLabel != nil && !section.categoryLabel!.isEmpty
    let hasTitle = section.title != nil && !section.title!.isEmpty
    let hasCta = section.ctaLink != nil && !section.ctaLink!.isEmpty

    if hasCategory || hasTitle {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 4) {
          if hasCategory {
            Text(section.categoryLabel!.uppercased())
              .font(.caption.weight(.semibold))
              .foregroundStyle(.secondary)
              .tracking(1.2)
          }
          if hasTitle {
            Text(section.title!)
              .font(.title2.bold())
              .foregroundStyle(.primary)
              .accessibilityAddTraits(.isHeader)
          }
        }
        Spacer()
        if hasCta, let url = URL(string: section.ctaLink!) {
          Link(destination: url) {
            HStack(spacing: 4) {
              Image(systemName: "play.fill")
                .font(.caption2)
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
      carouselLayout
    case .grid:
      gridLayout
    case .collection:
      collectionLayout
    case .hero:
      heroLayout
    }
  }

  var carouselLayout: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      LazyHStack(spacing: 16) {
        ForEach(Array(section.items.enumerated()), id: \.element.id) { index, item in
          MediaCollectionItemView(
            item: item,
            itemNumber: itemNumber(at: index),
            style: .standard
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

  var collectionLayout: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      LazyHStack(spacing: 16) {
        ForEach(Array(section.items.enumerated()), id: \.element.id) { index, item in
          MediaCollectionItemView(
            item: item,
            itemNumber: itemNumber(at: index),
            style: .collection
          )
        }
      }
      .padding(.horizontal, 24)
    }
  }

  var heroLayout: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      LazyHStack(spacing: 16) {
        ForEach(Array(section.items.enumerated()), id: \.element.id) { index, item in
          MediaCollectionItemView(
            item: item,
            itemNumber: itemNumber(at: index),
            style: .hero
          )
        }
      }
      .padding(.horizontal, 24)
    }
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
