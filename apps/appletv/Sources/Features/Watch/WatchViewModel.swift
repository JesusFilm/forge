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

    private let repository: VideoRepository
    private var subtitleTask: Task<Void, Never>?

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

    /// Switching dubs replaces the subtitle set, because subtitles belong to
    /// a dub's edition — carrying the previous dub's cues over would caption
    /// the new audio with the old language's timings.
    func setActiveDub(_ dub: Dub?) {
        activeDub = dub
        subtitles = []
        subtitlesFailed = false
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
