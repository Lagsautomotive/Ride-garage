// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "RideJournal", platforms: [.macOS(.v12), .iOS(.v15)], products: [.library(name: "RideJournal", targets: ["RideJournal"])], targets: [.target(name: "RideJournal", path: "ios/Sources/RideRecorderPlugin", exclude: ["RideRecorderPlugin.swift"], sources: ["RideJournal.swift"]), .testTarget(name: "RideJournalTests", dependencies: ["RideJournal"], path: "Tests")])
