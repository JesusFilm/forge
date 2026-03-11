import SwiftUI
import UIKit

/// Pure-Swift BlurHash decoder. Converts a BlurHash string into a SwiftUI `Image`
/// that can be used as a placeholder background.
/// Based on the reference implementation at https://github.com/woltapp/blurhash.
enum BlurHashDecoder {

  /// Returns a SwiftUI `Image` from a BlurHash, or `nil` if decoding fails.
  /// This is the only public entry point — UIKit types are kept internal.
  static func image(
    blurHash: String, width: Int = 32, height: Int = 32
  ) -> Image? {
    guard let uiImage = decode(blurHash: blurHash, width: width, height: height) else {
      return nil
    }
    return Image(uiImage: uiImage)
  }

  // MARK: - Internal decode

  /// Decodes a BlurHash string into a UIImage of the given size.
  /// Returns `nil` if the hash is invalid or contains non-Base83 characters.
  private static func decode(
    blurHash: String, width: Int = 32, height: Int = 32, punch: Float = 1
  ) -> UIImage? {
    guard blurHash.count >= 6 else { return nil }

    guard let sizeFlag = decode83(String(blurHash[blurHash.startIndex ..< blurHash.index(
      blurHash.startIndex, offsetBy: 1)])) else { return nil }
    let numY = (sizeFlag / 9) + 1
    let numX = (sizeFlag % 9) + 1

    let expectedLength = 4 + 2 * numX * numY
    guard blurHash.count == expectedLength else { return nil }

    guard let quantisedMaximumValue = decode83(String(blurHash[blurHash.index(
      blurHash.startIndex, offsetBy: 1) ..< blurHash.index(blurHash.startIndex, offsetBy: 2)]))
    else { return nil }
    let maximumValue = Float(quantisedMaximumValue + 1) / 166

    guard let colors = decodeColors(
      blurHash: blurHash, numX: numX, numY: numY,
      maximumValue: maximumValue, punch: punch
    ) else { return nil }

    let pixels = renderPixels(
      colors: colors, numX: numX, numY: numY,
      width: width, height: height
    )

    return createImage(pixels: pixels, width: width, height: height)
  }

  // MARK: - Pixel rendering

  private static func decodeColors(
    blurHash: String, numX: Int, numY: Int,
    maximumValue: Float, punch: Float
  ) -> [LinearRGB]? {
    var colors = [LinearRGB]()
    for index in 0 ..< numX * numY {
      if index == 0 {
        guard let value = decode83(String(blurHash[blurHash.index(
          blurHash.startIndex, offsetBy: 2) ..< blurHash.index(blurHash.startIndex, offsetBy: 6)]))
        else { return nil }
        colors.append(decodeDC(value))
      } else {
        let start = blurHash.index(blurHash.startIndex, offsetBy: 4 + index * 2)
        let end = blurHash.index(start, offsetBy: 2)
        guard let value = decode83(String(blurHash[start ..< end])) else { return nil }
        colors.append(decodeAC(value, maximumValue: maximumValue * punch))
      }
    }
    return colors
  }

  private static func renderPixels(
    colors: [LinearRGB], numX: Int, numY: Int,
    width: Int, height: Int
  ) -> [UInt8] {
    let bytesPerRow = width * 4
    var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)

    for row in 0 ..< height {
      for col in 0 ..< width {
        let rgb = sampleColor(
          colors: colors, numX: numX, numY: numY,
          col: col, row: row, width: width, height: height
        )
        let offset = 4 * col + row * bytesPerRow
        pixels[offset] = UInt8(clamping: Int(linearToSRGB(rgb.red)))
        pixels[offset + 1] = UInt8(clamping: Int(linearToSRGB(rgb.green)))
        pixels[offset + 2] = UInt8(clamping: Int(linearToSRGB(rgb.blue)))
        pixels[offset + 3] = 255
      }
    }
    return pixels
  }

  // swiftlint:disable:next function_parameter_count
  private static func sampleColor(
    colors: [LinearRGB], numX: Int, numY: Int,
    col: Int, row: Int, width: Int, height: Int
  ) -> LinearRGB {
    var red: Float = 0
    var green: Float = 0
    var blue: Float = 0

    for basisY in 0 ..< numY {
      for basisX in 0 ..< numX {
        let basis = cos(Float.pi * Float(col) * Float(basisX) / Float(width))
          * cos(Float.pi * Float(row) * Float(basisY) / Float(height))
        let color = colors[basisX + basisY * numX]
        red += color.red * basis
        green += color.green * basis
        blue += color.blue * basis
      }
    }
    return LinearRGB(red: red, green: green, blue: blue)
  }

  private static func createImage(pixels: [UInt8], width: Int, height: Int) -> UIImage? {
    let bytesPerRow = width * 4
    let data = Data(pixels)
    guard let provider = CGDataProvider(data: data as CFData),
          let cgImage = CGImage(
            width: width, height: height, bitsPerComponent: 8,
            bitsPerPixel: 32, bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider, decode: nil,
            shouldInterpolate: true, intent: .defaultIntent
          )
    else { return nil }
    return UIImage(cgImage: cgImage)
  }

  // MARK: - Base83

  private static let base83Chars: [Character] = Array(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~")

  /// Decodes a Base83 string into an integer.
  /// Returns `nil` if any character is not in the Base83 alphabet.
  private static func decode83(_ str: String) -> Int? {
    var value = 0
    for char in str {
      guard let charIndex = base83Chars.firstIndex(of: char) else { return nil }
      value = value * 83 + base83Chars.distance(from: base83Chars.startIndex, to: charIndex)
    }
    return value
  }

  // MARK: - Color helpers

  private static func decodeDC(_ value: Int) -> LinearRGB {
    let intR = value >> 16
    let intG = (value >> 8) & 255
    let intB = value & 255
    return LinearRGB(red: sRGBToLinear(intR), green: sRGBToLinear(intG), blue: sRGBToLinear(intB))
  }

  private static func decodeAC(_ value: Int, maximumValue: Float) -> LinearRGB {
    let quantR = value / (19 * 19)
    let quantG = (value / 19) % 19
    let quantB = value % 19
    return LinearRGB(
      red: signPow((Float(quantR) - 9) / 9, 2) * maximumValue,
      green: signPow((Float(quantG) - 9) / 9, 2) * maximumValue,
      blue: signPow((Float(quantB) - 9) / 9, 2) * maximumValue
    )
  }

  private static func signPow(_ value: Float, _ exp: Float) -> Float {
    copysign(pow(abs(value), exp), value)
  }

  private static func linearToSRGB(_ value: Float) -> Float {
    let clamped = max(0, min(1, value))
    if clamped <= 0.003_130_8 {
      return clamped * 12.92 * 255 + 0.5
    }
    return (1.055 * pow(clamped, 1 / 2.4) - 0.055) * 255 + 0.5
  }

  private static func sRGBToLinear(_ value: Int) -> Float {
    let linear = Float(value) / 255
    if linear <= 0.04045 {
      return linear / 12.92
    }
    return pow((linear + 0.055) / 1.055, 2.4)
  }
}

// MARK: - Linear RGB color

/// Represents a color in linear RGB space for BlurHash decoding.
private struct LinearRGB {
  let red: Float
  let green: Float
  let blue: Float
}
