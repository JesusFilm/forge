import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

/// QR generation for the device-grant verification URL.
enum QRCode {
    // One shared context — CIContext construction is the expensive part;
    // individual renders are cheap.
    private static let context = CIContext()

    /// A crisp QR as a SwiftUI Image. `decorative` keeps the payload (which
    /// embeds the user code via verification_uri_complete) out of the
    /// accessibility tree entirely.
    static func image(for string: String, scale: CGFloat = 12) -> Image? {
        cgImage(for: string, scale: scale).map {
            Image(decorative: $0, scale: 1).interpolation(.none)
        }
    }

    static func cgImage(for string: String, scale: CGFloat = 12) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        // "M" (15% recovery) scans fine off a TV panel and keeps the module
        // grid coarser than "H" would — bigger squares scan from further away.
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        // samplingNearest BEFORE the transform: modules stay hard-edged squares
        // instead of being smeared by the default linear filter.
        let scaled = output
            .samplingNearest()
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        return context.createCGImage(scaled, from: scaled.extent)
    }
}
