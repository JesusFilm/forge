import Foundation

/// Computes Western Easter, Orthodox Easter, and Jewish Passover dates
/// for a given year using standard calendar algorithms.
enum EasterDateCalculator {

  // MARK: - Western Easter (Gregorian computus)

  /// Anonymous Gregorian algorithm for computing Western Easter Sunday.
  static func westernEaster(year: Int) -> DateComponents {
    let a = year % 19
    let b = year / 100
    let c = year % 100
    let d = b / 4
    let e = b % 4
    let f = (b + 8) / 25
    let g = (b - f + 1) / 3
    let h = (19 * a + b - d - g + 15) % 30
    let i = c / 4
    let k = c % 4
    let l = (32 + 2 * e + 2 * i - h - k) % 7
    let m = (a + 11 * h + 22 * l) / 451
    let month = (h + l - 7 * m + 114) / 31
    let day = ((h + l - 7 * m + 114) % 31) + 1
    return DateComponents(year: year, month: month, day: day)
  }

  // MARK: - Orthodox Easter (Julian computus → Gregorian)

  /// Julian calendar Easter algorithm, converted to Gregorian date.
  /// The Julian-to-Gregorian offset is 13 days for years 1900–2099.
  static func orthodoxEaster(year: Int) -> DateComponents {
    let a = year % 4
    let b = year % 7
    let c = year % 19
    let d = (19 * c + 15) % 30
    let e = (2 * a + 4 * b - d + 34) % 7
    let julianMonth = (d + e + 114) / 31
    let julianDay = ((d + e + 114) % 31) + 1

    // Convert Julian to Gregorian by adding century offset.
    let centuryOffset = julianToGregorianOffset(year: year)
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let julianComponents = DateComponents(year: year, month: julianMonth, day: julianDay + centuryOffset)
    guard let date = calendar.date(from: julianComponents) else {
      return DateComponents(year: year, month: julianMonth, day: julianDay + centuryOffset)
    }
    return calendar.dateComponents([.year, .month, .day], from: date)
  }

  /// Julian-to-Gregorian day offset for a given year.
  private static func julianToGregorianOffset(year: Int) -> Int {
    let century = year / 100
    return century - century / 4 - 2
  }

  // MARK: - Jewish Passover (15 Nisan)

  /// Computes Passover (15 Nisan) using Foundation's Hebrew calendar.
  static func passover(year: Int) -> DateComponents {
    var hebrewCalendar = Calendar(identifier: .hebrew)
    hebrewCalendar.timeZone = TimeZone(identifier: "UTC")!
    var gregorianCalendar = Calendar(identifier: .gregorian)
    gregorianCalendar.timeZone = TimeZone(identifier: "UTC")!

    // Hebrew month 8 in Foundation = Nisan.
    // Try two consecutive Hebrew years to find the Passover that falls
    // in the target Gregorian year.
    for hebrewYear in [year + 3760, year + 3761] {
      var components = DateComponents()
      components.year = hebrewYear
      components.month = 8 // Nisan
      components.day = 15
      if let date = hebrewCalendar.date(from: components) {
        let gregorian = gregorianCalendar.dateComponents([.year, .month, .day], from: date)
        if gregorian.year == year {
          return gregorian
        }
      }
    }
    // Fallback: return empty components for the year.
    return DateComponents(year: year)
  }

  // MARK: - Formatting

  /// Formats date components into a locale-aware full date string.
  static func formattedDate(_ components: DateComponents, locale: String?) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    guard let date = calendar.date(from: components) else { return "" }
    let formatter = DateFormatter()
    formatter.dateStyle = .full
    formatter.timeZone = TimeZone(identifier: "UTC")!
    if let localeId = locale {
      formatter.locale = Locale(identifier: localeId)
    }
    return formatter.string(from: date)
  }
}
