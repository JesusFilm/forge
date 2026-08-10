import AVKit
import SwiftUI

/// Full-screen HLS playback for a single Mux playback id.
///
/// The native `VideoPlayer` transport is deliberately the entire control
/// surface — tvOS remote scrubbing and the info panel behave the way viewers
/// already expect, and the Menu/Back button dismisses through the presenting
/// container untouched (no `onExitCommand` interception).
struct PlayerView: View {
    @StateObject private var controller: PlayerController
    @Environment(\.dismiss) private var dismiss

    init(playbackID: String) {
        _controller = StateObject(wrappedValue: PlayerController(playbackID: playbackID))
    }

    var body: some View {
        Group {
            if let player = controller.player {
                VideoPlayer(player: player)
                    .onAppear { controller.activate() }
                    .onDisappear { controller.deactivate() }
            } else {
                unplayableView
            }
        }
        .background(Color.black)
        .ignoresSafeArea()
    }

    /// Rendered terminal state for a tainted/absent playback id. Retry is
    /// meaningless here — the id itself is bad, not the network — so the only
    /// affordance is the way out.
    private var unplayableView: some View {
        VStack(spacing: 24) {
            Image(systemName: "play.slash.fill")
                .font(.system(size: 72))
                .foregroundStyle(.secondary)
            Text("This video can’t be played")
                .font(.title2)
            Text("The stream reference is missing or invalid.")
                .font(.callout)
                .foregroundStyle(.secondary)
            Button("Go Back") { dismiss() }
                .buttonStyle(.borderless)
                .padding(.top, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
    }
}

/// Owns the `AVPlayer` for one `PlayerView` identity.
///
/// `@StateObject` scopes construction to the view's lifetime, so focus churn
/// and re-renders never rebuild the player mid-stream. Teardown swaps the
/// item out entirely — a merely paused `AVPlayer` can keep its item's audio
/// pipeline alive after dismissal, which is the player failure couch users
/// notice most.
@MainActor
final class PlayerController: ObservableObject {
    let player: AVPlayer?
    private let streamURL: URL?

    init(playbackID: String) {
        // A nil URL means MuxURL rejected the id; surfacing that as a nil
        // player lets the view render an explicit error instead of a black
        // rectangle that looks like a hung stream.
        streamURL = MuxURL.hlsURL(playbackID: playbackID)
        player = streamURL.map { AVPlayer(url: $0) }
    }

    func activate() {
        guard let player else { return }
        // Deactivation drops the item, so a reappearance (e.g. something was
        // presented over us and dismissed) must re-arm before playing.
        if player.currentItem == nil, let streamURL {
            player.replaceCurrentItem(with: AVPlayerItem(url: streamURL))
        }
        player.play()
    }

    func deactivate() {
        guard let player else { return }
        player.pause()
        player.replaceCurrentItem(with: nil)
    }
}
