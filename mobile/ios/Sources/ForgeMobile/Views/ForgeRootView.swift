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
      GraphQLTestView(viewModel: viewModel)
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
  let viewModel: WatchHomeViewModel

  var body: some View {
    VStack(spacing: 12) {
      Text("Forge iOS")
        .accessibilityLabel("Forge iOS")
      if viewModel.isLoading {
        ProgressView("Loading…")
          .accessibilityLabel("Loading content")
      } else if let item = viewModel.homeItem {
        Text("Loaded: \(item.title)")
          .accessibilityLabel("Loaded title \(item.title)")
      } else if let error = viewModel.homeError {
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
      await viewModel.load(locale: "en")
    }
  }
}
