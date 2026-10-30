import UIKit

/// A detail-page picker, deliberately independent of the playback controller.
/// Updating loading/retry results keeps the native keyboard and query mounted.
final class NativeDetailTrackChoice {
  let requestId: String
  private let results: NativeDetailTrackResultsController
  private let search: UISearchController
  private let navigation: NativeDetailTrackNavigationController
  private let onComplete: ([String: String]?) -> Void
  private weak var returnFocus: UIView?
  private var completed = false
  private var pendingChoice: String?
  private var presentationInProgress = false
  private var dismissalInProgress = false
  private var dismissAfterPresentation = false
  private var dismissalAnimated = true
  private var dismissalCompletions: [() -> Void] = []
  private var queryAtDismissal: String?

  init(
    requestId: String,
    title: String,
    rows: [NativeDetailTrackRow],
    selectedId: String?,
    status: String?,
    query: String,
    onComplete: @escaping ([String: String]?) -> Void
  ) {
    self.requestId = requestId
    self.onComplete = onComplete
    results = NativeDetailTrackResultsController(rows: rows, selectedId: selectedId, status: status, query: query)
    search = UISearchController(searchResultsController: results)
    search.searchResultsUpdater = results
    search.obscuresBackgroundDuringPresentation = false
    search.searchBar.placeholder = title == "Subtitles" ? "Search subtitle languages" : "Search audio languages"
    search.searchBar.text = query
    let container = UISearchContainerViewController(searchController: search)
    container.title = title
    navigation = NativeDetailTrackNavigationController(rootViewController: container)
    navigation.modalPresentationStyle = .fullScreen
    navigation.overrideUserInterfaceStyle = .dark
    navigation.onRequestClose = { [weak self] in self?.dismiss() }
    navigation.onDismissed = { [weak self] in
      guard let self, !self.dismissalInProgress, !self.presentationInProgress else { return }
      self.finish()
    }
    results.onSelect = { [weak self] id in
      guard let self else { return }
      self.pendingChoice = id
      self.dismiss()
    }
  }

  func present(from presenter: UIViewController) {
    guard !completed else { return }
    returnFocus = UIFocusSystem.focusSystem(for: presenter.view)?.focusedItem as? UIView
    presentationInProgress = true
    // The module may replace its owner while this transition is pending. Keep
    // this picker alive until UIKit can run a queued dismissal and completion.
    presenter.present(navigation, animated: true) {
      guard !self.completed else { return }
      self.presentationInProgress = false
      if self.dismissAfterPresentation {
        self.dismiss(animated: self.dismissalAnimated)
        return
      }
      self.search.isActive = true
      self.search.searchBar.becomeFirstResponder()
    }
  }

  func update(rows: [NativeDetailTrackRow], selectedId: String?, status: String?) {
    guard !completed else { return }
    results.update(rows: rows, selectedId: selectedId, status: status)
  }

  func dismiss(animated: Bool = true, completion: (() -> Void)? = nil) {
    guard !completed else { completion?(); return }
    if let completion { dismissalCompletions.append(completion) }
    queryAtDismissal = queryAtDismissal ?? search.searchBar.text ?? ""
    if presentationInProgress {
      dismissAfterPresentation = true
      dismissalAnimated = animated
      return
    }
    guard !dismissalInProgress else { return }
    dismissalInProgress = true
    guard navigation.presentingViewController != nil else {
      finish()
      return
    }
    // Retain through the bounded transition even after a newer request owns
    // the module. Persistent controller callbacks still capture self weakly.
    navigation.dismiss(animated: animated) {
      self.finish()
    }
  }

  private func finish() {
    guard !completed else { return }
    completed = true
    let result = pendingChoice.map { ["id": $0, "query": queryAtDismissal ?? search.searchBar.text ?? ""] }
    // Restore the exact initiating button if its route still exists. Never
    // focus a detached view after navigation or request another Play action.
    if let returnFocus, returnFocus.window != nil,
       let focusSystem = UIFocusSystem.focusSystem(for: returnFocus) {
      focusSystem.requestFocusUpdate(to: returnFocus)
      focusSystem.updateFocusIfNeeded()
    }
    onComplete(result)
    let completions = dismissalCompletions
    dismissalCompletions = []
    completions.forEach { $0() }
  }
}

private final class NativeDetailTrackNavigationController: UINavigationController {
  var onRequestClose: (() -> Void)?
  var onDismissed: (() -> Void)?

  override func viewDidLoad() {
    super.viewDidLoad()
    topViewController?.navigationItem.rightBarButtonItem = UIBarButtonItem(
      title: "Close", style: .done, target: self, action: #selector(closePicker)
    )
    let menu = UITapGestureRecognizer(target: self, action: #selector(closePicker))
    menu.allowedPressTypes = [NSNumber(value: UIPress.PressType.menu.rawValue)]
    view.addGestureRecognizer(menu)
  }

  @objc private func closePicker() { onRequestClose?() }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    guard presentingViewController == nil else { return }
    onDismissed?()
  }
}

private final class NativeDetailTrackResultsController: UITableViewController, UISearchResultsUpdating {
  var onSelect: ((String) -> Void)?
  private var rows: [NativeDetailTrackRow]
  private var visibleRows: [NativeDetailTrackRow]
  private var selectedId: String?
  private var status: String?
  private var query: String
  private let statusLabel = UILabel()

  init(rows: [NativeDetailTrackRow], selectedId: String?, status: String?, query: String) {
    self.rows = NativeDetailTrackRows.ordered(rows)
    self.visibleRows = NativeDetailTrackRows.matching(self.rows, query: query)
    self.selectedId = selectedId
    self.status = status
    self.query = query
    super.init(style: .plain)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    tableView.backgroundColor = .black
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "track")
    tableView.remembersLastFocusedIndexPath = true
    statusLabel.font = .preferredFont(forTextStyle: .body)
    statusLabel.textColor = .secondaryLabel
    statusLabel.numberOfLines = 0
    statusLabel.textAlignment = .center
    statusLabel.isAccessibilityElement = true
    refresh()
  }

  func update(rows: [NativeDetailTrackRow], selectedId: String?, status: String?) {
    self.rows = NativeDetailTrackRows.ordered(rows)
    self.selectedId = selectedId
    self.status = status
    refresh()
  }

  func updateSearchResults(for searchController: UISearchController) {
    query = searchController.searchBar.text ?? ""
    refresh()
  }

  private func refresh() {
    visibleRows = NativeDetailTrackRows.matching(rows, query: query)
    guard isViewLoaded else { return }
    let message = NativeDetailTrackRows.status(status, rows: visibleRows, query: query)
    statusLabel.text = message
    statusLabel.frame = CGRect(x: 0, y: 0, width: tableView.bounds.width, height: message == nil ? 0 : 80)
    tableView.tableHeaderView = message == nil ? nil : statusLabel
    tableView.reloadData()
  }

  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    visibleRows.count
  }

  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let row = visibleRows[indexPath.row]
    let cell = tableView.dequeueReusableCell(withIdentifier: "track", for: indexPath)
    var content = cell.defaultContentConfiguration()
    content.text = row.label
    content.secondaryText = row.detail.isEmpty ? nil : row.detail
    cell.contentConfiguration = content
    cell.accessoryType = row.id == selectedId ? .checkmark : .none
    cell.selectionStyle = row.disabled ? .none : .default
    cell.isUserInteractionEnabled = !row.disabled
    cell.contentView.alpha = row.disabled ? 0.6 : 1
    cell.accessibilityLabel = row.detail.isEmpty ? row.label : "\(row.label), \(row.detail)"
    cell.accessibilityTraits = row.disabled ? [.notEnabled] : [.button]
    if row.id == selectedId { cell.accessibilityTraits.insert(.selected) }
    return cell
  }

  override func tableView(_ tableView: UITableView, canFocusRowAt indexPath: IndexPath) -> Bool {
    !visibleRows[indexPath.row].disabled
  }

  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    let row = visibleRows[indexPath.row]
    guard !row.disabled else { return }
    onSelect?(row.id)
  }
}
