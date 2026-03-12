import SwiftUI
import UIKit

/// Embeds an invisible UIView that finds its parent UIScrollView and
/// observes `contentOffset` via KVO. Fires `onChange` on every scroll
/// frame — unlike SwiftUI PreferenceKey which can miss updates.
struct ScrollOffsetObserver: UIViewRepresentable {
  let onChange: @MainActor (CGFloat) -> Void

  func makeUIView(context: Context) -> ScrollOffsetAnchorView {
    let view = ScrollOffsetAnchorView()
    view.isUserInteractionEnabled = false
    return view
  }

  func updateUIView(_ uiView: ScrollOffsetAnchorView, context: Context) {
    uiView.onOffsetChange = { offset in
      Task { @MainActor in onChange(offset) }
    }
    uiView.attachToScrollViewIfNeeded()
  }

  static func dismantleUIView(_ uiView: ScrollOffsetAnchorView, coordinator: ()) {
    uiView.observation = nil
  }
}

/// Anchor view that walks up the responder chain to find the hosting
/// UIScrollView and observes its `contentOffset.y` via KVO.
final class ScrollOffsetAnchorView: UIView {
  var onOffsetChange: ((CGFloat) -> Void)?
  var observation: NSKeyValueObservation?

  func attachToScrollViewIfNeeded() {
    guard observation == nil else { return }
    guard let scrollView = findScrollView() else {
      DispatchQueue.main.async { [weak self] in
        self?.attachToScrollViewIfNeeded()
      }
      return
    }
    observation = scrollView.observe(
      \.contentOffset, options: [.new]
    ) { [weak self] _, change in
      guard let offsetY = change.newValue?.y else { return }
      self?.onOffsetChange?(offsetY)
    }
  }

  private func findScrollView() -> UIScrollView? {
    var current: UIView? = superview
    while let view = current {
      if let scrollView = view as? UIScrollView { return scrollView }
      current = view.superview
    }
    return nil
  }
}
