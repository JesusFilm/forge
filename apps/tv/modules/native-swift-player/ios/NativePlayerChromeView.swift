import UIKit

private extension UIColor {
  static let playerRed = UIColor(red: 0.88, green: 0.11, blue: 0.09, alpha: 1)
  static let playerTrack = UIColor(white: 0.48, alpha: 0.62)
}

private final class NativeChromeButton: UIButton {
  var onFocus: (() -> Void)?
  var onMenu: (() -> Bool)?
  private var consumesMenuRelease = false

  init(
    symbol: String,
    title: String? = nil,
    accessibilityLabel: String,
    prominent: Bool = false
  ) {
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    self.accessibilityLabel = accessibilityLabel

    var config: UIButton.Configuration
    if #available(tvOS 26.0, *) {
      config = prominent ? .prominentGlass() : .glass()
    } else {
      config = prominent ? .filled() : .gray()
    }
    config.image = UIImage(systemName: symbol)
    config.title = title
    config.imagePadding = title == nil ? 0 : 12
    config.baseForegroundColor = .white
    config.baseBackgroundColor = prominent ? .playerRed : UIColor(white: 0.12, alpha: 0.78)
    config.buttonSize = .large
    config.cornerStyle = .capsule
    config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(
      pointSize: prominent ? 32 : 27,
      weight: .semibold
    )
    config.contentInsets = NSDirectionalEdgeInsets(
      top: title == nil ? 16 : 14,
      leading: title == nil ? 20 : 24,
      bottom: title == nil ? 16 : 14,
      trailing: title == nil ? 20 : 24
    )
    configuration = config
    titleLabel?.font = .systemFont(ofSize: 26, weight: .semibold)
    tintColor = prominent ? .playerRed : .white
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func didUpdateFocus(
    in context: UIFocusUpdateContext,
    with coordinator: UIFocusAnimationCoordinator
  ) {
    super.didUpdateFocus(in: context, with: coordinator)
    if isFocused { onFocus?() }
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if presses.contains(where: { $0.type == .menu }), onMenu?() == true {
      consumesMenuRelease = true
      return
    }
    super.pressesBegan(presses, with: event)
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if consumesMenuRelease, presses.contains(where: { $0.type == .menu }) {
      consumesMenuRelease = false
      return
    }
    super.pressesEnded(presses, with: event)
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if consumesMenuRelease, presses.contains(where: { $0.type == .menu }) {
      consumesMenuRelease = false
      return
    }
    super.pressesCancelled(presses, with: event)
  }
}

private final class NativeChromeShadeView: UIView {
  override class var layerClass: AnyClass { CAGradientLayer.self }

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    let gradient = layer as? CAGradientLayer
    gradient?.colors = [
      UIColor.black.withAlphaComponent(0.48).cgColor,
      UIColor.clear.cgColor,
      UIColor.clear.cgColor,
      UIColor.black.withAlphaComponent(0.88).cgColor
    ]
    gradient?.locations = [0, 0.22, 0.48, 1]
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}

private final class NativeFocusCatcher: UIControl {
  var focusEnabled = false {
    didSet {
      isUserInteractionEnabled = focusEnabled
      accessibilityElementsHidden = !focusEnabled
    }
  }
  var onReveal: (() -> Void)?

  override var canBecomeFocused: Bool { focusEnabled }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if presses.contains(where: { $0.type == .menu }) {
      super.pressesBegan(presses, with: event)
      return
    }
    onReveal?()
  }
}

private final class NativeTimelineControl: UIControl {
  var onScrubBegan: ((Double) -> Void)?
  var onCandidateChanged: ((Double) -> UIImage?)?
  var onCommit: ((Double) -> Void)?
  var onCancel: (() -> Void)?
  var onActivity: (() -> Void)?

  private let trackView = UIView()
  private let committedFillView = UIView()
  private let thumbView = UIView()
  private let previewView = UIVisualEffectView(effect: UIBlurEffect(style: .dark))
  private let previewImageView = UIImageView()
  private let previewTimeLabel = UILabel()
  private let elapsedLabel = UILabel()
  private let remainingLabel = UILabel()
  private lazy var cancelTapRecognizer: UITapGestureRecognizer = {
    let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleMenuTap))
    recognizer.allowedPressTypes = [NSNumber(value: UIPress.PressType.menu.rawValue)]
    recognizer.cancelsTouchesInView = true
    return recognizer
  }()
  private var committedTime: Double = 0
  private var duration: Double = 0
  private var scrubOriginTime: Double = 0
  private(set) var candidateTime: Double?
  private var consumesMenuRelease = false
  var navigationActive = false {
    didSet {
      guard navigationActive != oldValue else { return }
      updateTimelineAppearance(animated: true)
    }
  }

  var isScrubbing: Bool { candidateTime != nil }

  override var canBecomeFocused: Bool { isEnabled }

  override init(frame: CGRect) {
    super.init(frame: frame)
    isAccessibilityElement = true
    accessibilityIdentifier = "NativeScrubTimeline"
    accessibilityLabel = "Playback position"
    accessibilityTraits = [.adjustable]

    trackView.backgroundColor = .playerTrack
    trackView.layer.cornerRadius = 4
    trackView.clipsToBounds = true
    addSubview(trackView)

    committedFillView.backgroundColor = .playerRed
    trackView.addSubview(committedFillView)

    thumbView.backgroundColor = .white
    thumbView.layer.cornerRadius = 11
    thumbView.layer.shadowColor = UIColor.black.cgColor
    thumbView.layer.shadowOpacity = 0.45
    thumbView.layer.shadowRadius = 7
    addSubview(thumbView)

    previewView.layer.cornerRadius = 14
    previewView.clipsToBounds = true
    previewView.isHidden = true
    previewView.layer.borderWidth = 1
    previewView.layer.borderColor = UIColor.white.withAlphaComponent(0.18).cgColor
    previewView.layer.shadowColor = UIColor.black.cgColor
    previewView.layer.shadowOpacity = 0.5
    previewView.layer.shadowRadius = 18
    previewView.layer.shadowOffset = CGSize(width: 0, height: 10)
    addSubview(previewView)

    previewImageView.contentMode = .scaleAspectFill
    previewImageView.clipsToBounds = true
    previewView.contentView.addSubview(previewImageView)

    previewTimeLabel.textAlignment = .center
    previewTimeLabel.textColor = .white
    previewTimeLabel.font = .monospacedDigitSystemFont(ofSize: 24, weight: .semibold)
    previewView.contentView.addSubview(previewTimeLabel)

    for label in [elapsedLabel, remainingLabel] {
      label.textColor = UIColor.white.withAlphaComponent(0.92)
      label.font = .monospacedDigitSystemFont(ofSize: 22, weight: .medium)
      addSubview(label)
    }
    remainingLabel.textAlignment = .right

    addGestureRecognizer(cancelTapRecognizer)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let trackRect = CGRect(x: 0, y: bounds.height - 54, width: bounds.width, height: 8)
    trackView.frame = trackRect

    let committedFraction = fraction(for: committedTime)
    committedFillView.frame = CGRect(
      x: 0,
      y: 0,
      width: trackRect.width * committedFraction,
      height: trackRect.height
    )

    let thumbFraction = fraction(for: candidateTime ?? committedTime)
    let thumbSize = isFocused || navigationActive || isScrubbing ? CGFloat(22) : CGFloat(16)
    thumbView.layer.cornerRadius = thumbSize / 2
    thumbView.frame = CGRect(
      x: trackRect.minX + trackRect.width * thumbFraction - thumbSize / 2,
      y: trackRect.midY - thumbSize / 2,
      width: thumbSize,
      height: thumbSize
    )

    elapsedLabel.frame = CGRect(x: 0, y: trackRect.maxY + 10, width: 260, height: 30)
    remainingLabel.frame = CGRect(
      x: bounds.width - 260,
      y: trackRect.maxY + 10,
      width: 260,
      height: 30
    )

    let previewSize = CGSize(width: 320, height: 216)
    let desiredX = trackRect.minX + trackRect.width * thumbFraction - previewSize.width / 2
    let previewX = min(bounds.width - previewSize.width, max(0, desiredX))
    previewView.frame = CGRect(
      x: previewX,
      y: trackRect.minY - previewSize.height - 12,
      width: previewSize.width,
      height: previewSize.height
    )
    previewImageView.frame = CGRect(x: 0, y: 0, width: previewSize.width, height: 180)
    previewTimeLabel.frame = CGRect(x: 12, y: 181, width: previewSize.width - 24, height: 31)
  }

  override func shouldUpdateFocus(in context: UIFocusUpdateContext) -> Bool {
    if isFocused && (context.focusHeading.contains(.left) || context.focusHeading.contains(.right)) {
      return false
    }
    return super.shouldUpdateFocus(in: context)
  }

  override func didUpdateFocus(
    in context: UIFocusUpdateContext,
    with coordinator: UIFocusAnimationCoordinator
  ) {
    super.didUpdateFocus(in: context, with: coordinator)
    if isFocused { onActivity?() }
    coordinator.addCoordinatedAnimations { [weak self] in
      self?.updateTimelineAppearance(animated: false)
    }
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if presses.contains(where: { $0.type == .menu }), cancelScrubbing() {
      consumesMenuRelease = true
      return
    }
    if presses.contains(where: { $0.type == .leftArrow }) {
      adjustCandidate(by: -10)
      return
    }
    if presses.contains(where: { $0.type == .rightArrow }) {
      adjustCandidate(by: 10)
      return
    }
    super.pressesBegan(presses, with: event)
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if consumesMenuRelease, presses.contains(where: { $0.type == .menu }) {
      consumesMenuRelease = false
      return
    }
    if presses.contains(where: { $0.type == .select }), commitScrubbing() {
      return
    }
    super.pressesEnded(presses, with: event)
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if consumesMenuRelease, presses.contains(where: { $0.type == .menu }) {
      consumesMenuRelease = false
      return
    }
    super.pressesCancelled(presses, with: event)
  }

  override func accessibilityIncrement() {
    adjustCandidate(by: 10)
  }

  override func accessibilityDecrement() {
    adjustCandidate(by: -10)
  }

  func updateCommitted(position: Double, duration: Double) {
    guard position.isFinite, duration.isFinite else { return }
    self.duration = max(0, duration)
    if !isScrubbing { committedTime = min(self.duration, max(0, position)) }
    elapsedLabel.text = Self.formatTime(candidateTime ?? committedTime)
    remainingLabel.text = "−" + Self.formatTime(max(0, self.duration - (candidateTime ?? committedTime)))
    accessibilityValue = "\(Self.formatTime(candidateTime ?? committedTime)) of \(Self.formatTime(self.duration))"
    setNeedsLayout()
  }

  @discardableResult
  func cancelScrubbing() -> Bool {
    guard isScrubbing else { return false }
    onCancel?()
    clearCandidate()
    onActivity?()
    return true
  }

  func reset() {
    candidateTime = nil
    committedTime = 0
    duration = 0
    previewImageView.image = nil
    previewView.isHidden = true
    updateCommitted(position: 0, duration: 0)
  }

  func handlePan(_ gesture: UIPanGestureRecognizer) {
    guard (isFocused || navigationActive), duration > 0 else { return }
    onActivity?()
    if gesture.state == .cancelled || gesture.state == .failed {
      cancelScrubbing()
      return
    }
    if gesture.state == .began {
      beginCandidate()
      scrubOriginTime = candidateTime ?? committedTime
    }
    guard candidateTime != nil else { return }
    if gesture.state == .began || gesture.state == .changed || gesture.state == .ended {
      let trackWidth = max(1, bounds.width)
      let delta = Double(gesture.translation(in: self).x / trackWidth) * duration
      updateCandidate(scrubOriginTime + delta)
    }
  }

  @objc private func handleMenuTap() {
    cancelScrubbing()
  }

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard gestureRecognizer === cancelTapRecognizer else { return true }
    return isScrubbing
  }

  func adjustCandidate(by delta: Double) {
    guard duration > 0 else { return }
    beginCandidate()
    updateCandidate((candidateTime ?? committedTime) + delta)
  }

  @discardableResult
  func commitScrubbing() -> Bool {
    guard let candidateTime else { return false }
    onActivity?()
    onCommit?(candidateTime)
    clearCandidate()
    return true
  }

  private func beginCandidate() {
    guard candidateTime == nil else { return }
    scrubOriginTime = committedTime
    candidateTime = committedTime
    onScrubBegan?(committedTime)
    updateCandidate(committedTime)
  }

  private func updateCandidate(_ rawTime: Double) {
    let candidate = min(duration, max(0, rawTime))
    candidateTime = candidate
    previewImageView.image = onCandidateChanged?(candidate)
    previewTimeLabel.text = Self.formatTime(candidate)
    let revealPreview = previewView.isHidden
    previewView.isHidden = false
    if revealPreview {
      previewView.alpha = 0
      previewView.transform = CGAffineTransform(scaleX: 0.92, y: 0.92)
      UIView.animate(
        withDuration: 0.22,
        delay: 0,
        usingSpringWithDamping: 0.86,
        initialSpringVelocity: 0.2
      ) {
        self.previewView.alpha = 1
        self.previewView.transform = .identity
      }
    }
    elapsedLabel.text = Self.formatTime(candidate)
    remainingLabel.text = "−" + Self.formatTime(max(0, duration - candidate))
    accessibilityValue = "Preview \(Self.formatTime(candidate)) of \(Self.formatTime(duration))"
    setNeedsLayout()
  }

  private func clearCandidate() {
    candidateTime = nil
    previewImageView.image = nil
    previewView.isHidden = true
    previewView.alpha = 1
    previewView.transform = .identity
    updateCommitted(position: committedTime, duration: duration)
  }

  private func updateTimelineAppearance(animated: Bool) {
    let changes = {
      let active = self.isFocused || self.navigationActive
      self.trackView.transform = active
        ? CGAffineTransform(scaleX: 1, y: 1.75)
        : .identity
      self.setNeedsLayout()
      self.layoutIfNeeded()
    }
    if animated {
      UIView.animate(
        withDuration: 0.18,
        delay: 0,
        options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseOut],
        animations: changes
      )
    } else {
      changes()
    }
  }

  private func fraction(for time: Double) -> CGFloat {
    guard duration > 0 else { return 0 }
    return CGFloat(min(1, max(0, time / duration)))
  }

  private static func formatTime(_ rawSeconds: Double) -> String {
    let total = max(0, Int(rawSeconds.rounded(.down)))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let seconds = total % 60
    if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, seconds) }
    return String(format: "%d:%02d", minutes, seconds)
  }
}

final class NativePlayerChromeView: UIView {
  var onBack: (() -> Void)?
  var onPlayPause: (() -> Void)?
  var onSkip: ((Double) -> Void)?
  var onStartOver: (() -> Void)?
  var onExplore: (() -> Void)?
  var onAudio: (() -> Void)?
  var onSubtitles: (() -> Void)?
  var onScrubBegan: ((Double) -> Void)?
  var onCandidateChanged: ((Double) -> UIImage?)?
  var onScrubCommit: ((Double) -> Void)?
  var onScrubCancel: (() -> Void)?
  var onChromeVisibilityChanged: ((Bool) -> Void)?

  private let shadeView = NativeChromeShadeView()
  private let focusCatcher = NativeFocusCatcher()
  private let topChrome = UIView()
  private let backButton = NativeChromeButton(
    symbol: "chevron.backward",
    title: "Back",
    accessibilityLabel: "Back"
  )
  private let titleLabel = UILabel()
  private let bottomChrome = UIView()
  private let timeline = NativeTimelineControl()
  private let rewindButton = NativeChromeButton(
    symbol: "gobackward.10",
    accessibilityLabel: "Skip back 10 seconds"
  )
  private let playPauseButton = NativeChromeButton(
    symbol: "pause.fill",
    accessibilityLabel: "Pause",
    prominent: true
  )
  private let forwardButton = NativeChromeButton(
    symbol: "goforward.10",
    accessibilityLabel: "Skip forward 10 seconds"
  )
  private let startOverButton = NativeChromeButton(
    symbol: "arrow.counterclockwise",
    title: "Start Over",
    accessibilityLabel: "Start Over"
  )
  private let exploreButton = NativeChromeButton(
    symbol: "book",
    title: "Explore",
    accessibilityLabel: "Explore"
  )
  private let audioButton = NativeChromeButton(
    symbol: "globe",
    title: "Audio",
    accessibilityLabel: "Audio language"
  )
  private let subtitleButton = NativeChromeButton(
    symbol: "captions.bubble",
    title: "Subtitles",
    accessibilityLabel: "Subtitles"
  )
  private let loadingIndicator = UIActivityIndicatorView(style: .large)
  private var hideTimer: Timer?
  private var paused = false
  private weak var lastFocusedControl: UIView?
  private(set) var controlsVisible = true
  private(set) var timelineNavigationActive = false

  var preferredFocusEnvironment: UIFocusEnvironment? {
    controlsVisible ? (lastFocusedControl ?? playPauseButton) : focusCatcher
  }

  var timelineFocused: Bool { timeline.isFocused || timelineNavigationActive }

  override init(frame: CGRect) {
    super.init(frame: frame)
    translatesAutoresizingMaskIntoConstraints = false
    backgroundColor = .clear

    shadeView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(shadeView)

    focusCatcher.translatesAutoresizingMaskIntoConstraints = false
    focusCatcher.alpha = 0.01
    focusCatcher.onReveal = { [weak self] in self?.revealControls(preferredFocus: true) }
    addSubview(focusCatcher)

    topChrome.translatesAutoresizingMaskIntoConstraints = false
    addSubview(topChrome)
    topChrome.addSubview(backButton)

    titleLabel.translatesAutoresizingMaskIntoConstraints = false
    titleLabel.textColor = .white
    titleLabel.font = .systemFont(ofSize: 32, weight: .semibold)
    titleLabel.numberOfLines = 1
    topChrome.addSubview(titleLabel)

    bottomChrome.translatesAutoresizingMaskIntoConstraints = false
    bottomChrome.clipsToBounds = false
    addSubview(bottomChrome)

    timeline.translatesAutoresizingMaskIntoConstraints = false
    bottomChrome.addSubview(timeline)

    let transportRow = UIStackView(arrangedSubviews: [
      rewindButton,
      playPauseButton,
      forwardButton
    ])
    transportRow.translatesAutoresizingMaskIntoConstraints = false
    transportRow.axis = .horizontal
    transportRow.alignment = .center
    transportRow.distribution = .equalSpacing
    transportRow.spacing = 18
    bottomChrome.addSubview(transportRow)
    bottomChrome.addSubview(startOverButton)

    let actionRow = UIStackView(arrangedSubviews: [
      exploreButton,
      audioButton,
      subtitleButton
    ])
    actionRow.translatesAutoresizingMaskIntoConstraints = false
    actionRow.axis = .horizontal
    actionRow.alignment = .center
    actionRow.distribution = .equalSpacing
    actionRow.spacing = 14
    bottomChrome.addSubview(actionRow)

    let timelineFocusGuide = UIFocusGuide()
    timelineFocusGuide.preferredFocusEnvironments = [timeline]
    bottomChrome.addLayoutGuide(timelineFocusGuide)

    let scrubPan = UIPanGestureRecognizer(target: self, action: #selector(handleScrubPan(_:)))
    scrubPan.cancelsTouchesInView = false
    addGestureRecognizer(scrubPan)

    loadingIndicator.translatesAutoresizingMaskIntoConstraints = false
    loadingIndicator.color = .white
    loadingIndicator.hidesWhenStopped = true
    addSubview(loadingIndicator)

    NSLayoutConstraint.activate([
      shadeView.topAnchor.constraint(equalTo: topAnchor),
      shadeView.leadingAnchor.constraint(equalTo: leadingAnchor),
      shadeView.trailingAnchor.constraint(equalTo: trailingAnchor),
      shadeView.bottomAnchor.constraint(equalTo: bottomAnchor),

      focusCatcher.topAnchor.constraint(equalTo: topAnchor),
      focusCatcher.leadingAnchor.constraint(equalTo: leadingAnchor),
      focusCatcher.trailingAnchor.constraint(equalTo: trailingAnchor),
      focusCatcher.bottomAnchor.constraint(equalTo: bottomAnchor),

      topChrome.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor, constant: 44),
      topChrome.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 64),
      topChrome.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -64),
      topChrome.heightAnchor.constraint(equalToConstant: 80),
      backButton.leadingAnchor.constraint(equalTo: topChrome.leadingAnchor),
      backButton.centerYAnchor.constraint(equalTo: topChrome.centerYAnchor),
      backButton.heightAnchor.constraint(equalToConstant: 68),
      titleLabel.leadingAnchor.constraint(equalTo: backButton.trailingAnchor, constant: 28),
      titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: topChrome.trailingAnchor),
      titleLabel.centerYAnchor.constraint(equalTo: topChrome.centerYAnchor),

      bottomChrome.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 64),
      bottomChrome.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -64),
      bottomChrome.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -38),
      bottomChrome.heightAnchor.constraint(equalToConstant: 340),

      timeline.topAnchor.constraint(equalTo: bottomChrome.topAnchor),
      timeline.leadingAnchor.constraint(equalTo: bottomChrome.leadingAnchor, constant: 24),
      timeline.trailingAnchor.constraint(equalTo: bottomChrome.trailingAnchor, constant: -24),
      timeline.heightAnchor.constraint(equalToConstant: 248),

      transportRow.centerXAnchor.constraint(equalTo: bottomChrome.centerXAnchor),
      transportRow.bottomAnchor.constraint(equalTo: bottomChrome.bottomAnchor),
      transportRow.heightAnchor.constraint(equalToConstant: 76),

      startOverButton.leadingAnchor.constraint(equalTo: bottomChrome.leadingAnchor),
      startOverButton.bottomAnchor.constraint(equalTo: bottomChrome.bottomAnchor, constant: -5),
      startOverButton.heightAnchor.constraint(equalToConstant: 62),

      actionRow.trailingAnchor.constraint(equalTo: bottomChrome.trailingAnchor),
      actionRow.bottomAnchor.constraint(equalTo: bottomChrome.bottomAnchor, constant: -5),
      actionRow.heightAnchor.constraint(equalToConstant: 66),

      timelineFocusGuide.leadingAnchor.constraint(equalTo: transportRow.leadingAnchor),
      timelineFocusGuide.trailingAnchor.constraint(equalTo: transportRow.trailingAnchor),
      timelineFocusGuide.topAnchor.constraint(equalTo: timeline.bottomAnchor),
      timelineFocusGuide.bottomAnchor.constraint(equalTo: transportRow.topAnchor),

      rewindButton.widthAnchor.constraint(equalToConstant: 70),
      rewindButton.heightAnchor.constraint(equalToConstant: 64),
      playPauseButton.widthAnchor.constraint(equalToConstant: 90),
      playPauseButton.heightAnchor.constraint(equalToConstant: 76),
      forwardButton.widthAnchor.constraint(equalToConstant: 70),
      forwardButton.heightAnchor.constraint(equalToConstant: 64),
      exploreButton.heightAnchor.constraint(equalToConstant: 62),
      audioButton.heightAnchor.constraint(equalToConstant: 62),
      subtitleButton.heightAnchor.constraint(equalToConstant: 62),

      loadingIndicator.centerXAnchor.constraint(equalTo: centerXAnchor),
      loadingIndicator.centerYAnchor.constraint(equalTo: centerYAnchor)
    ])

    wireActions()
    setLoading(true)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  deinit {
    hideTimer?.invalidate()
  }

  func setTitle(_ title: String?) {
    titleLabel.text = title
    titleLabel.isHidden = title?.isEmpty != false
  }

  func setLoading(_ loading: Bool) {
    loading ? loadingIndicator.startAnimating() : loadingIndicator.stopAnimating()
  }

  func setActive(_ active: Bool) {
    hideTimer?.invalidate()
    isHidden = !active
    isUserInteractionEnabled = active
    focusCatcher.focusEnabled = false
    if active { revealControls(preferredFocus: false) }
  }

  func setModalPresented(_ presented: Bool) {
    hideTimer?.invalidate()
    if !presented { registerActivity() }
  }

  func setAvailability(hasExplore: Bool, hasAudio: Bool, hasSubtitles: Bool) {
    exploreButton.isEnabled = hasExplore
    exploreButton.alpha = hasExplore ? 1 : 0.42
    audioButton.isEnabled = hasAudio
    audioButton.alpha = hasAudio ? 1 : 0.42
    subtitleButton.isEnabled = hasSubtitles
    subtitleButton.alpha = hasSubtitles ? 1 : 0.42
  }

  func updatePlayback(position: Double, duration: Double, isPaused: Bool) {
    timeline.updateCommitted(position: position, duration: duration)
    setPaused(isPaused)
  }

  func resetForSourceChange() {
    timeline.reset()
    setLoading(true)
    revealControls(preferredFocus: false)
  }

  @discardableResult
  func cancelScrubbing() -> Bool {
    timeline.cancelScrubbing()
  }

  func registerActivity() {
    if !controlsVisible {
      revealControls(preferredFocus: true)
      return
    }
    scheduleAutoHide()
  }

  func focusTimeline() {
    timelineNavigationActive = true
    timeline.navigationActive = true
    lastFocusedControl = timeline
    requestFocus(on: timeline)
    registerActivity()
  }

  func focusPrimaryTransport() {
    timeline.cancelScrubbing()
    timelineNavigationActive = false
    timeline.navigationActive = false
    lastFocusedControl = playPauseButton
    requestFocus(on: playPauseButton)
    registerActivity()
  }

  func adjustTimelineCandidate(by delta: Double) {
    timeline.adjustCandidate(by: delta)
  }

  @discardableResult
  func commitTimelineCandidate() -> Bool {
    timeline.commitScrubbing()
  }

  func revealControls(preferredFocus: Bool) {
    hideTimer?.invalidate()
    controlsVisible = true
    focusCatcher.focusEnabled = false
    sendSubviewToBack(focusCatcher)
    setChromeInteraction(enabled: true)
    onChromeVisibilityChanged?(true)
    shadeView.layer.removeAllAnimations()
    topChrome.layer.removeAllAnimations()
    bottomChrome.layer.removeAllAnimations()
    bottomChrome.transform = CGAffineTransform(translationX: 0, y: 18)
    UIView.animate(
      withDuration: 0.26,
      delay: 0,
      options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseOut]
    ) {
      self.shadeView.alpha = 1
      self.topChrome.alpha = 1
      self.bottomChrome.alpha = 1
      self.bottomChrome.transform = .identity
    }
    if preferredFocus {
      requestFocus(on: lastFocusedControl ?? playPauseButton)
    }
    scheduleAutoHide()
  }

  private func setPaused(_ value: Bool) {
    guard paused != value else { return }
    paused = value
    let symbol = value ? "play.fill" : "pause.fill"
    var config = playPauseButton.configuration
    config?.image = UIImage(systemName: symbol)
    playPauseButton.configuration = config
    playPauseButton.accessibilityLabel = value ? "Play" : "Pause"
    if value {
      revealControls(preferredFocus: false)
      hideTimer?.invalidate()
    } else {
      scheduleAutoHide()
    }
  }

  private func scheduleAutoHide() {
    hideTimer?.invalidate()
    guard !paused, !timeline.isScrubbing, controlsVisible else { return }
    let timer = Timer(timeInterval: 8, repeats: false) { [weak self] _ in
      self?.hideControls()
    }
    hideTimer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  private func hideControls() {
    guard !paused, !timeline.isScrubbing, controlsVisible else { return }
    controlsVisible = false
    setChromeInteraction(enabled: false)
    focusCatcher.focusEnabled = true
    bringSubviewToFront(focusCatcher)
    onChromeVisibilityChanged?(false)
    requestFocus(on: focusCatcher)
    shadeView.layer.removeAllAnimations()
    topChrome.layer.removeAllAnimations()
    bottomChrome.layer.removeAllAnimations()
    UIView.animate(
      withDuration: 0.2,
      delay: 0,
      options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseIn]
    ) {
      self.shadeView.alpha = 0
      self.topChrome.alpha = 0
      self.bottomChrome.alpha = 0
      self.bottomChrome.transform = CGAffineTransform(translationX: 0, y: 16)
    }
  }

  private func setChromeInteraction(enabled: Bool) {
    topChrome.isUserInteractionEnabled = enabled
    bottomChrome.isUserInteractionEnabled = enabled
    topChrome.accessibilityElementsHidden = !enabled
    bottomChrome.accessibilityElementsHidden = !enabled
  }

  private func requestFocus(on view: UIView) {
    DispatchQueue.main.async {
      guard let focusSystem = UIFocusSystem.focusSystem(for: view) else { return }
      focusSystem.requestFocusUpdate(to: view)
      focusSystem.updateFocusIfNeeded()
    }
  }

  private func wireActions() {
    let buttons: [NativeChromeButton] = [
      backButton,
      rewindButton,
      playPauseButton,
      forwardButton,
      startOverButton,
      exploreButton,
      audioButton,
      subtitleButton
    ]
    for button in buttons {
      button.onMenu = { [weak self] in
        guard let self, self.timelineNavigationActive else { return false }
        return self.cancelScrubbing()
      }
      button.onFocus = { [weak self, weak button] in
        guard let self, let button else { return }
        self.timeline.cancelScrubbing()
        self.timelineNavigationActive = false
        self.timeline.navigationActive = false
        self.lastFocusedControl = button
        self.registerActivity()
      }
    }

    timeline.onActivity = { [weak self] in
      guard let self else { return }
      self.lastFocusedControl = self.timeline
      self.registerActivity()
    }
    timeline.onScrubBegan = { [weak self] time in
      self?.hideTimer?.invalidate()
      self?.onScrubBegan?(time)
    }
    timeline.onCandidateChanged = { [weak self] time in self?.onCandidateChanged?(time) }
    timeline.onCommit = { [weak self] time in
      self?.onScrubCommit?(time)
      self?.scheduleAutoHide()
    }
    timeline.onCancel = { [weak self] in
      self?.onScrubCancel?()
      self?.scheduleAutoHide()
    }

    backButton.addAction(UIAction { [weak self] _ in self?.onBack?() }, for: .primaryActionTriggered)
    playPauseButton.addAction(UIAction { [weak self] _ in self?.onPlayPause?() }, for: .primaryActionTriggered)
    rewindButton.addAction(UIAction { [weak self] _ in self?.onSkip?(-10) }, for: .primaryActionTriggered)
    forwardButton.addAction(UIAction { [weak self] _ in self?.onSkip?(10) }, for: .primaryActionTriggered)
    startOverButton.addAction(UIAction { [weak self] _ in self?.onStartOver?() }, for: .primaryActionTriggered)
    exploreButton.addAction(UIAction { [weak self] _ in self?.onExplore?() }, for: .primaryActionTriggered)
    audioButton.addAction(UIAction { [weak self] _ in self?.onAudio?() }, for: .primaryActionTriggered)
    subtitleButton.addAction(UIAction { [weak self] _ in self?.onSubtitles?() }, for: .primaryActionTriggered)
  }

  @objc private func handleScrubPan(_ gesture: UIPanGestureRecognizer) {
    guard controlsVisible, timelineNavigationActive else { return }
    timeline.handlePan(gesture)
  }
}
