import UIKit

final class NativeFeedbackQrController: UIViewController {
  var onClose: (() -> Void)?
  var onRetry: (() -> Void)?

  private let message = UILabel()
  private let reference = UILabel()
  private let image = UIImageView()
  private let retry = UIButton(type: .system)

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.031, green: 0.031, blue: 0.039, alpha: 1)
    let close = UIButton(type: .system)
    close.setTitle("‹ Back", for: .normal)
    close.titleLabel?.font = .systemFont(ofSize: 28, weight: .bold)
    close.addAction(UIAction { [weak self] _ in self?.dismiss(animated: true) }, for: .primaryActionTriggered)
    close.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(close)

    let title = UILabel()
    title.text = "The beta testing"
    title.textColor = .white
    title.font = .systemFont(ofSize: 56, weight: .bold)
    title.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(title)

    message.text = "Verifying this TV…"
    message.textColor = .lightGray
    message.font = .systemFont(ofSize: 27)
    message.numberOfLines = 0
    message.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(message)

    image.contentMode = .scaleAspectFit
    image.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(image)

    reference.textColor = .lightGray
    reference.font = .systemFont(ofSize: 24)
    reference.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(reference)

    retry.setTitle("Try again", for: .normal)
    retry.titleLabel?.font = .systemFont(ofSize: 25, weight: .semibold)
    retry.addAction(UIAction { [weak self] _ in self?.onRetry?() }, for: .primaryActionTriggered)
    retry.translatesAutoresizingMaskIntoConstraints = false
    retry.isHidden = true
    view.addSubview(retry)

    NSLayoutConstraint.activate([
      close.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 70),
      close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 42),
      title.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 110),
      title.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -100),
      message.leadingAnchor.constraint(equalTo: title.leadingAnchor),
      message.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 22),
      message.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.45),
      retry.leadingAnchor.constraint(equalTo: title.leadingAnchor),
      retry.topAnchor.constraint(equalTo: message.bottomAnchor, constant: 30),
      image.centerXAnchor.constraint(equalTo: view.centerXAnchor, constant: 400),
      image.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      image.widthAnchor.constraint(equalToConstant: 420),
      image.heightAnchor.constraint(equalToConstant: 420),
      reference.centerXAnchor.constraint(equalTo: image.centerXAnchor),
      reference.topAnchor.constraint(equalTo: image.bottomAnchor, constant: 20)
    ])
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if presentingViewController == nil { onClose?() }
  }

  func update(rows: [String], code: String?, loading: Bool, error: Bool) {
    guard isViewLoaded else { return }
    image.image = Self.qrImage(rows)
    reference.text = code.map { "Reference \($0)" }
    retry.isHidden = !error
    message.text = error
      ? "Verified feedback is unavailable. Please try again."
      : loading || image.image == nil
        ? "Verifying this TV…"
        : "Scan with your phone to report an issue or share an idea."
  }

  private static func qrImage(_ rows: [String]) -> UIImage? {
    let count = rows.count
    guard count >= 21, count <= 177,
          rows.allSatisfy({ $0.count == count && $0.allSatisfy({ $0 == "0" || $0 == "1" }) }) else { return nil }
    let size = 600
    let quiet = 4
    let step = CGFloat(size) / CGFloat(count + quiet * 2)
    return UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { context in
      UIColor.white.setFill()
      context.fill(CGRect(x: 0, y: 0, width: size, height: size))
      UIColor.black.setFill()
      for (y, row) in rows.enumerated() {
        for (x, bit) in row.enumerated() where bit == "1" {
          context.fill(CGRect(x: CGFloat(x + quiet) * step, y: CGFloat(y + quiet) * step,
                              width: step + 0.2, height: step + 0.2))
        }
      }
    }
  }
}
