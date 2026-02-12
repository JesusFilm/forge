// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "ForgeMobile",
  platforms: [.iOS(.v17)],
  products: [
    .library(name: "ForgeMobile", targets: ["ForgeMobile"])
  ],
  targets: [
    .target(
      name: "ForgeMobile",
      dependencies: [],
      path: "Sources/ForgeMobile"
    )
  ]
)
