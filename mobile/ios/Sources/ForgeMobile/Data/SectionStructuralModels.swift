import Foundation

// MARK: - Container (grid layout with slots)

public struct ContainerSlot: Sendable, Codable {
  public let id: String
  public let gridSpan: Int
  public let content: [SectionContent]

  public init(id: String, gridSpan: Int, content: [SectionContent]) {
    self.id = id
    self.gridSpan = gridSpan
    self.content = content
  }
}

public struct ContainerSection: Sendable, Codable {
  public let id: String
  public let sectionKey: String?
  public let slots: [ContainerSlot]

  public init(id: String, sectionKey: String?, slots: [ContainerSlot]) {
    self.id = id
    self.sectionKey = sectionKey
    self.slots = slots
  }
}

// MARK: - Section wrapper (background + nested content)

public struct SectionWrapperSection: Sendable, Codable {
  public let id: String
  public let sectionKey: String?
  public let backgroundColor: SectionBackgroundColor?
  public let blurHash: String?
  public let content: [SectionContent]

  public init(
    id: String, sectionKey: String?,
    backgroundColor: SectionBackgroundColor?, blurHash: String?,
    content: [SectionContent]
  ) {
    self.id = id
    self.sectionKey = sectionKey
    self.backgroundColor = backgroundColor
    self.blurHash = blurHash
    self.content = content
  }
}
