import AVFoundation
import Combine
import Foundation

/// Owns the AVPlayer, the active subtitle cue, and dub switching.
///
/// Dub switching is `replaceCurrentItem` + an exact seek, NOT a seamless
/// swap, and that is a data-model consequence rather than a shortcut: each
/// dub is a separate HLS asset (Mux ships no alternate-audio group), an
/// AVPlayerItem does not buffer until it is attached to a player, and
/// AVQueuePlayer can only advance to the next item at time zero. A truly
/// seamless swap would need two live players and a hand-built transport UI.
@MainActor
final class PlaybackController: ObservableObject {
    @Published private(set) var activeCue: VttCue?
    /// Surfaced so the UI can hold the previous frame across a dub swap
    /// instead of showing the black flash `replaceCurrentItem` produces.
    @Published private(set) var isSwitchingDub = false

    let player = AVPlayer()

    private var cues: [VttCue] = []
    private var timeObserver: Any?

    init() {
        // Required before setRate(_:time:atHostTime:) and generally better for
        // a TV: a stall that resolves itself beats a player that refuses to
        // start on a slow connection.
        player.automaticallyWaitsToMinimizeStalling = true
        observeTime()
    }

    deinit {
        // The observer retains self; leaving it attached leaks the controller
        // and keeps a decode slot alive after the screen is gone.
        if let timeObserver {
            player.removeTimeObserver(timeObserver)
        }
    }

    private func observeTime() {
        // 4Hz: fast enough that a caption never visibly lags its speech,
        // cheap enough to run for a two-hour film.
        let interval = CMTime(seconds: 0.25, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: interval, queue: .main
        ) { [weak self] time in
            guard let self else { return }
            let seconds = time.seconds
            guard seconds.isFinite else { return }
            let next = Vtt.findActiveCue(self.cues, at: seconds)
            // Only publish on change — a 4Hz stream of identical values would
            // re-render the overlay for nothing.
            if next != self.activeCue { self.activeCue = next }
        }
    }

    func load(playbackID: String, startAt seconds: TimeInterval = 0) {
        guard let url = MuxURL.hlsURL(playbackID: playbackID) else { return }
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        if seconds > 0 { seek(to: seconds) }
        player.play()
    }

    /// Switch audio language, keeping the viewer where they were.
    ///
    /// The position is captured BEFORE the item is replaced — reading it
    /// afterwards returns the new item's zero and silently restarts the film.
    func switchDub(to playbackID: String) {
        guard let url = MuxURL.hlsURL(playbackID: playbackID) else { return }
        let resumeAt = player.currentTime().seconds
        let wasPlaying = player.rate > 0
        isSwitchingDub = true

        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        if resumeAt.isFinite, resumeAt > 0 {
            seek(to: resumeAt) { [weak self] in
                if wasPlaying { self?.player.play() }
                self?.isSwitchingDub = false
            }
        } else {
            if wasPlaying { player.play() }
            isSwitchingDub = false
        }
    }

    /// Zero tolerance: a language switch that lands even a second away reads
    /// as the film jumping, which is exactly what the viewer did not ask for.
    private func seek(to seconds: TimeInterval, completion: (() -> Void)? = nil) {
        player.seek(
            to: CMTime(seconds: seconds, preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        ) { _ in completion?() }
    }

    func setSubtitleCues(_ cues: [VttCue]) {
        self.cues = cues
        activeCue = nil
    }

    /// Detach, don't just pause. tvOS caps simultaneous decode pipelines and a
    /// paused-but-attached item keeps its slot — the documented failure is a
    /// later player that loads its manifest, reports playing, then sits black.
    func teardown() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        cues = []
        activeCue = nil
    }
}
