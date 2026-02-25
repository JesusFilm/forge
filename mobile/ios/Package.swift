// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "ForgeMobile",
  platforms: [.iOS(.v17)],
  products: [
    .library(name: "ForgeMobile", targets: ["ForgeMobile"])
  ],
  dependencies: [
    .package(url: "https://github.com/apollographql/apollo-ios.git", from: "1.0.0")
  ],
  targets: [
    .target(
      name: "ForgeMobile",
      dependencies: [
        .product(name: "Apollo", package: "apollo-ios")
      ],
      path: "Sources/ForgeMobile"
    )
  ]
)
