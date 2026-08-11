import SwiftUI

/// Series detail screen — the destination for `SERIES` / `COLLECTION` records.
///
/// It exists because a collection has no playable media of its own: verified in
/// production, `lumo-the-gospel-of-matthew` publishes 56 dubs and none of them
/// carries a playback id, so opening it on the watch screen strands the viewer
/// on a disabled Play button and 56 unusable languages. The media lives on the
/// children, which is what this screen renders.
struct SeriesView: View {
    let slug: String
    /// Programmatic navigation instead of `NavigationLink`, matching Home: a
    /// NavigationLink card would not take focus in this app's composition, and
    /// the whole point of this screen is that its cards are reachable.
    var navigate: (Route) -> Void

    @StateObject private var viewModel = SeriesViewModel()

    /// Initial focus lands on the hero CTA, which is the one element this
    /// screen guarantees exists.
    private enum FocusTarget: Hashable {
        case heroCTA
    }

    @FocusState private var focus: FocusTarget?

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                loadingView
            case .failed:
                errorView
            case .loaded(let series):
                content(series)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
        .task { await viewModel.load(slug: slug) }
    }

    // MARK: - Content

    /// The focus contract for this screen, and why the episode rail is a plain
    /// `HStack`.
    ///
    /// tvOS resolves a swipe GEOMETRICALLY, and `focusSection()` is documented
    /// to do NOTHING when a region has no focusable descendants. A lazy
    /// container has materialized none at the moment of the swipe, so a lazy
    /// FIRST shelf is a dead end by construction — this is the same fault that
    /// made Home unreachable from the tab bar on real hardware. The rail here
    /// is the first (and only) shelf, so it stays eager.
    ///
    /// The hero CTA is the second guarantee: it renders whether or not there
    /// is anywhere to go, so this screen has a focus target from first layout
    /// even for a series that returns zero episodes.
    private func content(_ series: SeriesDetail) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 48) {
                hero(series)

                if series.episodes.isEmpty {
                    emptyEpisodesView
                } else {
                    episodeRail(series.episodes)
                }
            }
            .padding(.bottom, 80)
        }
        .focusSection()
        .defaultFocus($focus, .heroCTA, priority: .userInitiated)
    }

    // MARK: - Hero

    private func hero(_ series: SeriesDetail) -> some View {
        ZStack(alignment: .bottomLeading) {
            poster(url: series.posterURL, playbackID: nil, width: 1920)
                .frame(maxWidth: .infinity)
                .frame(height: 620)
                .clipped()

            LinearGradient(
                colors: [Theme.background.opacity(0.95), Theme.background.opacity(0.45), .clear],
                startPoint: .bottom,
                endPoint: .center
            )
            LinearGradient(
                colors: [Theme.background.opacity(0.8), .clear],
                startPoint: .leading,
                endPoint: .center
            )

            VStack(alignment: .leading, spacing: 20) {
                Theme.Eyebrow(text: displayLabel(series.label))

                Text(series.title)
                    .font(.system(size: 76, weight: .heavy))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                let meta = metaLine(series)
                if !meta.isEmpty {
                    Text(meta)
                        .font(.system(size: 26))
                        .foregroundStyle(Theme.text62)
                }

                if let description = series.description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: 28))
                        .foregroundStyle(Theme.text82)
                        .lineLimit(3)
                        .frame(maxWidth: 1000, alignment: .leading)
                }

                heroCTA(series)
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .focused($focus, equals: .heroCTA)
            }
            .padding(.horizontal, 80)
            .padding(.bottom, 70)
        }
    }

    /// Always rendered, openable or not. A hero that drops its only button when
    /// the series has no openable child leaves the focus engine nothing to aim
    /// at — half of the reason Home dead-ended on hardware.
    private func heroCTA(_ series: SeriesDetail) -> some View {
        let lead = series.leadEpisode
        return Button {
            if let route = lead?.route { navigate(route) }
        } label: {
            Label(
                lead == nil ? "No episodes" : (lead?.isPlayable == true ? "Play" : "Explore"),
                systemImage: lead == nil
                    ? "square.stack"
                    : (lead?.isPlayable == true ? "play.fill" : "square.stack")
            )
            .font(.system(size: 30, weight: .semibold))
        }
    }

    /// `N episodes · total runtime`. Both slots are omitted rather than
    /// zero-filled: a collection of collections reports no durations at all,
    /// and "0m" reads as a broken record instead of an absent one.
    private func metaLine(_ series: SeriesDetail) -> String {
        var parts: [String] = []
        let count = series.episodes.count
        if count > 0 {
            parts.append(count == 1 ? "1 episode" : "\(count) episodes")
        }
        if let total = series.totalDurationSeconds, total > 0 {
            parts.append(formatDuration(total))
        }
        return parts.joined(separator: " · ")
    }

    // MARK: - Episode rail

    private func episodeRail(_ episodes: [Episode]) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Episodes")
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 80)

            ScrollView(.horizontal) {
                // Eager HStack, NOT LazyHStack — see the focus contract above.
                HStack(alignment: .top, spacing: 40) {
                    ForEach(episodes) { episode in
                        episodeCard(episode)
                    }
                }
                .padding(.horizontal, 80)
                // Room for the .card focus lift/shadow, which the scroll view
                // would otherwise clip off the focused card.
                .padding(.vertical, 24)
            }
            .scrollClipDisabled()
            // Its own directional target: without this a swipe toward a row
            // whose cards sit outside the projected corridor finds nothing.
            .focusSection()
        }
    }

    private func episodeCard(_ episode: Episode) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            // ONE Button whether or not the card can open. Select is inert
            // when there is no route, but the card stays FOCUSABLE — skipping
            // holes makes D-pad browsing feel broken, and `.disabled()` would
            // remove it from the focus engine entirely. Never `.disabled()`
            // here.
            Button {
                if let route = episode.route { navigate(route) }
            } label: {
                poster(url: episode.posterURL, playbackID: episode.playbackID, width: 640)
                    .frame(width: 400, height: 225)
                    .clipped()
                    .overlay(alignment: .bottomTrailing) {
                        if let seconds = episode.durationSeconds, seconds > 0 {
                            Text(formatDuration(seconds))
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(Theme.text)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(Theme.pillFill, in: Capsule())
                                .padding(10)
                        }
                    }
            }
            // The system card style owns tvOS focus movement and visuals end
            // to end. Browsing must never ride a custom style whose focus read
            // could silently stop firing.
            .buttonStyle(.card)

            Text(cardTitle(episode))
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Theme.text82)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(width: 400, alignment: .leading)

            // A child that is itself a series says so, so the viewer knows the
            // card opens another list rather than a video.
            if SeriesShape.isSeriesLabel(episode.label) {
                Text(displayLabel(episode.label))
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.text50)
                    .frame(width: 400, alignment: .leading)
            }
        }
    }

    private func cardTitle(_ episode: Episode) -> String {
        guard let number = episode.episodeNumber else { return episode.title }
        return "\(number). \(episode.title)"
    }

    // MARK: - Shared pieces

    /// CMS artwork first, Mux frame as the fallback — the same precedence the
    /// rest of the app uses, so both clients ride one warm Mux render cache.
    private func poster(url: URL?, playbackID: String?, width: Int) -> some View {
        AsyncImage(url: url ?? MuxURL.thumbnailURL(playbackID: playbackID, width: width)) { phase in
            if let image = phase.image {
                image
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    Color(white: 0.12)
                    Image(systemName: "square.stack")
                        .font(.largeTitle)
                        .foregroundStyle(.white.opacity(0.2))
                }
            }
        }
    }

    /// `VideoLabel` is an SCREAMING_SNAKE GraphQL enum; the eyebrow shows it
    /// as words. Never lowercase the value before comparing it — see
    /// `SeriesShape`.
    private func displayLabel(_ label: String?) -> String {
        (label ?? "SERIES").replacingOccurrences(of: "_", with: " ")
    }

    private func formatDuration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
    }

    // MARK: - Loading / empty / error

    private var loadingView: some View {
        ContentUnavailableView {
            Label("Loading series", systemImage: "square.stack")
        } description: {
            ProgressView()
                .tint(.white)
                .scaleEffect(1.2)
        }
    }

    private var errorView: some View {
        ContentUnavailableView {
            Label("Can't load this series", systemImage: "wifi.exclamationmark")
        } description: {
            Text("Something went wrong reaching the library.")
        } actions: {
            Button("Retry") { Task { await viewModel.load(slug: slug) } }
        }
    }

    /// The series loaded but has no children. The hero above still renders, so
    /// this replaces only the rail — and its Retry keeps a second focusable
    /// element on screen alongside the (inert) hero CTA.
    private var emptyEpisodesView: some View {
        ContentUnavailableView {
            Label("No episodes yet", systemImage: "film.stack")
        } description: {
            Text("This series has nothing published to watch right now.")
        } actions: {
            Button("Retry") { Task { await viewModel.load(slug: slug) } }
        }
        .frame(height: 360)
        .focusSection()
    }
}
