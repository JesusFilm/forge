import SwiftUI

public struct ForgeRootView: View {
  private let contentRepository: ContentRepository?
  @State private var viewModel: WatchHomeViewModel?

  public init(contentRepository: ContentRepository? = nil) {
    self.contentRepository = contentRepository
    _viewModel = State(initialValue: contentRepository.map { WatchHomeViewModel(repository: $0) })
  }

  public var body: some View {
    #if DEBUG
    if let viewModel = viewModel {
      ExperienceDebugView(viewModel: viewModel)
    } else {
      Text("Forge iOS")
        .accessibilityLabel("Forge iOS")
    }
    #else
    Text("Forge iOS")
      .accessibilityLabel("Forge iOS")
    #endif
  }
}

private struct ExperienceDebugView: View {
  let viewModel: WatchHomeViewModel

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          if viewModel.isLoading {
            ProgressView("Loading Experience…")
              .accessibilityLabel("Loading experience")
          } else if let experience = viewModel.experienceContent {
            experienceHeader(experience)
            sectionsJSON(experience)
          } else if let error = viewModel.homeError {
            Text("Error: \(error)")
              .foregroundStyle(.red)
              .accessibilityLabel("Error \(error)")
          } else {
            Text("No experience loaded")
              .accessibilityLabel("No experience loaded")
          }
        }
        .padding()
      }
      .navigationTitle("Forge Debug")
    }
    .task {
      await viewModel.loadExperience(slug: "experience", locale: "en")
    }
  }

  private func experienceHeader(_ experience: ExperienceContent) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(experience.title)
        .font(.title2.bold())
        .accessibilityLabel("Title: \(experience.title)")
      Text("slug: \(experience.slug) | state: \(experience.state)")
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Slug \(experience.slug), state \(experience.state)")
      Text("\(experience.sections.count) sections")
        .font(.caption.bold())
        .accessibilityLabel("\(experience.sections.count) sections")
    }
  }

  private func sectionsJSON(_ experience: ExperienceContent) -> some View {
    let jsonString = encodeExperienceJSON(experience)
    return Text(jsonString)
      .font(.system(.caption2, design: .monospaced))
      .textSelection(.enabled)
      .accessibilityLabel("Experience JSON")
  }

  private func encodeExperienceJSON(_ experience: ExperienceContent) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? encoder.encode(experience),
          let json = String(data: data, encoding: .utf8) else {
      return "Failed to encode JSON"
    }
    return json
  }
}
