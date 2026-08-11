import AVKit
import SwiftUI

/// Fullscreen playback with app-rendered subtitles and in-player dub/subtitle
/// switching.
///
/// `videoOverlay` is documented as sitting BELOW the system transport
/// controls and receiving only unhandled events — non-interactive by
/// contract. That makes it exactly right for captions and wrong for menus,
/// which is why the pickers live on the detail screen rather than here.
struct WatchPlayerView: View {
    let video: WatchVideo
    let initialDub: Dub
    let subtitle: Subtitle?
    let subtitleCues: [VttCue]

    @StateObject private var playback = PlaybackController()

    var body: some View {
        VideoPlayer(player: playback.player) {
            subtitleOverlay
        }
        .ignoresSafeArea()
        .onAppear {
            playback.setSubtitleCues(subtitleCues)
            if let id = initialDub.playbackID {
                playback.load(playbackID: id)
            }
        }
        // Cues can arrive after the player opens (the VTT is a separate
        // fetch), so the overlay picks them up rather than requiring them
        // to be ready first — captions must never gate playback.
        .onChange(of: subtitleCues) { _, cues in
            playback.setSubtitleCues(cues)
        }
        .onDisappear { playback.teardown() }
    }

    @ViewBuilder
    private var subtitleOverlay: some View {
        if let cue = playback.activeCue {
            VStack {
                Spacer()
                Text(cue.text)
                    .font(.system(size: 40, weight: .medium))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 14)
                    // A scrim rather than a stroke: captions sit over
                    // arbitrary footage, and white-on-white is unreadable
                    // exactly when a caption matters most.
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                    .padding(.bottom, 90)
                    .frame(maxWidth: 1400)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .allowsHitTesting(false)
        }
    }
}
