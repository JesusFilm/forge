import AVKit
import Combine
import SwiftUI

/// Showcase Mode — the unattended kiosk reel.
///
/// Everything that decides anything lives in `ShowcaseViewModel`. This file is
/// the picture: one player, one cover that hides the swap seam, four overlays,
/// and a single focusable target so the screen is never a focus dead end.
struct ShowcaseView: View {
    @StateObject private var viewModel = ShowcaseViewModel()
    @StateObject private var reel = ShowcaseReelPlayer()
    @Environment(\.scenePhase) private var scenePhase

    /// Called after the reel has recorded its own exit, so the host can pop
    /// back to whatever launched it.
    private let onExit: () -> Void

    init(onExit: @escaping () -> Void = {}) {
        self.onExit = onExit
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            // ONE player, not two.
            //
            // The React Native reel runs two players because `expo-video`'s
            // `replaceAsync` blanks the tvOS surface mid-swap. The same class
            // of constraint holds for AVPlayer: an `AVPlayerItem` does not
            // buffer until it is attached, `AVQueuePlayer` can only advance at
            // time zero, and `replaceCurrentItem` is precisely where the black
            // frame comes from. For an UNATTENDED reel a brief transition is
            // acceptable, so this ships one player plus a cover that holds the
            // outgoing still across the swap.
            //
            // If the seam proves unacceptable on device, the fix is a SECOND
            // AVPlayer: preroll the next hop's item on the idle player, then
            // cross-fade the two `VideoPlayer` layers on opacity. That doubles
            // the decode-slot cost (tvOS caps simultaneous pipelines), so it
            // must be paired with detaching the idle player between hops — do
            // not add it speculatively.
            VideoPlayer(player: reel.player)
                .ignoresSafeArea()
                // The kiosk must never summon the transport bar. Presses
                // belong to the exit catcher below.
                .allowsHitTesting(false)

            cover
            lowerThird
            chapterCard
            interstitial
            stills
            exitCatcher
        }
        .background(Theme.background.ignoresSafeArea())
        .task {
            reel.onEnded = { viewModel.streamEnded() }
            reel.onFailed = { viewModel.streamFailed() }
            viewModel.start()
        }
        .onChange(of: viewModel.stream) { _, stream in
            guard let stream else { return }
            reel.play(stream)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                // Law: detach, do not merely pause. A paused-but-attached item
                // keeps its tvOS decode slot, and the next player to open then
                // reports playing and sits black.
                reel.teardown()
                viewModel.suspend()
            case .active:
                viewModel.resume()
            default:
                // `.inactive` is a FOREGROUND blip — Siri, Control Center, a
                // notification. Tearing down here kills playback the moment
                // somebody summons Siri, which is the documented tvOS trap.
                break
            }
        }
        // The Menu button. Without claiming it the press pops the navigation
        // stack behind the reel and leaves the reel's own state running.
        .onExitCommand { exit(reason: "press") }
        .onDisappear {
            reel.teardown()
            viewModel.exit(reason: "navigation")
        }
    }

    private func exit(reason: String) {
        reel.teardown()
        viewModel.exit(reason: reason)
        onExit()
    }

    // MARK: - Cover

    /// Holds a still across the swap so the reel never shows the black frame
    /// `replaceCurrentItem` produces. Also covers the resolve window, when
    /// there is no stream at all yet.
    @ViewBuilder
    private var cover: some View {
        if reel.isSwapping || viewModel.stream == nil {
            AsyncImage(url: coverURL) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill()
                } else {
                    Theme.background
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            .ignoresSafeArea()
            .transition(.opacity)
        }
    }

    private var coverURL: URL? {
        viewModel.excerpt?.posterURL
            ?? MuxURL.thumbnailURL(playbackID: viewModel.stream?.playbackID, width: 1920)
    }

    // MARK: - Lower third

    /// Names the language, and ONLY during a hop. An ordinary excerpt claims
    /// nothing: the label exists to make the switch legible, and putting one
    /// on every excerpt would make the one moment that matters unremarkable.
    @ViewBuilder
    private var lowerThird: some View {
        if let stream = viewModel.stream, stream.claimsLanguage {
            VStack {
                Spacer()
                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        Theme.Eyebrow(text: "Every language")
                        Text(stream.languageName)
                            .font(.system(size: 52, weight: .bold))
                            .foregroundStyle(Theme.text)
                    }
                    Spacer()
                }
                .padding(.horizontal, 96)
                .padding(.bottom, 88)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(
                LinearGradient(
                    colors: [.clear, Theme.background.opacity(0.85)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
            )
            .transition(.opacity)
            .id(stream.languageName)
        }
    }

    // MARK: - Chapter card

    @ViewBuilder
    private var chapterCard: some View {
        if viewModel.state.phase == .chapterCard, let chapter = viewModel.chapter {
            ZStack {
                Theme.background.ignoresSafeArea()
                VStack(spacing: 24) {
                    Text(chapter.title)
                        .font(.system(size: 96, weight: .heavy))
                        .foregroundStyle(Theme.text)
                        .multilineTextAlignment(.center)
                    if let subtitle = chapter.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.system(size: 34))
                            .foregroundStyle(Theme.text62)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 160)
            }
            .transition(.opacity)
        }
    }

    // MARK: - Stat interstitial

    @ViewBuilder
    private var interstitial: some View {
        if viewModel.state.phase == .interstitial, let content = viewModel.interstitial {
            ZStack {
                Theme.background.ignoresSafeArea()
                VStack(spacing: 18) {
                    ForEach(Array(content.authoredLines.enumerated()), id: \.offset) { line in
                        Text(line.element)
                            .font(.system(size: 48, weight: .bold))
                            .foregroundStyle(Theme.text)
                            .multilineTextAlignment(.center)
                    }
                    if let live = content.liveLine {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Theme.accent)
                            .frame(width: 72, height: 3)
                            .padding(.vertical, 28)
                        Text(live)
                            .font(.system(size: 28, weight: .medium))
                            .foregroundStyle(Theme.text62)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 1100)
                    }
                }
                .padding(.horizontal, 120)
            }
            .transition(.opacity)
        }
    }

    // MARK: - Stills floor

    @ViewBuilder
    private var stills: some View {
        if viewModel.state.phase == .stills || viewModel.state.phase == .resolving {
            StillsSlideshow(posters: viewModel.stillsPosters)
                .transition(.opacity)
        }
    }

    // MARK: - Input

    /// The reel's ONE focusable element.
    ///
    /// Two jobs, both required. It turns any deliberate press into an exit —
    /// there is nothing else on a kiosk screen to select. And it guarantees
    /// the screen has at least one focusable descendant at first layout, which
    /// is the condition every `focusSection()` and every directional swipe on
    /// tvOS depends on; a screen with none strands the focus engine entirely.
    private var exitCatcher: some View {
        Button {
            exit(reason: "press")
        } label: {
            Color.clear.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .accessibilityLabel("Exit showcase mode")
    }
}

// MARK: - Stills slideshow

/// The floor: last-good poster art on a slow beat. Deliberately no spinner and
/// no error copy — resolution is being retried behind this, and somebody
/// walking past an office TV must never see a fault.
struct StillsSlideshow: View {
    let posters: [URL]

    /// Slow enough to read as ambient art rather than a slideshow demo.
    private static let stillDuration: TimeInterval = 7

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            if !posters.isEmpty {
                // Derived from the timeline date rather than held in state:
                // there is no timer to leak, and the beat survives any
                // re-render the reel provokes behind it.
                TimelineView(.periodic(from: .now, by: Self.stillDuration)) { context in
                    let step = Int(
                        context.date.timeIntervalSinceReferenceDate / Self.stillDuration
                    )
                    let index = ((step % posters.count) + posters.count) % posters.count
                    AsyncImage(url: posters[index]) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else {
                            Theme.background
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                    .id(index)
                    .transition(.opacity)
                    .animation(.easeInOut(duration: 1.2), value: index)
                }
                .ignoresSafeArea()

                LinearGradient(
                    colors: [.clear, Theme.background.opacity(0.75)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
            }

            VStack {
                Spacer()
                HStack {
                    Text("JESUS FILM WATCH")
                        .font(.system(size: 22, weight: .semibold))
                        .kerning(4)
                        .foregroundStyle(Theme.text50)
                    Spacer()
                }
                .padding(.horizontal, 96)
                .padding(.bottom, 80)
            }
        }
    }
}

// MARK: - Reel player

/// The reel's transport: one `AVPlayer`, bounded windows, and the failure
/// signals the sequencing machine needs to skip a dead item.
///
/// Deliberately NOT a custom `AVPlayerLayer` transport. The system player
/// owns decoding, buffering, and HLS variant selection; the only thing this
/// class adds is the window bound and the liveness watchdog.
@MainActor
final class ShowcaseReelPlayer: ObservableObject {
    /// True from the moment a swap starts until the new item's time actually
    /// advances. The view holds a cover for exactly this long.
    @Published private(set) var isSwapping = true

    let player = AVPlayer()

    var onEnded: (() -> Void)?
    var onFailed: (() -> Void)?

    /// An item that has neither started nor reported an error by this point is
    /// wedged. Unattended means nobody will press anything to rescue it, so
    /// the reel must declare it dead and move on.
    private let startDeadline: TimeInterval = 12

    private var timeObserver: Any?
    private var cancellables: Set<AnyCancellable> = []
    private var watchdog: Task<Void, Never>?
    private var window: ExcerptWindow?
    private var hasStarted = false
    private var settled = false
    private var qoe: PlaybackQoESession?
    private let telemetry: Telemetry

    init(telemetry: Telemetry = .shared) {
        self.telemetry = telemetry
        // A stall that resolves itself beats a player that refuses to start on
        // a slow office connection.
        player.automaticallyWaitsToMinimizeStalling = true
        // Deliberately NOT muted. The language chapter's whole claim is that
        // you can HEAR the story change language mid-scene; a silent reel would
        // reduce that to a caption nobody reads.
    }

    deinit {
        if let timeObserver {
            player.removeTimeObserver(timeObserver)
        }
    }

    func play(_ stream: ShowcaseStream) {
        // Close out whatever was playing BEFORE anything can return early:
        // `settled` gates both outcomes, so a guard that fires while the
        // previous item is still settled would swallow this item's failure and
        // wedge the reel on one poster.
        finishQoE(.abandoned)
        cancellables.removeAll()
        watchdog?.cancel()
        hasStarted = false
        settled = false
        isSwapping = true
        window = stream.window
        qoe = PlaybackQoESession(contentID: stream.playbackID)

        guard let url = MuxURL.hlsURL(playbackID: stream.playbackID) else {
            // An id that fails validation can never play. Report it now rather
            // than waiting out the watchdog on something already known dead.
            reportFailure("invalid_playback_id")
            return
        }

        let item = AVPlayerItem(url: url)
        if stream.window.end.isFinite, stream.window.end > stream.window.start {
            // The system stops the item at the window's end and posts
            // `didPlayToEndTime`, so the bound costs no polling.
            item.forwardPlaybackEndTime = CMTime(
                seconds: stream.window.end, preferredTimescale: 600
            )
        }
        observe(item)

        player.replaceCurrentItem(with: item)
        installTimeObserver()

        if stream.window.start > 0 {
            // Half a second of tolerance, not zero: an exact HLS seek costs a
            // segment fetch, and half a second into an excerpt nobody chose is
            // invisible. (The watch screen's dub swap is the opposite case —
            // there the viewer knows exactly where they were.)
            let tolerance = CMTime(seconds: 0.5, preferredTimescale: 600)
            player.seek(
                to: CMTime(seconds: stream.window.start, preferredTimescale: 600),
                toleranceBefore: tolerance,
                toleranceAfter: tolerance
            ) { [weak self] _ in
                Task { @MainActor in self?.player.play() }
            }
        } else {
            player.play()
        }

        armWatchdog()
    }

    /// Detach, do not merely pause: a paused-but-attached item keeps its tvOS
    /// decode slot, and the next player to open then reports playing and sits
    /// black.
    func teardown() {
        finishQoE(.abandoned)
        watchdog?.cancel()
        watchdog = nil
        cancellables.removeAll()
        if let timeObserver {
            player.removeTimeObserver(timeObserver)
            self.timeObserver = nil
        }
        player.pause()
        player.replaceCurrentItem(with: nil)
        window = nil
        hasStarted = false
        settled = true
        isSwapping = true
    }

    // MARK: Observation

    private func observe(_ item: AVPlayerItem) {
        NotificationCenter.default
            .publisher(for: AVPlayerItem.didPlayToEndTimeNotification, object: item)
            .sink { [weak self] _ in
                Task { @MainActor in self?.reportEnded() }
            }
            .store(in: &cancellables)

        NotificationCenter.default
            .publisher(for: AVPlayerItem.failedToPlayToEndTimeNotification, object: item)
            .sink { [weak self] _ in
                Task { @MainActor in self?.reportFailure("failed_to_play_to_end") }
            }
            .store(in: &cancellables)

        item.publisher(for: \.status)
            .sink { [weak self] status in
                guard status == .failed else { return }
                let message = item.error?.localizedDescription
                Task { @MainActor in self?.reportFailure(message ?? "item_failed") }
            }
            .store(in: &cancellables)
    }

    private func installTimeObserver() {
        guard timeObserver == nil else { return }
        // 2Hz: enough to notice the first frame and the window's end promptly,
        // cheap enough to run for hours unattended.
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor in self?.tick(time.seconds) }
        }
    }

    private func tick(_ seconds: TimeInterval) {
        guard seconds.isFinite, let window else { return }
        qoe?.progressed(to: seconds)

        if !hasStarted, seconds > window.start + 0.05 {
            hasStarted = true
            isSwapping = false
            qoe?.firstFrame()
            watchdog?.cancel()
            watchdog = nil
        }

        // Belt and braces for the window bound. `forwardPlaybackEndTime` is the
        // primary mechanism; an unattended reel that wedges past its window is
        // the worst failure this screen has, so it does not rest on one signal.
        if seconds >= window.end + 0.5 {
            reportEnded()
        }
    }

    private func armWatchdog() {
        watchdog = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(
                nanoseconds: UInt64(self.startDeadline * 1_000_000_000)
            )
            guard !Task.isCancelled, !self.hasStarted else { return }
            self.reportFailure("start_deadline")
        }
    }

    // MARK: Outcomes

    /// Both outcomes are single-shot per item: the end notification, the
    /// belt-and-braces time check, and the watchdog can all fire for one item,
    /// and a double report would advance the reel two items at once.
    private func reportEnded() {
        guard !settled else { return }
        settled = true
        finishQoE(.ended)
        onEnded?()
    }

    private func reportFailure(_ message: String?) {
        guard !settled else { return }
        settled = true
        qoe?.failed(message)
        finishQoE(.abandoned)
        onFailed?()
    }

    private func finishQoE(_ reason: PlaybackQoEReason) {
        if let summary = qoe?.finalize(reason) {
            telemetry.playbackQoE(summary)
        }
        qoe = nil
    }
}
