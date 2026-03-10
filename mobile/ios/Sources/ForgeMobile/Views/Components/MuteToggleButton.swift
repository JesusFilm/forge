import SwiftUI

struct MuteToggleButton: View {
  @Binding var isMuted: Bool
  let onToggle: (() -> Void)?

  init(isMuted: Binding<Bool>, onToggle: (() -> Void)? = nil) {
    _isMuted = isMuted
    self.onToggle = onToggle
  }

  var body: some View {
    Button {
      isMuted.toggle()
      onToggle?()
    } label: {
      Image(systemName: isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
        .font(.system(size: 20, weight: .medium))
        .foregroundStyle(.white)
        .frame(width: 48, height: 48)
        .background(.black.opacity(0.3))
        .clipShape(Circle())
        .overlay(Circle().stroke(.white.opacity(0.3), lineWidth: 1))
    }
    .accessibilityLabel(isMuted ? "Unmute video" : "Mute video")
  }
}
