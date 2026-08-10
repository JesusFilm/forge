import SwiftUI

/// Search tab: native tvOS keyboard via `.searchable`, results as a poster
/// grid, playable rows straight into the player.
struct SearchView: View {
    @StateObject private var viewModel = SearchViewModel()
    @State private var playing: Playback?

    var body: some View {
        NavigationStack {
            content
                .searchable(text: $viewModel.query, prompt: "Titles, stories, topics")
        }
        .fullScreenCover(item: $playing) { playback in
            PlayerView(playbackID: playback.id)
        }
        .onAppear { viewModel.activate() }
        .onDisappear { viewModel.deactivate() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle:
            ContentUnavailableView {
                Label("Find something to watch", systemImage: "magnifyingglass")
            } description: {
                Text("Search titles, stories, and topics across the library.")
            }
        case .searching:
            ProgressView("Searching…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .results(let rows) where rows.isEmpty:
            ContentUnavailableView.search(text: viewModel.query)
        case .results(let rows):
            resultsGrid(rows)
        case .failed:
            ContentUnavailableView {
                Label("Search unavailable", systemImage: "wifi.exclamationmark")
            } description: {
                Text("Something went wrong reaching the library.")
            } actions: {
                Button("Retry") { viewModel.retry() }
            }
        }
    }

    private func resultsGrid(_ rows: [SearchResultRow]) -> some View {
        ScrollView {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 360, maximum: 500), spacing: 48, alignment: .top)],
                alignment: .leading,
                spacing: 56
            ) {
                ForEach(rows) { row in
                    SearchResultCard(row: row) {
                        // Only playable rows navigate; containers have no
                        // detail screen in this app yet, so their select is
                        // deliberately inert rather than misleading. They stay
                        // focusable so grid navigation doesn't skip holes.
                        if let id = row.playbackID {
                            playing = Playback(id: id, title: row.title)
                        }
                    }
                }
            }
            .padding(.horizontal, 64)
            .padding(.vertical, 40)
        }
        // The card focus effect scales past cell bounds; clipping it reads as
        // a rendering glitch from the couch.
        .scrollClipDisabled()
    }
}

/// Item binding for the player cover — the playback id doubles as identity,
/// and constructing this only from playable rows keeps optional-unwrapping
/// out of the presentation path.
private struct Playback: Identifiable {
    let id: String
    let title: String
}

private struct SearchResultCard: View {
    let row: SearchResultRow
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: action) {
                poster
            }
            .buttonStyle(.card)

            Text(row.title)
                .font(.callout)
                .lineLimit(2)

            if let label = row.label, !label.isEmpty {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var poster: some View {
        // Fixed 16:9 canvas whether or not an image ever arrives, so the grid
        // never reflows around slow loads. Overlays don't participate in
        // layout, which is what lets scaledToFill + clipped work here.
        Color.white.opacity(0.08)
            .overlay {
                Image(systemName: row.playbackID == nil ? "square.stack" : "play.rectangle")
                    .font(.largeTitle)
                    .foregroundStyle(.tertiary)
            }
            .overlay {
                if let url = row.imageURL ?? MuxURL.thumbnailURL(playbackID: row.playbackID) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        }
                    }
                }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipped()
    }
}
