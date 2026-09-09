import AVFoundation
import AVKit
import ExpoModulesCore
import UIKit

private struct NativeListRow {
  let id: String
  let title: String
  let detail: String?
  let selected: Bool
  let selectable: Bool
}

private final class NativeOptionsNavigationController: UINavigationController {
  var onClose: (() -> Void)?
  private var didClose = false

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    guard !didClose, presentingViewController == nil else { return }
    didClose = true
    onClose?()
  }
}

private final class NativeOptionsController: UITableViewController, UISearchResultsUpdating {
  private let rows: [NativeListRow]
  private let selectedId: String?
  private let onSelect: (String) -> Void
  private var visibleRows: [NativeListRow]

  init(
    title: String,
    rows: [NativeListRow],
    selectedId: String?,
    onSelect: @escaping (String) -> Void
  ) {
    self.rows = rows
    self.selectedId = selectedId
    self.onSelect = onSelect
    self.visibleRows = rows
    super.init(style: .plain)
    self.title = title
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  private var initialFocusIndexPath: IndexPath? {
    if let selectedId, let index = visibleRows.firstIndex(where: { $0.id == selectedId }) {
      return IndexPath(row: index, section: 0)
    }
    guard let index = visibleRows.firstIndex(where: { $0.selectable }) else { return nil }
    return IndexPath(row: index, section: 0)
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    tableView.backgroundColor = .black
    tableView.remembersLastFocusedIndexPath = true
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "row")
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    focusInitialRow()
  }

  func focusInitialRow() {
    guard let indexPath = initialFocusIndexPath else { return }
    tableView.scrollToRow(at: indexPath, at: .middle, animated: false)
    tableView.layoutIfNeeded()
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.navigationController?.setNeedsFocusUpdate()
      self.navigationController?.updateFocusIfNeeded()
      self.tableView.setNeedsFocusUpdate()
      self.tableView.updateFocusIfNeeded()
      guard let cell = self.tableView.cellForRow(at: indexPath),
            let focusSystem = UIFocusSystem.focusSystem(for: cell) else { return }
      focusSystem.requestFocusUpdate(to: cell)
      focusSystem.updateFocusIfNeeded()
    }
  }

  override var preferredFocusEnvironments: [UIFocusEnvironment] {
    guard let indexPath = initialFocusIndexPath,
          let cell = tableView.cellForRow(at: indexPath) else {
      return [tableView]
    }
    return [cell]
  }

  override func indexPathForPreferredFocusedView(in tableView: UITableView) -> IndexPath? {
    initialFocusIndexPath
  }

  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    visibleRows.count
  }

  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let row = visibleRows[indexPath.row]
    let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
    var content = cell.defaultContentConfiguration()
    content.text = row.title
    content.secondaryText = row.detail
    cell.contentConfiguration = content
    cell.accessoryType = row.selected ? .checkmark : .none
    cell.selectionStyle = row.selectable ? .default : .none
    cell.isUserInteractionEnabled = row.selectable
    cell.contentView.alpha = row.selectable ? 1 : 0.72
    return cell
  }

  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    let row = visibleRows[indexPath.row]
    guard row.selectable else { return }
    onSelect(row.id)
    dismiss(animated: true)
  }

  func updateSearchResults(for searchController: UISearchController) {
    let query = searchController.searchBar.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if query.isEmpty {
      visibleRows = rows
    } else {
      visibleRows = rows.filter { row in
        row.title.localizedCaseInsensitiveContains(query) ||
          (row.detail?.localizedCaseInsensitiveContains(query) ?? false) ||
          row.id.localizedCaseInsensitiveContains(query)
      }
    }
    tableView.reloadData()
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if presses.contains(where: { $0.type == .menu }) {
      dismiss(animated: true)
      return
    }
    super.pressesBegan(presses, with: event)
  }
}

public final class NativeSwiftPlayerView: ExpoView, AVPlayerViewControllerDelegate {
  let onDismiss = EventDispatcher()
  let onEnded = EventDispatcher()
  let onPlayNext = EventDispatcher()
  let onPlaybackPosition = EventDispatcher()
  let onError = EventDispatcher()
  let onAudioChange = EventDispatcher()
  let onSubtitleChange = EventDispatcher()

  private let player = AVPlayer()
  private let playerController = NativePlayerViewController()
  private let subtitleLabel = UILabel()
  private let customChromeView = NativePlayerChromeView()
  private let scrubPreviewView = UIView()
  private let scrubPreviewImageView = UIImageView()
  private let scrubPreviewTimeLabel = UILabel()
  private var periodicObserver: Any?
  private var itemStatusObservation: NSKeyValueObservation?
  private var endObserver: NSObjectProtocol?
  private var timeJumpObserver: NSObjectProtocol?
  private var subtitleTask: URLSessionDataTask?
  private var storyboardMetadataTask: URLSessionDataTask?
  private var storyboardImageTask: URLSessionDataTask?
  private var subtitleCues: [NativeSubtitleCue] = []
  private var storyboard: NativeStoryboard?
  private var storyboardImage: UIImage?
  private let storyboardFrameCache = NSCache<NSNumber, UIImage>()
  private var storyboardGeneration = 0
  private var scrubPreviewHideWorkItem: DispatchWorkItem?
  private var scrubPreviewCenterXConstraint: NSLayoutConstraint?
  private var subtitleBottomConstraint: NSLayoutConstraint?
  private var lastObservedPosition: Double?
  private var suppressScrubPreviewUntil: TimeInterval = 0
  private var loadedSourceUrl: String?
  private var pendingSeekSeconds: Double = 0
  private var shouldAutoplay = true
  private var endHandled = false
  private var playbackFailureHandled = false
  private var presentationAttempts = 0
  private var presentationGeneration = 0
  private var dismissalMonitorGeneration = 0
  private var programmaticDismissal = false
  private var userDismissalHandled = false
  private var customScrubWasPlaying = false

  private var usesCustomChrome: Bool { playerVariant == "native-b" }

  var playerVariant = "native-a" {
    didSet {
      guard playerVariant != oldValue else { return }
      configurePlayerVariant()
    }
  }

  var sourceUrl: String? {
    didSet {
      guard sourceUrl != oldValue else { return }
      replaceSource(preservingPosition: loadedSourceUrl != nil)
    }
  }
  var storyboardUrl: String? {
    didSet {
      guard storyboardUrl != oldValue else { return }
      loadStoryboard()
    }
  }
  var videoTitle: String? {
    didSet {
      updateMetadata()
      customChromeView.setTitle(videoTitle)
    }
  }
  var startAtSeconds: Double = 0
  var audioOptions: [NativePlayerOption] = [] {
    didSet {
      updateTransportItems()
      updateCustomChromeAvailability()
    }
  }
  var selectedAudioId: String? {
    didSet { updateTransportItems() }
  }
  var subtitleOptions: [NativePlayerOption] = [] {
    didSet {
      updateTransportItems()
      updateCustomChromeAvailability()
    }
  }
  var selectedSubtitleId: String? {
    didSet { updateTransportItems() }
  }
  var selectedSubtitleUrl: String? {
    didSet {
      guard selectedSubtitleUrl != oldValue else { return }
      loadSubtitles()
    }
  }
  var moments: [NativePlayerMoment] = [] {
    didSet {
      updateTransportItems()
      updateCustomChromeAvailability()
    }
  }
  var questions: [String] = [] {
    didSet {
      updateTransportItems()
      updateCustomChromeAvailability()
    }
  }
  var upNextSlug: String?
  var upNextTitle: String?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black

    playerController.player = player
    playerController.delegate = self
    playerController.nativeChrome = customChromeView
    playerController.showsPlaybackControls = true
    playerController.view.backgroundColor = .black
    playerController.view.isUserInteractionEnabled = true
    playerController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]

    subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
    subtitleLabel.textAlignment = .center
    subtitleLabel.textColor = .white
    subtitleLabel.backgroundColor = UIColor.black.withAlphaComponent(0.72)
    subtitleLabel.font = .systemFont(ofSize: 34, weight: .semibold)
    subtitleLabel.numberOfLines = 3
    subtitleLabel.accessibilityIdentifier = "NativeSubtitleText"
    subtitleLabel.layer.cornerRadius = 8
    subtitleLabel.layer.masksToBounds = true
    subtitleLabel.isHidden = true
    playerController.contentOverlayView?.addSubview(subtitleLabel)
    if let overlay = playerController.contentOverlayView {
      let bottom = subtitleLabel.bottomAnchor.constraint(
        equalTo: overlay.safeAreaLayoutGuide.bottomAnchor,
        constant: -70
      )
      subtitleBottomConstraint = bottom
      NSLayoutConstraint.activate([
        subtitleLabel.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
        bottom,
        subtitleLabel.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 120),
        subtitleLabel.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -120)
      ])
    }

    scrubPreviewView.translatesAutoresizingMaskIntoConstraints = false
    scrubPreviewView.backgroundColor = UIColor.black.withAlphaComponent(0.88)
    scrubPreviewView.layer.cornerRadius = 14
    scrubPreviewView.layer.masksToBounds = true
    scrubPreviewView.isHidden = true
    scrubPreviewView.isAccessibilityElement = true
    scrubPreviewView.accessibilityIdentifier = "NativeScrubPreview"

    scrubPreviewImageView.translatesAutoresizingMaskIntoConstraints = false
    scrubPreviewImageView.contentMode = .scaleAspectFill
    scrubPreviewImageView.clipsToBounds = true
    scrubPreviewView.addSubview(scrubPreviewImageView)

    scrubPreviewTimeLabel.translatesAutoresizingMaskIntoConstraints = false
    scrubPreviewTimeLabel.textAlignment = .center
    scrubPreviewTimeLabel.textColor = .white
    scrubPreviewTimeLabel.font = .monospacedDigitSystemFont(ofSize: 24, weight: .semibold)
    scrubPreviewView.addSubview(scrubPreviewTimeLabel)

    playerController.contentOverlayView?.addSubview(scrubPreviewView)
    if let overlay = playerController.contentOverlayView {
      let centerX = scrubPreviewView.centerXAnchor.constraint(equalTo: overlay.centerXAnchor)
      scrubPreviewCenterXConstraint = centerX
      NSLayoutConstraint.activate([
        centerX,
        scrubPreviewView.bottomAnchor.constraint(equalTo: overlay.bottomAnchor, constant: -190),
        scrubPreviewView.widthAnchor.constraint(equalToConstant: 360),
        scrubPreviewView.heightAnchor.constraint(equalToConstant: 242),
        scrubPreviewImageView.topAnchor.constraint(equalTo: scrubPreviewView.topAnchor),
        scrubPreviewImageView.leadingAnchor.constraint(equalTo: scrubPreviewView.leadingAnchor),
        scrubPreviewImageView.trailingAnchor.constraint(equalTo: scrubPreviewView.trailingAnchor),
        scrubPreviewImageView.heightAnchor.constraint(equalToConstant: 203),
        scrubPreviewTimeLabel.leadingAnchor.constraint(equalTo: scrubPreviewView.leadingAnchor, constant: 12),
        scrubPreviewTimeLabel.trailingAnchor.constraint(equalTo: scrubPreviewView.trailingAnchor, constant: -12),
        scrubPreviewTimeLabel.bottomAnchor.constraint(equalTo: scrubPreviewView.bottomAnchor, constant: -6)
      ])
    }

    customChromeView.isHidden = true
    customChromeView.isUserInteractionEnabled = false
    playerController.contentOverlayView?.addSubview(customChromeView)
    if let overlay = playerController.contentOverlayView {
      NSLayoutConstraint.activate([
        customChromeView.topAnchor.constraint(equalTo: overlay.topAnchor),
        customChromeView.leadingAnchor.constraint(equalTo: overlay.leadingAnchor),
        customChromeView.trailingAnchor.constraint(equalTo: overlay.trailingAnchor),
        customChromeView.bottomAnchor.constraint(equalTo: overlay.bottomAnchor)
      ])
    }
    wireCustomChrome()

    periodicObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
      queue: .main
    ) { [weak self] time in
      self?.handleTimeUpdate(time.seconds)
    }
  }

  deinit {
    if let periodicObserver { player.removeTimeObserver(periodicObserver) }
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    if let timeJumpObserver { NotificationCenter.default.removeObserver(timeJumpObserver) }
    itemStatusObservation?.invalidate()
    subtitleTask?.cancel()
    storyboardMetadataTask?.cancel()
    storyboardImageTask?.cancel()
    scrubPreviewHideWorkItem?.cancel()
  }

  public override var bounds: CGRect {
    didSet { playerController.view.frame = bounds }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    NSLog("[NativeSwiftPlayer] didMoveToWindow attached=%@", window == nil ? "false" : "true")
    if window != nil {
      presentationGeneration += 1
      playerController.view.frame = bounds
      if loadedSourceUrl == nil { replaceSource(preservingPosition: false) }
      presentPlayerController()
    } else {
      presentationGeneration += 1
    }
  }

  public override func removeFromSuperview() {
    presentationGeneration += 1
    dismissalMonitorGeneration += 1
    player.pause()
    storyboardMetadataTask?.cancel()
    storyboardImageTask?.cancel()
    scrubPreviewHideWorkItem?.cancel()
    if playerController.presentingViewController != nil {
      programmaticDismissal = true
      playerController.dismiss(animated: false)
    }
    super.removeFromSuperview()
  }

  private func presentPlayerController() {
    guard window != nil, playerController.presentingViewController == nil else { return }
    guard let host = reactViewController() else {
      NSLog("[NativeSwiftPlayer] waiting for React host attempt=%d", presentationAttempts + 1)
      retryPlayerPresentation()
      return
    }

    let presenter = topViewController(from: host)
    guard presenter !== playerController else { return }
    guard presenter.viewIfLoaded?.window != nil,
          !presenter.isBeingDismissed,
          !presenter.isBeingPresented else {
      NSLog("[NativeSwiftPlayer] waiting for presenter %@ attempt=%d", String(describing: type(of: presenter)), presentationAttempts + 1)
      retryPlayerPresentation()
      return
    }

    NSLog("[NativeSwiftPlayer] presenting AVPlayerViewController from %@", String(describing: type(of: presenter)))
    presentationAttempts = 0
    playerController.modalPresentationStyle = .fullScreen
    playerController.view.removeFromSuperview()
    presenter.present(playerController, animated: true) { [weak self] in
      guard let self else { return }
      NSLog("[NativeSwiftPlayer] AVPlayerViewController presentation completed")
      self.playerController.showsPlaybackControls = !self.usesCustomChrome
      if self.usesCustomChrome {
        self.customChromeView.revealControls(preferredFocus: true)
      }
      self.playerController.view.setNeedsFocusUpdate()
      self.playerController.view.updateFocusIfNeeded()
      self.playerController.setNeedsFocusUpdate()
      self.playerController.updateFocusIfNeeded()
      self.startDismissalMonitor()
    }
  }

  private func retryPlayerPresentation() {
    guard presentationAttempts < 60 else {
      onError(["message": "Native player could not acquire the full-screen focus environment"])
      onDismiss()
      return
    }
    presentationAttempts += 1
    let generation = presentationGeneration
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
      guard let self, self.presentationGeneration == generation else { return }
      self.presentPlayerController()
    }
  }

  private func topViewController(from root: UIViewController) -> UIViewController {
    if let presented = root.presentedViewController, !presented.isBeingDismissed {
      return topViewController(from: presented)
    }
    if let navigation = root as? UINavigationController,
       let visible = navigation.visibleViewController {
      return topViewController(from: visible)
    }
    if let tab = root as? UITabBarController,
       let selected = tab.selectedViewController {
      return topViewController(from: selected)
    }
    return root
  }

  private func configurePlayerVariant() {
    let custom = usesCustomChrome
    playerController.nativeChromeEnabled = custom
    playerController.showsPlaybackControls = !custom
    customChromeView.setActive(custom)
    scrubPreviewView.isHidden = true
    updateTransportItems()
    updateSubtitleBottom(controlsVisible: custom)
    if custom, playerController.presentingViewController != nil {
      customChromeView.revealControls(preferredFocus: true)
    }
  }

  private func wireCustomChrome() {
    customChromeView.onBack = { [weak self] in
      self?.dismissFromCustomChrome()
    }
    customChromeView.onPlayPause = { [weak self] in
      guard let self else { return }
      if self.player.rate == 0 {
        self.player.play()
      } else {
        self.player.pause()
      }
      self.refreshCustomChromePlaybackState()
    }
    customChromeView.onSkip = { [weak self] delta in
      guard let self else { return }
      let duration = self.currentDuration
      let current = self.player.currentTime().seconds
      guard current.isFinite else { return }
      let target = min(duration, max(0, current + delta))
      self.player.seek(
        to: CMTime(seconds: target, preferredTimescale: 600),
        toleranceBefore: .zero,
        toleranceAfter: .zero
      )
    }
    customChromeView.onStartOver = { [weak self] in
      guard let self else { return }
      self.player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
      self.player.play()
    }
    customChromeView.onExplore = { [weak self] in self?.presentExplore() }
    customChromeView.onAudio = { [weak self] in self?.presentLanguages() }
    customChromeView.onSubtitles = { [weak self] in self?.presentSubtitles() }
    customChromeView.onScrubBegan = { [weak self] _ in
      guard let self else { return }
      self.customScrubWasPlaying = self.player.rate > 0
      self.player.pause()
      self.refreshCustomChromePlaybackState()
    }
    customChromeView.onCandidateChanged = { [weak self] time in
      self?.storyboardFrame(at: time)
    }
    customChromeView.onScrubCommit = { [weak self] time in
      self?.commitCustomScrub(at: time)
    }
    customChromeView.onScrubCancel = { [weak self] in
      guard let self else { return }
      if self.customScrubWasPlaying { self.player.play() }
      self.customScrubWasPlaying = false
      self.refreshCustomChromePlaybackState()
    }
    customChromeView.onChromeVisibilityChanged = { [weak self] visible in
      self?.updateSubtitleBottom(controlsVisible: visible)
    }
  }

  private var currentDuration: Double {
    let raw = player.currentItem?.duration.seconds ?? 0
    return raw.isFinite && raw > 0 ? raw : 0
  }

  private func refreshCustomChromePlaybackState() {
    let position = player.currentTime().seconds
    customChromeView.updatePlayback(
      position: position.isFinite ? position : 0,
      duration: currentDuration,
      isPaused: player.rate == 0
    )
  }

  private func commitCustomScrub(at time: Double) {
    let resumePlayback = customScrubWasPlaying
    customScrubWasPlaying = false
    player.seek(
      to: CMTime(seconds: time, preferredTimescale: 600),
      toleranceBefore: .zero,
      toleranceAfter: .zero
    ) { [weak self] _ in
      guard let self else { return }
      if resumePlayback { self.player.play() }
      self.refreshCustomChromePlaybackState()
    }
  }

  private func dismissFromCustomChrome() {
    guard !userDismissalHandled else { return }
    player.pause()
    programmaticDismissal = true
    playerController.dismiss(animated: true) { [weak self] in
      guard let self else { return }
      self.programmaticDismissal = false
      self.completeUserDismissal()
    }
  }

  private func updateCustomChromeAvailability() {
    customChromeView.setAvailability(
      hasExplore: !moments.isEmpty || !questions.isEmpty,
      hasAudio: !audioOptions.isEmpty,
      hasSubtitles: !subtitleOptions.isEmpty
    )
  }

  private func updateSubtitleBottom(controlsVisible: Bool) {
    guard usesCustomChrome else {
      subtitleBottomConstraint?.constant = -70
      return
    }
    subtitleBottomConstraint?.constant = controlsVisible ? -445 : -70
    playerController.contentOverlayView?.layoutIfNeeded()
  }

  private func replaceSource(preservingPosition: Bool) {
    guard let sourceUrl, let url = URL(string: sourceUrl), url.scheme == "https" else { return }
    NSLog("[NativeSwiftPlayer] loading source host=%@", url.host ?? "unknown")
    hideScrubPreview()
    if usesCustomChrome { customChromeView.resetForSourceChange() }
    lastObservedPosition = nil
    let current = player.currentTime().seconds
    pendingSeekSeconds = preservingPosition && current.isFinite ? current : startAtSeconds
    shouldAutoplay = player.rate > 0 || loadedSourceUrl == nil
    loadedSourceUrl = sourceUrl
    endHandled = false
    playbackFailureHandled = false

    itemStatusObservation?.invalidate()
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    if let timeJumpObserver { NotificationCenter.default.removeObserver(timeJumpObserver) }

    let item = AVPlayerItem(url: url)
    suppressScrubPreview()
    player.replaceCurrentItem(with: item)
    updateMetadata()
    itemStatusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
      DispatchQueue.main.async {
        self?.handleItemStatus(item)
      }
    }
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: item,
      queue: .main
    ) { [weak self] _ in
      self?.handleEnded()
    }
    timeJumpObserver = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.timeJumpedNotification,
      object: item,
      queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      guard Date.timeIntervalSinceReferenceDate >= self.suppressScrubPreviewUntil else { return }
      let position = self.player.currentTime().seconds
      guard position.isFinite else { return }
      self.showScrubPreview(at: position)
    }
  }

  private func handleItemStatus(_ item: AVPlayerItem) {
    switch item.status {
    case .readyToPlay:
      NSLog("[NativeSwiftPlayer] item ready")
      let target = CMTime(seconds: max(0, pendingSeekSeconds), preferredTimescale: 600)
      suppressScrubPreview()
      player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
        guard let self else { return }
        if self.shouldAutoplay { self.player.play() }
        DispatchQueue.main.async {
          self.customChromeView.setLoading(false)
          self.playerController.showsPlaybackControls = !self.usesCustomChrome
          if self.usesCustomChrome {
            self.customChromeView.revealControls(preferredFocus: true)
          }
          self.playerController.view.setNeedsFocusUpdate()
          self.playerController.view.updateFocusIfNeeded()
          self.playerController.setNeedsFocusUpdate()
          self.playerController.updateFocusIfNeeded()
        }
      }
    case .failed:
      handlePlaybackFailure(item.error?.localizedDescription ?? "The video could not be loaded.")
    default:
      break
    }
  }

  private func handlePlaybackFailure(_ message: String) {
    guard !playbackFailureHandled else { return }
    playbackFailureHandled = true
    player.pause()
    NSLog("[NativeSwiftPlayer] item failed: %@", message)
    onError(["message": message])

    guard playerController.presentingViewController != nil,
          playerController.presentedViewController == nil else {
      dismissAfterPlaybackFailure()
      return
    }

    let alert = UIAlertController(
      title: "Playback failed",
      message: message,
      preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "Try Again", style: .default) { [weak self] _ in
      self?.replaceSource(preservingPosition: true)
    })
    alert.addAction(UIAlertAction(title: "Back", style: .cancel) { [weak self] _ in
      self?.dismissAfterPlaybackFailure()
    })
    playerController.present(alert, animated: true)
  }

  private func dismissAfterPlaybackFailure() {
    player.pause()
    guard playerController.presentingViewController != nil else {
      onDismiss()
      return
    }
    programmaticDismissal = true
    playerController.dismiss(animated: true) { [weak self] in
      self?.onDismiss()
    }
  }

  private func loadStoryboard() {
    storyboardGeneration += 1
    let generation = storyboardGeneration
    storyboardMetadataTask?.cancel()
    storyboardImageTask?.cancel()
    storyboardFrameCache.removeAllObjects()
    storyboard = nil
    storyboardImage = nil
    hideScrubPreview()

    guard let storyboardUrl,
          let metadataUrl = URL(string: storyboardUrl),
          metadataUrl.scheme == "https",
          metadataUrl.host == "image.mux.com",
          metadataUrl.lastPathComponent == "storyboard.json" else { return }

    var request = URLRequest(url: metadataUrl)
    request.timeoutInterval = 8
    storyboardMetadataTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
      guard error == nil,
            let http = response as? HTTPURLResponse,
            (200..<300).contains(http.statusCode),
            let data,
            let storyboard = NativeStoryboardParser.parse(data) else { return }

      var imageRequest = URLRequest(url: storyboard.url)
      imageRequest.timeoutInterval = 12
      self?.storyboardImageTask = URLSession.shared.dataTask(with: imageRequest) { [weak self] imageData, imageResponse, imageError in
        guard imageError == nil,
              let imageHttp = imageResponse as? HTTPURLResponse,
              (200..<300).contains(imageHttp.statusCode),
              let imageData,
              imageData.count <= 15_000_000,
              let image = UIImage(data: imageData) else { return }
        DispatchQueue.main.async {
          guard let self,
                self.storyboardGeneration == generation,
                self.storyboardUrl == storyboardUrl else { return }
          self.storyboard = storyboard
          self.storyboardImage = image
          NSLog("[NativeSwiftPlayer] loaded storyboard tiles=%d", storyboard.tiles.count)
        }
      }
      self?.storyboardImageTask?.resume()
    }
    storyboardMetadataTask?.resume()
  }

  private func updateScrubPreview(position: Double) {
    defer { lastObservedPosition = position }
    guard !usesCustomChrome else { return }
    guard let previous = lastObservedPosition else { return }
    guard abs(position - previous) >= 0.75 else { return }
    showScrubPreview(at: position)
  }

  private func suppressScrubPreview() {
    suppressScrubPreviewUntil = Date.timeIntervalSinceReferenceDate + 0.75
    hideScrubPreview()
  }

  private func showScrubPreview(at position: Double) {
    guard !usesCustomChrome else { return }
    guard let image = storyboardFrame(at: position),
          let storyboardDuration = storyboard?.duration else { return }

    let label = formatPreviewTime(position)
    scrubPreviewImageView.image = image
    scrubPreviewTimeLabel.text = label
    scrubPreviewView.accessibilityLabel = "Preview at \(label)"
    updateScrubPreviewPosition(position: position, duration: storyboardDuration)
    scrubPreviewView.isHidden = false

    scrubPreviewHideWorkItem?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      self?.hideScrubPreview()
    }
    scrubPreviewHideWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: workItem)
  }

  private func storyboardFrame(at position: Double) -> UIImage? {
    guard let storyboard,
          let storyboardImage,
          let index = NativeStoryboardParser.tileIndex(in: storyboard, at: position) else { return nil }
    let key = NSNumber(value: index)
    if let cached = storyboardFrameCache.object(forKey: key) {
      return cached
    }
    guard let cropped = cropStoryboardTile(
      storyboard.tiles[index],
      storyboard: storyboard,
      image: storyboardImage
    ) else { return nil }
    storyboardFrameCache.setObject(cropped, forKey: key)
    return cropped
  }

  private func cropStoryboardTile(
    _ tile: NativeStoryboardTile,
    storyboard: NativeStoryboard,
    image: UIImage
  ) -> UIImage? {
    guard let source = image.cgImage else { return nil }
    let rect = CGRect(
      x: tile.x,
      y: tile.y,
      width: storyboard.tileWidth,
      height: storyboard.tileHeight
    )
    guard rect.maxX <= CGFloat(source.width),
          rect.maxY <= CGFloat(source.height),
          let cropped = source.cropping(to: rect) else { return nil }
    return UIImage(cgImage: cropped, scale: 1, orientation: .up)
  }

  private func updateScrubPreviewPosition(position: Double, duration: Double) {
    guard duration.isFinite,
          duration > 0,
          let overlay = playerController.contentOverlayView else { return }
    let width = overlay.bounds.width
    guard width > 0 else { return }
    let fraction = min(1, max(0, position / duration))
    let desiredOffset = (fraction - 0.5) * width
    let maxOffset = max(0, width / 2 - 240)
    scrubPreviewCenterXConstraint?.constant = min(maxOffset, max(-maxOffset, desiredOffset))
    overlay.layoutIfNeeded()
  }

  private func hideScrubPreview() {
    scrubPreviewHideWorkItem?.cancel()
    scrubPreviewHideWorkItem = nil
    scrubPreviewView.isHidden = true
    scrubPreviewImageView.image = nil
  }

  private func formatPreviewTime(_ rawSeconds: Double) -> String {
    let total = max(0, Int(rawSeconds.rounded(.down)))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let seconds = total % 60
    if hours > 0 {
      return String(format: "%d:%02d:%02d", hours, minutes, seconds)
    }
    return String(format: "%d:%02d", minutes, seconds)
  }

  private func updateMetadata() {
    guard let item = player.currentItem, let title = videoTitle, !title.isEmpty else { return }
    let metadata = AVMutableMetadataItem()
    metadata.identifier = .commonIdentifierTitle
    metadata.value = title as NSString
    metadata.extendedLanguageTag = "en"
    item.externalMetadata = [metadata]
  }

  private func handleTimeUpdate(_ position: Double) {
    guard position.isFinite else { return }
    updateScrubPreview(position: position)
    let duration = currentDuration
    if usesCustomChrome {
      customChromeView.updatePlayback(
        position: position,
        duration: duration,
        isPaused: player.rate == 0
      )
    }
    onPlaybackPosition(["positionSeconds": position, "durationSeconds": duration])

    guard !subtitleCues.isEmpty else {
      subtitleLabel.isHidden = true
      return
    }
    let cue = NativeVttParser.activeCue(in: subtitleCues, at: position)
    subtitleLabel.text = cue?.text
    subtitleLabel.isHidden = cue == nil
  }

  public func playerViewControllerWillBeginDismissalTransition(
    _ playerViewController: AVPlayerViewController
  ) {
    guard !programmaticDismissal else { return }
    completeUserDismissal()
  }

  public func playerViewControllerShouldDismiss(
    _ playerViewController: AVPlayerViewController
  ) -> Bool {
    guard !programmaticDismissal else { return true }
    let cancelledScrub = usesCustomChrome && customChromeView.cancelScrubbing()
    if cancelledScrub {
      return false
    }
    player.pause()
    programmaticDismissal = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
      guard let self else { return }
      guard let root = self.playerController.view.window?.rootViewController else {
        self.programmaticDismissal = false
        self.completeUserDismissal()
        return
      }
      root.dismiss(animated: false) { [weak self] in
        guard let self else { return }
        self.programmaticDismissal = false
        self.completeUserDismissal()
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        guard let self, !self.userDismissalHandled else { return }
        self.playerController.dismiss(animated: false)
        self.programmaticDismissal = false
        self.completeUserDismissal()
      }
    }
    return false
  }

  public func playerViewControllerDidEndDismissalTransition(
    _ playerViewController: AVPlayerViewController
  ) {
    player.pause()
    if programmaticDismissal {
      programmaticDismissal = false
      return
    }
    completeUserDismissal()
  }

  private func completeUserDismissal() {
    guard !userDismissalHandled else { return }
    userDismissalHandled = true
    onDismiss()
  }

  private func startDismissalMonitor() {
    dismissalMonitorGeneration += 1
    let generation = dismissalMonitorGeneration
    monitorDismissal(generation: generation)
  }

  private func monitorDismissal(generation: Int) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
      guard let self,
            self.dismissalMonitorGeneration == generation,
            !self.userDismissalHandled else { return }
      if self.playerController.presentingViewController == nil,
         !self.playerController.isBeingPresented,
         !self.programmaticDismissal {
        self.player.pause()
        self.completeUserDismissal()
        return
      }
      self.monitorDismissal(generation: generation)
    }
  }

  private func handleEnded() {
    guard !endHandled else { return }
    endHandled = true
    guard let slug = upNextSlug, !slug.isEmpty else {
      if playerController.presentingViewController != nil {
        programmaticDismissal = true
        playerController.dismiss(animated: false) { [weak self] in
          self?.onEnded()
        }
      } else {
        onEnded()
      }
      return
    }
    let alert = UIAlertController(
      title: "Up Next",
      message: upNextTitle ?? "Play the next video?",
      preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "Play Now", style: .default) { [weak self] _ in
      self?.onPlayNext(["slug": slug])
    })
    alert.addAction(UIAlertAction(title: "Not Now", style: .cancel) { [weak self] _ in
      self?.onEnded()
    })
    playerController.present(alert, animated: true)
    DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self, weak alert] in
      guard let self, let alert, alert.presentingViewController != nil else { return }
      alert.dismiss(animated: true)
      self.onPlayNext(["slug": slug])
    }
  }

  private func updateTransportItems() {
    if usesCustomChrome {
      playerController.transportBarCustomMenuItems = []
      updateCustomChromeAvailability()
      return
    }
    var items: [UIMenuElement] = []
    items.append(UIAction(title: "Start Over", image: UIImage(systemName: "arrow.counterclockwise")) { [weak self] _ in
      guard let self else { return }
      self.suppressScrubPreview()
      self.player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
      self.player.play()
    })
    if !moments.isEmpty || !questions.isEmpty {
      items.append(UIAction(title: "Explore", image: UIImage(systemName: "book")) { [weak self] _ in
        self?.presentExplore()
      })
    }
    if !audioOptions.isEmpty {
      items.append(UIAction(title: "Language", image: UIImage(systemName: "globe")) { [weak self] _ in
        self?.presentLanguages()
      })
    }
    items.append(UIAction(title: "Subtitles", image: UIImage(systemName: "captions.bubble")) { [weak self] _ in
      self?.presentSubtitles()
    })
    playerController.transportBarCustomMenuItems = items
  }

  private func presentLanguages() {
    let sortedOptions = audioOptions.sorted { left, right in
      let byLabel = left.label.localizedCaseInsensitiveCompare(right.label)
      if byLabel != .orderedSame { return byLabel == .orderedAscending }
      let byDetail = left.detail.localizedCaseInsensitiveCompare(right.detail)
      if byDetail != .orderedSame { return byDetail == .orderedAscending }
      return left.id < right.id
    }
    let rows = sortedOptions.map {
      NativeListRow(id: $0.id, title: $0.label, detail: $0.detail, selected: $0.id == selectedAudioId, selectable: true)
    }
    presentList(
      title: "Audio Language",
      rows: rows,
      selectedId: selectedAudioId,
      searchPlaceholder: "Search audio languages"
    ) { [weak self] id in
      self?.onAudioChange(["id": id])
    }
  }

  private func presentSubtitles() {
    let sortedOptions = subtitleOptions.sorted { left, right in
      let byLabel = left.label.localizedCaseInsensitiveCompare(right.label)
      if byLabel != .orderedSame { return byLabel == .orderedAscending }
      let byDetail = left.detail.localizedCaseInsensitiveCompare(right.detail)
      if byDetail != .orderedSame { return byDetail == .orderedAscending }
      return left.id < right.id
    }
    var rows = [NativeListRow(id: "__off__", title: "Subtitles Off", detail: nil, selected: selectedSubtitleId == nil, selectable: true)]
    rows.append(contentsOf: sortedOptions.map {
      NativeListRow(id: $0.id, title: $0.label, detail: $0.detail, selected: $0.id == selectedSubtitleId, selectable: true)
    })
    presentList(
      title: "Subtitles",
      rows: rows,
      selectedId: selectedSubtitleId ?? "__off__",
      searchPlaceholder: "Search subtitle languages"
    ) { [weak self] id in
      guard let self else { return }
      if id == "__off__" {
        self.selectedSubtitleId = nil
        self.selectedSubtitleUrl = nil
        self.onSubtitleChange(["id": NSNull()])
        return
      }
      guard let option = self.subtitleOptions.first(where: { $0.id == id }) else { return }
      self.selectedSubtitleId = option.id
      self.selectedSubtitleUrl = option.url
      self.onSubtitleChange(["id": option.id])
    }
  }

  private func presentExplore() {
    var rows = moments.map {
      NativeListRow(id: "moment:\($0.id)", title: $0.label, detail: $0.detail, selected: false, selectable: true)
    }
    rows.append(contentsOf: questions.enumerated().map { index, question in
      NativeListRow(id: "question:\(index)", title: question, detail: "Question to consider", selected: false, selectable: false)
    })
    presentList(title: "Explore", rows: rows, selectedId: nil) { [weak self] id in
      guard let self, id.hasPrefix("moment:"), let moment = self.moments.first(where: { "moment:\($0.id)" == id }) else { return }
      let target = CMTime(seconds: max(0, moment.startSeconds), preferredTimescale: 600)
      self.suppressScrubPreview()
      self.player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
    }
  }

  private func presentList(
    title: String,
    rows: [NativeListRow],
    selectedId: String?,
    searchPlaceholder: String? = nil,
    onSelect: @escaping (String) -> Void
  ) {
    guard playerController.presentedViewController == nil else { return }
    let list = NativeOptionsController(
      title: title,
      rows: rows,
      selectedId: selectedId,
      onSelect: onSelect
    )
    let rootController: UIViewController
    let searchController: UISearchController?
    if let searchPlaceholder {
      let search = UISearchController(searchResultsController: list)
      search.searchResultsUpdater = list
      search.obscuresBackgroundDuringPresentation = false
      search.searchBar.placeholder = searchPlaceholder
      let container = UISearchContainerViewController(searchController: search)
      container.title = title
      rootController = container
      searchController = search
    } else {
      rootController = list
      searchController = nil
    }
    let navigation = NativeOptionsNavigationController(rootViewController: rootController)
    navigation.onClose = { [weak self] in
      self?.customChromeView.setModalPresented(false)
    }
    navigation.modalPresentationStyle = .fullScreen
    if usesCustomChrome { customChromeView.setModalPresented(true) }
    playerController.present(navigation, animated: true) {
      if let searchController {
        searchController.isActive = true
      } else {
        list.focusInitialRow()
      }
    }
  }

  private func loadSubtitles() {
    subtitleTask?.cancel()
    subtitleCues = []
    subtitleLabel.isHidden = true
    guard let selectedSubtitleUrl, let url = URL(string: selectedSubtitleUrl), url.scheme == "https" else { return }
    var request = URLRequest(url: url)
    request.timeoutInterval = 8
    subtitleTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
      guard error == nil,
            let http = response as? HTTPURLResponse,
            (200..<300).contains(http.statusCode),
            let data,
            let text = String(data: data, encoding: .utf8) else { return }
      let cues = NativeVttParser.parse(text)
      DispatchQueue.main.async {
        guard let self else { return }
        NSLog("[NativeSwiftPlayer] loaded subtitle cues=%d", cues.count)
        self.subtitleCues = cues
      }
    }
    subtitleTask?.resume()
  }
}
