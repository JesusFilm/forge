import SwiftUI

/// Renders an ordered list of experience sections in a lazy vertical stack.
/// Each section is dispatched to its renderer via `ExperienceSectionView`.
struct ExperienceSectionListView: View {
  let sections: [ExperienceSection]

  var body: some View {
    LazyVStack(spacing: 0) {
      ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
        ExperienceSectionView(section: section)
      }
    }
  }
}
