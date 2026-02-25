import SwiftUI

public struct ForgeRootView: View {
  private let contentRepository: ContentRepository?

  public init(contentRepository: ContentRepository? = nil) {
    self.contentRepository = contentRepository
  }

  public var body: some View {
    #if DEBUG
    if let repo = contentRepository {
      GraphQLTestView(repository: repo)
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

private struct GraphQLTestView: View {
  let repository: ContentRepository
  @State private var homeItem: MobileContentItem?
  @State private var homeError: String?
  @State private var isLoading = true

  var body: some View {
    VStack(spacing: 12) {
      Text("Forge iOS")
        .accessibilityLabel("Forge iOS")
      if isLoading {
        ProgressView("Loading…")
          .accessibilityLabel("Loading content")
      } else if let item = homeItem {
        Text("Loaded: \(item.title)")
          .accessibilityLabel("Loaded title \(item.title)")
      } else if let error = homeError {
        Text("Error: \(error)")
          .foregroundStyle(.red)
          .accessibilityLabel("Error \(error)")
      } else {
        Text("No content")
          .accessibilityLabel("No content")
      }
    }
    .padding()
    .task {
      defer { isLoading = false }
      do {
        let item = try await repository.fetchHome(locale: "en")
        homeItem = item
        homeError = nil
      } catch {
        homeItem = nil
        homeError = error.localizedDescription
      }
    }
  }
}
