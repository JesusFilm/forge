import Foundation

/// Watch screen state. Loads the video, resolves the default dub, then
/// lazily fetches that dub's subtitles — never every dub's (see VideoQueries).
@MainActor
final class WatchViewModel: ObservableObject {
    enum State: Equatable {
        case loading
        case loaded(WatchVideo)
        case failed
    }

    @Published private(set) var state: State = .loading
    @Published private(set) var activeDub: Dub?
    @Published private(set) var subtitles: [Subtitle] = []
    /// Subtitles are optional and best-effort: a failure here must never
    /// block playback, so it is surfaced separately from `state`.
    @Published private(set) var subtitlesFailed = false

    /// Parsed cues per subtitle id. Cached because a viewer toggling between
    /// two languages should not re-download and re-parse each time.
    @Published private(set) var cuesBySubtitleID: [String: [VttCue]] = [:]

    private let repository: VideoRepository
    private var subtitleTask: Task<Void, Never>?
    private var cueTask: Task<Void, Never>?

    init(repository: VideoRepository = VideoRepository()) {
        self.repository = repository
    }

    func load(slug: String, preferredLanguageSlug: String? = nil) async {
        state = .loading
        do {
            guard let video = try await repository.video(slug: slug) else {
                state = .failed
                return
            }
            state = .loaded(video)
            selectDefaultDub(for: video, preferredLanguageSlug: preferredLanguageSlug)
        } catch {
            if !(error is CancellationError) { state = .failed }
        }
    }

    private func selectDefaultDub(for video: WatchVideo, preferredLanguageSlug: String?) {
        let device = Locale.current.language.languageCode?.identifier
        let dub = DefaultDub.resolve(
            dubs: video.dubs,
            preferredLanguageSlug: preferredLanguageSlug,
            deviceBcp47: device,
            videoPrimaryBcp47: video.primaryBcp47
        )
        setActiveDub(dub)
    }

    /// Cues for a chosen subtitle, if already fetched. Returns empty rather
    /// than blocking: playback must never wait on captions.
    func cues(for subtitle: Subtitle?) -> [VttCue] {
        guard let subtitle else { return [] }
        return cuesBySubtitleID[subtitle.id] ?? []
    }

    /// Download and parse one subtitle's WebVTT.
    func loadCues(for subtitle: Subtitle) {
        guard cuesBySubtitleID[subtitle.id] == nil else { return }
        cueTask?.cancel()
        cueTask = Task { [weak self] in
            do {
                let (data, _) = try await URLSession.shared.data(from: subtitle.vttURL)
                guard !Task.isCancelled, let text = String(data: data, encoding: .utf8) else {
                    return
                }
                let parsed = Vtt.parse(text)
                await MainActor.run { self?.cuesBySubtitleID[subtitle.id] = parsed }
            } catch {
                // Captions are best-effort. A failed fetch leaves the entry
                // absent so a later selection can retry, and playback is
                // untouched either way.
            }
        }
    }

    /// Switching dubs replaces the subtitle set, because subtitles belong to
    /// a dub's edition — carrying the previous dub's cues over would caption
    /// the new audio with the old language's timings.
    func setActiveDub(_ dub: Dub?) {
        activeDub = dub
        subtitles = []
        subtitlesFailed = false
        cuesBySubtitleID = [:]
        cueTask?.cancel()
        subtitleTask?.cancel()
        guard let dub else { return }
        subtitleTask = Task { [repository] in
            do {
                let loaded = try await repository.subtitles(dubID: dub.id)
                guard !Task.isCancelled else { return }
                self.subtitles = loaded
            } catch {
                guard !Task.isCancelled else { return }
                self.subtitlesFailed = true
            }
        }
    }
}
