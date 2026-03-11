import SwiftUI

/// Dispatches a top-level `ExperienceSection` to the appropriate view.
/// Leaf sections delegate to `SectionContentView`; structural types
/// (Container, Section wrapper) are placeholders until Tier 2 (#293, #294).
struct ExperienceSectionView: View {
  let section: ExperienceSection

  var body: some View {
    switch section {
    case .leaf(let content):
      SectionContentView(content: content)
    case .container(let container):
      ContainerView(section: container)
    case .section:
      UnsupportedSectionView(typeName: "SectionWrapper")
    }
  }
}
