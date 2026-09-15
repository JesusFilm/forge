import Foundation

struct NativeStoryboardTile: Equatable {
  let start: Double
  let x: Int
  let y: Int
}

struct NativeStoryboard {
  let duration: Double
  let tileHeight: Int
  let tileWidth: Int
  let tiles: [NativeStoryboardTile]
  let url: URL
}

enum NativeStoryboardParser {
  private struct Payload: Decodable {
    struct Tile: Decodable {
      let start: Double
      let x: Int
      let y: Int
    }

    let duration: Double
    let tileHeight: Int
    let tileWidth: Int
    let tiles: [Tile]
    let url: String

    enum CodingKeys: String, CodingKey {
      case duration
      case tileHeight = "tile_height"
      case tileWidth = "tile_width"
      case tiles
      case url
    }
  }

  static func parse(_ data: Data) -> NativeStoryboard? {
    guard data.count <= 1_000_000,
          let payload = try? JSONDecoder().decode(Payload.self, from: data),
          payload.duration.isFinite,
          payload.duration > 0,
          (1...4096).contains(payload.tileWidth),
          (1...4096).contains(payload.tileHeight),
          (1...500).contains(payload.tiles.count),
          let url = URL(string: payload.url),
          url.scheme == "https",
          url.host == "image.mux.com" else { return nil }

    var tiles: [NativeStoryboardTile] = []
    tiles.reserveCapacity(payload.tiles.count)
    for tile in payload.tiles {
      guard tile.start.isFinite,
            tile.start >= 0,
            tile.x >= 0,
            tile.y >= 0,
            tile.x <= 32_768,
            tile.y <= 32_768 else { return nil }
      tiles.append(NativeStoryboardTile(start: tile.start, x: tile.x, y: tile.y))
    }
    tiles.sort { $0.start < $1.start }
    return NativeStoryboard(
      duration: payload.duration,
      tileHeight: payload.tileHeight,
      tileWidth: payload.tileWidth,
      tiles: tiles,
      url: url
    )
  }

  static func tileIndex(in storyboard: NativeStoryboard, at time: Double) -> Int? {
    guard !storyboard.tiles.isEmpty, time.isFinite else { return nil }
    var low = 0
    var high = storyboard.tiles.count - 1
    var candidate = 0
    while low <= high {
      let middle = (low + high) / 2
      if storyboard.tiles[middle].start <= time {
        candidate = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return candidate
  }
}
