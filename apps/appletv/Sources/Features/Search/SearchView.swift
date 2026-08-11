import SwiftUI

/// Search tab: native tvOS keyboard via `.searchable`, results as a poster
/// grid, playable rows straight into the player.
///
/// The idle state is not a placeholder — on a TV it carries most of the
/// traffic. Typing a phrase on a Siri Remote is slow enough that a search
/// screen offering only a keyboard is a search screen most viewers abandon, so
/// recents and browse entry points sit where the keyboard's output would be.
///
/// `.searchable` gives the Siri Remote's DICTATION key for free — it is a
/// property of the system keyboard, not of this API — and there is no way to
/// add or move the mic affordance. Nothing on this screen promises one.
struct SearchView: View {
    @ObservedObject var viewModel: SearchViewModel
    @StateObject private var recents = RecentSearchesStore()
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
        // The decision itself lives in SearchHistoryPolicy so it is reachable
        // from a test; a rule that only exists inside an onChange closure can
        // be inverted, or pointed at the wrong string, with the suite green.
        .onChange(of: viewModel.state) { _, _ in
            guard let query = SearchHistoryPolicy.queryToRecord(viewModel) else { return }
            recents.record(query)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle:
            idleView
        case .searching:
            ProgressView("Searching…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .results(let rows) where rows.isEmpty:
            // Not `ContentUnavailableView.search(text:)`: that convenience has
            // no actions slot, which leaves this whole region with nothing
            // focusable and no way back to browse short of deleting the query
            // one character at a time on a remote.
            ContentUnavailableView {
                Label("No results for \u{201C}\(viewModel.query)\u{201D}", systemImage: "magnifyingglass")
            } description: {
                Text("Try a different word, or browse a topic.")
            } actions: {
                Button("Browse topics") { clearQuery() }
            }
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

    // MARK: - Idle: recents + browse

    /// Nothing in here is lazy, deliberately. At idle this is the only
    /// focusable region on the screen below the search field: a lazy container
    /// has materialized no descendants at first layout, and `.focusSection()`
    /// is documented to do nothing without them — which is exactly how Home
    /// lost directional descent from the tab bar.
    private var idleView: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 44) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Find something to watch")
                        .font(.system(size: 44, weight: .bold))
                        .foregroundStyle(Theme.text)
                    Text("Search titles, stories, and topics across the library.")
                        .font(.system(size: 26))
                        .foregroundStyle(Theme.text62)
                }
                .padding(.horizontal, 80)

                if !recents.queries.isEmpty {
                    recentSection
                }
                browseSection
            }
            .padding(.vertical, 32)
        }
        // The bordered/card focus effects lift past their cell bounds;
        // clipping them reads as a rendering glitch from the couch.
        .scrollClipDisabled()
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionTitle("Recent")

            ScrollView(.horizontal) {
                HStack(spacing: 20) {
                    ForEach(recents.queries, id: \.self) { query in
                        Button {
                            run(query)
                        } label: {
                            Text(query)
                                .lineLimit(1)
                                .truncationMode(.tail)
                                .frame(maxWidth: 360)
                        }
                        .buttonStyle(.bordered)
                        // The label carries text the viewer typed. When
                        // telemetry lands it will name actions from
                        // accessibility labels, as the RN app's Datadog wiring
                        // does — this one must be overridden there, never
                        // reported raw (zero-PII is a product law).
                        .accessibilityLabel("Recent search: \(query)")
                        .accessibilityHint("Runs this search again")
                    }

                    Button("Clear") { recents.clear() }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("Clear search history")
                }
                .padding(.horizontal, 80)
                // Room for the focus lift, so the row's edge chips are not
                // clipped by the scroll view when focused.
                .padding(.vertical, 16)
            }
            .scrollClipDisabled()
            // Its own directional target: a swipe toward this row from the
            // search field otherwise has to land inside a chip's projected
            // corridor to find anything.
            .focusSection()
        }
    }

    private var browseSection: some View {
        VStack(alignment: .leading, spacing: 20) {
            sectionTitle("Browse topics")

            VStack(alignment: .leading, spacing: 32) {
                ForEach(Array(SearchCategory.rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: 32) {
                        ForEach(row) { category in
                            categoryCard(category)
                        }
                    }
                }
            }
            .padding(.horizontal, 80)
            .focusSection()
        }
    }

    private func categoryCard(_ category: SearchCategory) -> some View {
        Button {
            run(category.searchTerm)
        } label: {
            ZStack(alignment: .bottomLeading) {
                LinearGradient(
                    colors: category.colors,
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                // Keeps the title legible over the lighter gradients (Study,
                // Family) without dimming the darker ones into mud.
                LinearGradient(
                    colors: [.black.opacity(0.45), .clear],
                    startPoint: .bottom,
                    endPoint: .center
                )
                Text(category.title)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .padding(24)
            }
            .frame(width: 400, height: 200)
        }
        .buttonStyle(.card)
        .accessibilityLabel("\(category.title) category")
        .accessibilityHint("Searches for \(category.searchTerm)")
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 24, weight: .medium))
            .kerning(0.5)
            .foregroundStyle(Theme.text50)
            .padding(.horizontal, 80)
    }

    /// A chip or a category runs its search IMMEDIATELY. The debounce exists to
    /// swallow a typing burst; a viewer who picked a known term has already
    /// decided, and making them wait it out just reads as lag. Same intent as
    /// RN's `runQuery` in `apps/tv/src/lib/search.ts`, which fires `runSearch`
    /// itself and sets `skipNextDebounceRef` so the debounce effect the query
    /// write is about to trigger skips its duplicate.
    private func run(_ term: String) {
        viewModel.query = term
        viewModel.retry()
    }

    /// Emptying the query is what returns the screen to idle — and idle is the
    /// browse view, so this is the "back to browsing" action as well as a clear.
    private func clearQuery() {
        viewModel.query = ""
    }

    // MARK: - Results

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

/// When a search transition earns a place in history, and which query it
/// records.
///
/// Takes the WHOLE view model rather than a `(state, query)` pair on purpose.
/// The distinction this unit turns on — record what the visible results answer
/// for (`submittedQuery`), never what the viewer has typed since (`query`) — is
/// invisible at a call site that hands over a bare `String`, and a call site
/// that hands over the wrong one still compiles, still runs, and records a
/// prefix that never returned results. With no string to choose, there is
/// nothing to get wrong, and the choice is pinned by a test that drives a real
/// view model past its own submission.
@MainActor
enum SearchHistoryPolicy {
    /// The query to record, or nil if this transition earns nothing.
    ///
    /// A query records only once it has PROVED itself — results arrived and
    /// there was at least one. A recents row full of searches that returned
    /// nothing is worse than an empty one.
    static func queryToRecord(_ viewModel: SearchViewModel) -> String? {
        guard case .results(let rows) = viewModel.state, !rows.isEmpty else { return nil }
        // Normalizing here rather than trusting the caller means the nil case
        // covers a view model that never published a submission at all — the
        // failure mode is "no history", never a blank chip.
        return RecentSearches.normalize(viewModel.submittedQuery)
    }
}

/// Idle-state browse topics, ported verbatim from
/// `apps/tv/src/components/search/categories.ts` (itself a port of web's
/// `search-categories.ts`). Titles, search terms, and gradient stops are the
/// contract — keep all three in sync across the three apps.
struct SearchCategory: Identifiable, Equatable {
    let title: String
    let searchTerm: String
    let colors: [Color]

    var id: String { searchTerm }

    static let all: [SearchCategory] = [
        SearchCategory(title: "Bible Stories", searchTerm: "bible stories",
                       colors: [hex(0x66_7E_EA), hex(0x76_4B_A2)]),
        SearchCategory(title: "Parables", searchTerm: "parables",
                       colors: [hex(0xF0_93_FB), hex(0xF5_57_6C)]),
        SearchCategory(title: "Animated", searchTerm: "animated",
                       colors: [hex(0x4F_AC_FE), hex(0x00_F2_FE)]),
        SearchCategory(title: "Study", searchTerm: "study",
                       colors: [hex(0x43_E9_7B), hex(0x38_F9_D7)]),
        SearchCategory(title: "Family", searchTerm: "family",
                       colors: [hex(0xFA_70_9A), hex(0xFE_E1_40)]),
        SearchCategory(title: "Christmas", searchTerm: "christmas",
                       colors: [hex(0xDC_26_26), hex(0x99_1B_1B)])
    ]

    /// Categories laid out three-up. Fixed rows rather than a `LazyVGrid`
    /// because at idle with no recents this is the FIRST focusable region on
    /// the screen, and a lazy grid materializes nothing at first layout.
    static var rows: [[SearchCategory]] {
        stride(from: 0, to: all.count, by: columnCount).map { start in
            Array(all[start..<min(start + columnCount, all.count)])
        }
    }

    /// Three 400pt cards plus gutters inside the 80pt page margins — the
    /// widest count that keeps a card readable from ten feet.
    static let columnCount = 3

    private static func hex(_ value: UInt32) -> Color {
        Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
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
