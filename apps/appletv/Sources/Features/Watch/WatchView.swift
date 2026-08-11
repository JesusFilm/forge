import SwiftUI

/// Watch detail screen — a DETAILS page, not a player, matching the RN app:
/// artwork, metadata, and actions; playback opens fullscreen from here.
///
/// PR1 scope is the foundation: real data, real dub resolution, real
/// subtitle fetch, and playback. The language/subtitle pickers, up-next rail,
/// about section, and share/download land in PR2 (U4–U7).
struct WatchView: View {
    let slug: String
    /// Lets the screen hand a series-shaped record to the series route
    /// instead of rendering it as an unplayable video (see below).
    var navigate: (Route) -> Void = { _ in }
    @StateObject private var viewModel = WatchViewModel()
    @State private var isPlaying = false
    @State private var showLanguages = false
    @State private var showSubtitles = false
    @State private var activeSubtitle: Subtitle?

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.4)
            case .failed:
                ContentUnavailableView {
                    Label("Can't load this video", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Something went wrong reaching the library.")
                } actions: {
                    Button("Retry") { Task { await viewModel.load(slug: slug) } }
                }
            case .loaded(let video):
                content(video)
                    // A collection's playable media lives on its CHILD
                    // episodes, so the record itself has dubs with no `hls`
                    // and no playback id — verified in production, where
                    // `lumo-the-gospel-of-matthew` returns 56 published dubs
                    // and zero playable ones. Rendered as a video this is a
                    // dead end: a disabled Play button over 56 unusable
                    // languages. Hand it to the series route instead, the
                    // same redirect the React Native watch screen performs.
                    //
                    // The label is the ONLY predicate, deliberately. Counting
                    // children instead once billed ten feature films as
                    // series, because a film carries its own chapter clips
                    // (JESUS has 61).
                    .onAppear {
                        if SeriesShape.isSeriesLabel(video.label) {
                            navigate(.series(slug: video.slug))
                        }
                    }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
        .task { await viewModel.load(slug: slug) }
        .fullScreenCover(isPresented: $isPlaying) {
            if case .loaded(let video) = viewModel.state, let dub = viewModel.activeDub {
                WatchPlayerView(
                    video: video,
                    initialDub: dub,
                    subtitle: activeSubtitle,
                    subtitleCues: viewModel.cues(for: activeSubtitle)
                )
            }
        }
        .sheet(isPresented: $showLanguages) {
            if case .loaded(let video) = viewModel.state {
                LanguageSheet(dubs: video.dubs, active: viewModel.activeDub) { dub in
                    // Changing the dub invalidates the subtitle choice:
                    // subtitles belong to a dub's edition, so the previous
                    // selection may not exist for the new audio.
                    activeSubtitle = nil
                    viewModel.setActiveDub(dub)
                }
            }
        }
        .sheet(isPresented: $showSubtitles) {
            SubtitleSheet(
                subtitles: viewModel.subtitles,
                active: activeSubtitle
            ) { chosen in
                activeSubtitle = chosen
                if let chosen { viewModel.loadCues(for: chosen) }
            }
        }
    }

    private func content(_ video: WatchVideo) -> some View {
        ZStack(alignment: .bottomLeading) {
            poster(video)

            LinearGradient(
                colors: [Theme.background.opacity(0.95), Theme.background.opacity(0.4), .clear],
                startPoint: .bottom,
                endPoint: .center
            )

            VStack(alignment: .leading, spacing: 20) {
                if let label = video.label {
                    Theme.Eyebrow(text: label.replacingOccurrences(of: "_", with: " "))
                }

                Text(video.title)
                    .font(.system(size: 72, weight: .heavy))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                Text(metaLine(video))
                    .font(.system(size: 26))
                    .foregroundStyle(Theme.text62)

                if let description = video.description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: 28))
                        .foregroundStyle(Theme.text82)
                        .lineLimit(3)
                        .frame(maxWidth: 1000, alignment: .leading)
                }

                HStack(spacing: 24) {
                    Button {
                        isPlaying = true
                    } label: {
                        Label("Play", systemImage: "play.fill")
                            .font(.system(size: 28, weight: .semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(viewModel.activeDub?.playbackID == nil)

                    Button {
                        showLanguages = true
                    } label: {
                        Label(
                            viewModel.activeDub?.displayName ?? "Language",
                            systemImage: "globe"
                        )
                        .font(.system(size: 28, weight: .semibold))
                    }
                    .disabled(video.dubs.isEmpty)

                    Button {
                        showSubtitles = true
                    } label: {
                        Label(
                            activeSubtitle?.displayName ?? "Subtitles",
                            systemImage: "captions.bubble"
                        )
                        .font(.system(size: 28, weight: .semibold))
                    }
                    // Subtitles arrive from a second, per-dub request; the
                    // control stays visible but inert until they land so the
                    // row does not reflow under the viewer's focus.
                    .disabled(viewModel.subtitles.isEmpty)
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 80)
            .padding(.bottom, 80)
            .focusSection()
        }
    }

    /// `duration · N languages` — the RN meta line. The language count is the
    /// whole dub list, which is the number viewers care about (2,291 on
    /// `jesus`), not just the playable subset.
    private func metaLine(_ video: WatchVideo) -> String {
        var parts: [String] = []
        if let seconds = viewModel.activeDub?.durationSeconds ?? video.dubs.first?.durationSeconds,
           seconds > 0 {
            parts.append(formatDuration(seconds))
        }
        if !video.dubs.isEmpty {
            parts.append("\(video.dubs.count) languages")
        }
        if let active = viewModel.activeDub {
            parts.append(active.displayName)
        }
        return parts.joined(separator: " · ")
    }

    private func formatDuration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
    }

    private func poster(_ video: WatchVideo) -> some View {
        AsyncImage(url: video.posterURL ?? MuxURL.thumbnailURL(
            playbackID: viewModel.activeDub?.playbackID, width: 1920
        )) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                Theme.background
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }
}
