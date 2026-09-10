import AVKit
import UIKit

final class NativePlayerViewController: AVPlayerViewController {
  weak var nativeChrome: NativePlayerChromeView?
  var nativeChromeEnabled = false
  private var consumedPressTypes: Set<UIPress.PressType> = []

  override var preferredFocusEnvironments: [UIFocusEnvironment] {
    if nativeChromeEnabled, let preferred = nativeChrome?.preferredFocusEnvironment {
      return [preferred]
    }
    return super.preferredFocusEnvironments
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    guard nativeChromeEnabled, let nativeChrome else {
      super.pressesBegan(presses, with: event)
      return
    }

    if presses.contains(where: { $0.type == .menu }) {
      super.pressesBegan(presses, with: event)
      return
    }

    if !nativeChrome.controlsVisible {
      nativeChrome.revealControls(preferredFocus: true)
      consume(presses)
      return
    }

    if presses.contains(where: { $0.type == .upArrow }), !nativeChrome.timelineFocused {
      nativeChrome.focusTimeline()
      setNeedsFocusUpdate()
      updateFocusIfNeeded()
      consume(presses)
      return
    }

    if presses.contains(where: { $0.type == .downArrow }), nativeChrome.timelineFocused {
      nativeChrome.focusPrimaryTransport()
      setNeedsFocusUpdate()
      updateFocusIfNeeded()
      consume(presses)
      return
    }

    if nativeChrome.timelineFocused,
       presses.contains(where: { $0.type == .leftArrow }) {
      nativeChrome.adjustTimelineCandidate(by: -10)
      consume(presses)
      return
    }

    if nativeChrome.timelineFocused,
       presses.contains(where: { $0.type == .rightArrow }) {
      nativeChrome.adjustTimelineCandidate(by: 10)
      consume(presses)
      return
    }

    if nativeChrome.timelineFocused,
       presses.contains(where: { $0.type == .select }) {
      nativeChrome.commitTimelineCandidate()
      consume(presses)
      return
    }

    nativeChrome.registerActivity()
    super.pressesBegan(presses, with: event)
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    guard nativeChromeEnabled, presses.contains(where: { consumedPressTypes.contains($0.type) }) else {
      super.pressesEnded(presses, with: event)
      return
    }
    clearConsumed(presses)
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    guard nativeChromeEnabled, presses.contains(where: { consumedPressTypes.contains($0.type) }) else {
      super.pressesCancelled(presses, with: event)
      return
    }
    clearConsumed(presses)
  }

  private func consume(_ presses: Set<UIPress>) {
    consumedPressTypes.formUnion(presses.map(\.type))
  }

  private func clearConsumed(_ presses: Set<UIPress>) {
    for press in presses { consumedPressTypes.remove(press.type) }
  }
}
